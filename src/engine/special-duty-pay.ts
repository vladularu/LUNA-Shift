import { Temporal } from "@js-temporal/polyfill";
import { clockMinute, dutyInstant, DUTY_LABELS } from "@/domain/special-duty";
import { employmentProfileAt } from "@/domain/employment-history";
import type { SpecialDutyPayLine } from "@/domain/special-duty-pay";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { dutyCalendarDates } from "./special-duty";
import { DUTY_RULE_SOURCES, dutyTariffFamily, onCallBaseHours } from "./special-duty-tariff";
import { specialDutyHourlyCents } from "./special-duty-hourly-rate";
import { getPublicHolidays } from "./holidays";

function calculateDutyBase(
  shift: ShiftEntry,
  profile: UserProfile,
  resolver: RuleResolver,
): SpecialDutyPayLine {
  const duty = shift.specialDuty!;
  const notes: string[] = [];
  let paidHours: number | null = null;
  let hourlyCents: number | null = null;
  let baseAmountCents: number | null = null;
  let durationMinutes = 0;
  let source: string | null = null;
  try {
    const work = employmentProfileAt(profile, shift.date);
    const family = dutyTariffFamily(work);
    const start = dutyInstant(shift.date, clockMinute(shift.startTime!), duty.timeZone);
    const end = dutyInstant(
      shift.date,
      duty.endDay * 1440 + clockMinute(shift.endTime!),
      duty.timeZone,
    );
    durationMinutes = (Number(end.epochMilliseconds) - Number(start.epochMilliseconds)) / 60000;
    if (!family)
      notes.push("Der Arbeitgeberbereich ist für diese Abrechnung noch nicht zugeordnet.");
    else if (
      shift.date < DUTY_RULE_SOURCES[family].version ||
      end.subtract({ milliseconds: 1 }).toPlainDate().toString() > "2026-12-31"
    )
      notes.push("Für diesen Zeitraum fehlen geprüfte Bereitschaftsregeln.");
    else if (duty.kind === "STANDBY") {
      source = DUTY_RULE_SOURCES[family].standby;
      notes.push(
        "Bereitschaftsdienst: Tabellenzuordnung, Bewertung und Abgeltung sind noch offen.",
      );
    } else if (durationMinutes > 1440 || duty.endDay > 1) {
      notes.push("Mehrtägige Rufbereitschaft: die Aufteilung der Pauschalen ist noch offen.");
    } else if (
      end.subtract({ milliseconds: 1 }).toPlainDate().toString().slice(0, 7) !==
      shift.date.slice(0, 7)
    ) {
      notes.push(
        "Rufbereitschaft über eine Monatsgrenze: die Abrechnungszuordnung ist noch offen.",
      );
    } else {
      source = DUTY_RULE_SOURCES[family].onCall;
      const day = Temporal.PlainDate.from(shift.date);
      const endWork = employmentProfileAt(
        profile,
        end.subtract({ milliseconds: 1 }).toPlainDate().toString(),
      );
      hourlyCents = specialDutyHourlyCents(shift.date, work, resolver);
      const endRate = specialDutyHourlyCents(
        end.subtract({ milliseconds: 1 }).toPlainDate().toString(),
        endWork,
        resolver,
      );
      if (hourlyCents === null || endRate === null)
        notes.push("Das tarifliche Stundenentgelt fehlt.");
      else if (endRate !== hourlyCents || dutyTariffFamily(endWork) !== family)
        notes.push("Die Berechnungsgrundlage wechselt während der Rufbereitschaft.");
      else {
        // A holiday calendar is necessary only where it can alter the flat rate.
        const weekendOrHoliday =
          day.dayOfWeek >= 6 ||
          (family !== "TVUK" &&
            durationMinutes >= 720 &&
            getPublicHolidays(day.year, work.federalState, resolver, work.holidayRegion).some(
              (holiday) => holiday.date === shift.date,
            ));
        paidHours = onCallBaseHours(family, durationMinutes, weekendOrHoliday);
        if (paidHours !== null) {
          // TV-UK §12(2) uses overtime remuneration, i.e. the table rate plus 25%.
          baseAmountCents = Math.round(paidHours * hourlyCents * (family === "TVUK" ? 1.25 : 1));
        }
      }
    }
  } catch {
    notes.push("Tarif-, Zeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden.");
  }
  if (duty.kind === "ON_CALL") {
    if (!duty.calloutsComplete)
      notes.push(
        "Bestätige noch, ob alle Einsätze erfasst sind oder kein Einsatz stattgefunden hat.",
      );
    if (duty.callouts.length)
      notes.push("Einsatzvergütung und Zuschläge sind zusätzlich zur Pauschale noch offen.");
    if (duty.settlement === "TIME_OFF")
      notes.push("Die vereinbarte Umwandlung in Freizeit ist noch offen.");
  }
  return {
    shiftId: shift.id,
    date: shift.date,
    title: DUTY_LABELS[duty.kind],
    source,
    durationMinutes,
    paidHours,
    hourlyCents,
    baseAmountCents,
    complete: notes.length === 0 && baseAmountCents !== null,
    notes,
  };
}

export function calculateSpecialDutyPay(
  month: string,
  shifts: readonly ShiftEntry[],
  profile: UserProfile,
  resolver: RuleResolver,
): readonly SpecialDutyPayLine[] {
  const ids = new Set<string>();
  return shifts
    .filter((shift) => {
      if (
        shift.deletedAt !== null ||
        !shift.specialDuty ||
        shift.specialDuty.kind === "SPLIT" ||
        ids.has(shift.id) ||
        !dutyCalendarDates(shift).some((date) => date.startsWith(month))
      )
        return false;
      ids.add(shift.id);
      return true;
    })
    .map((shift) => calculateDutyBase(shift, profile, resolver));
}
