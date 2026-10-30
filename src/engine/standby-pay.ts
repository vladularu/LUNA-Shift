import { Temporal } from "@js-temporal/polyfill";
import { clockMinute, dutyInstant } from "@/domain/special-duty";
import { employmentProfileAt } from "@/domain/employment-history";
import type { StandbyPay } from "@/domain/special-duty-pay";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import { standbyHourlyRate } from "./standby-hourly-rate";
import { standbyNormalFactor, dutyTariffFamily, DUTY_RULE_SOURCES } from "./special-duty-tariff";
import { specialDutyWorkMinutes } from "./special-duty";
import { getPublicHolidays } from "./holidays";

export function calculateStandbyPay(
  shift: ShiftEntry,
  profile: UserProfile,
  resolver: RuleResolver,
): StandbyPay {
  const actualMinutes = specialDutyWorkMinutes(shift);
  const unknown = (note: string): StandbyPay => ({
    actualMinutes,
    weightedMinutes: null,
    factorBasisPoints: null,
    hourlyCents: null,
    payGroup: null,
    baseAmountCents: null,
    overtimePremiumCents: null,
    nightPremiumCents: null,
    holidayPremiumCents: null,
    sundayPremiumCents: null,
    cashAmountCents: null,
    timeCreditMinutes: null,
    mandatoryRestMinutes: null,
    notes: [note],
  });
  const duty = shift.specialDuty;
  const agreement = duty?.standbyAgreement;
  if (duty?.kind !== "STANDBY" || !agreement || agreement.rule === "UNKNOWN")
    return unknown("Ergänze die Abrechnungsgrundlage für deinen Bereitschaftsdienst.");
  const work = employmentProfileAt(profile, shift.date);
  const family = dutyTariffFamily(work);
  if (!family || family !== agreement.tariff)
    return unknown("Die gespeicherte Bereitschaftsregelung passt nicht zum Tarif an diesem Tag.");
  if (agreement.rule === "CARE" && family !== "TVOED_K" && family !== "TVOED_B")
    return unknown("Diese Sonderbewertung gehört nicht zum gewählten Tarif.");
  const start = dutyInstant(shift.date, clockMinute(shift.startTime!), duty.timeZone);
  const end = dutyInstant(
    shift.date,
    duty.endDay * 1440 + clockMinute(shift.endTime!),
    duty.timeZone,
  );
  const lastDate = end.subtract({ milliseconds: 1 }).toPlainDate().toString();
  const elapsedMinutes = Number(end.epochMilliseconds - start.epochMilliseconds) / 60000;
  if (
    elapsedMinutes <= 0 ||
    elapsedMinutes > 1440 ||
    shift.date.slice(0, 7) !== lastDate.slice(0, 7)
  )
    return unknown(
      "Bereitschaft über 24 Stunden oder eine Monatsgrenze: die Aufteilung ist noch offen.",
    );
  if (
    !Number.isSafeInteger(shift.breakMinutes) ||
    shift.breakMinutes < 0 ||
    !Number.isFinite(actualMinutes) ||
    actualMinutes <= 0 ||
    actualMinutes > elapsedMinutes
  )
    return unknown("Prüfe die Dauer und Pausenangabe deines Bereitschaftsdienstes.");
  if (shift.date < DUTY_RULE_SOURCES[family].version || lastDate > "2026-12-31")
    return unknown("Für diesen Zeitraum fehlen geprüfte Bereitschaftsregeln.");
  let factor: number | null;
  if (agreement.rule === "CARE") {
    if (family === "TVOED_K") factor = duty.standbyLevel === "I" ? 0.285 : null;
    else
      factor =
        ["A", "B"].includes(duty.standbyLevel) && agreement.sequence !== null
          ? agreement.sequence <= 8
            ? 0.25
            : 0.4
          : null;
  } else
    factor = standbyNormalFactor({
      family,
      level: duty.standbyLevel,
      ordinal: agreement.sequence,
      normalCaseConfirmed: true,
      date: shift.date,
    });
  if (factor === null)
    return unknown(
      "Prüfe die Bereitschaftsstufe und gegebenenfalls die Nummer des Dienstes im Monat.",
    );
  const rate = standbyHourlyRate(shift.date, work, agreement, resolver);
  const lastWork = employmentProfileAt(profile, lastDate);
  const lastRate = standbyHourlyRate(lastDate, lastWork, agreement, resolver);
  if (!rate || !lastRate)
    return unknown(
      work.nursingTrainingTariff || work.tvalPflegeTariff
        ? "Für deine Ausbildung: Öffne Abrechnung, tippe auf Stundenentgelt und trage den bestätigten Grundstundensatz deines Arbeitgebers ohne Zuschläge ein."
        : "Die Bereitschaftsgruppe oder das vereinbarte Stundenentgelt fehlt.",
    );
  if (
    JSON.stringify(rate) !== JSON.stringify(lastRate) ||
    work.federalState !== lastWork.federalState ||
    work.holidayRegion !== lastWork.holidayRegion
  )
    return unknown("Die Berechnungsgrundlage wechselt während des Bereitschaftsdienstes.");
  if (duty.settlement === "UNKNOWN")
    return unknown(
      "Wähle noch, ob dein Bereitschaftsdienst ausgezahlt oder in Freizeit ausgeglichen wird.",
    );
  if (
    duty.settlement === "TIME_OFF" &&
    (agreement.timeOffMode === "UNKNOWN" ||
      (agreement.timeOffMode === "FACTORIZED" && family !== "TVOED_K"))
  )
    return unknown("Ergänze das vereinbarte Verfahren für den Freizeitausgleich.");

  // Split at local tariff boundaries; elapsed instants preserve daylight-saving time.
  const boundaries = new Set<number>([
    Number(start.epochMilliseconds),
    Number(end.epochMilliseconds),
  ]);
  for (let day = 0; day <= duty.endDay; day++) {
    for (const hour of [0, 4, 6, family === "TVUK" ? 20 : 21, 24]) {
      const at = Number(
        dutyInstant(shift.date, day * 1440 + hour * 60, duty.timeZone).epochMilliseconds,
      );
      if (at > start.epochMilliseconds && at < end.epochMilliseconds) boundaries.add(at);
    }
  }
  const points = [...boundaries].sort((a, b) => a - b);
  let night = 0,
    deepNight = 0,
    holiday = 0,
    sunday = 0;
  const holidays = new Set(
    getPublicHolidays(start.year, work.federalState, resolver, work.holidayRegion).map(
      (item) => item.date,
    ),
  );
  const periodTypes = new Set<string>();
  for (let i = 1; i < points.length; i++) {
    const local = Temporal.Instant.fromEpochMilliseconds(points[i - 1]).toZonedDateTimeISO(
      duty.timeZone,
    );
    const minutes = (points[i] - points[i - 1]) / 60000;
    // Only boundaries that change this tariff's remuneration need a break position.
    const inNight =
      (family === "TVUK" || family === "TVOED_K" || family === "TVOED_B") &&
      (local.hour < 6 || local.hour >= (family === "TVUK" ? 20 : 21));
    const inDeepNight = family === "TVUK" && local.hour < 4;
    const onHoliday =
      (family === "TVOED_K" || family === "TVL_43" || family === "TVH_43") &&
      holidays.has(local.toPlainDate().toString());
    const onSunday = family === "TVUK" && local.dayOfWeek === 7;
    periodTypes.add([inNight, inDeepNight, onHoliday, onSunday].join(","));
    if (inNight) night += minutes;
    if (inDeepNight) deepNight += minutes;
    if (onHoliday) holiday += minutes;
    if (onSunday) sunday += minutes;
  }
  if (shift.breakMinutes) {
    if (periodTypes.size !== 1)
      return unknown(
        "Für die Zuordnung zu Nacht-, Sonn- oder Feiertagszeiten fehlt die genaue Lage der Pause. Die Abrechnung bleibt noch offen.",
      );
    // Each relevant period covers the entire service or none of it. Deduct the
    // declared duty-free break once, without assuming where it was taken.
    if (night) night -= shift.breakMinutes;
    if (deepNight) deepNight -= shift.breakMinutes;
    if (holiday) holiday -= shift.breakMinutes;
    if (sunday) sunday -= shift.breakMinutes;
  }
  const weightedMinutes =
    actualMinutes * factor + (family === "TVL_43" || family === "TVH_43" ? holiday * 0.25 : 0);
  const amount = (minutes: number, multiplier = 1) => {
    // Factors use at most four decimal places; keep fractional minutes exact.
    const numerator =
      BigInt(rate.cents) *
      BigInt(Math.round(minutes * 10000)) *
      BigInt(Math.round(multiplier * 10000));
    const denominator = 6000000000n;
    return Number((2n * numerator + denominator) / (2n * denominator));
  };
  const baseAmountCents = amount(weightedMinutes);
  const overtimePremiumCents = family === "TVUK" ? amount(weightedMinutes, 0.25) : 0;
  const nightPremiumCents =
    family === "TVUK"
      ? amount(night * factor, 0.2) + amount(deepNight * factor, 0.15)
      : family === "TVOED_K" || family === "TVOED_B"
        ? amount(night, 0.15)
        : 0;
  const holidayPremiumCents = family === "TVOED_K" ? amount(holiday * factor, 0.25) : 0;
  const sundayPremiumCents = family === "TVUK" ? amount(sunday * factor, 0.4) : 0;
  const mandatoryRestMinutes = family === "TVUK" ? night * factor * 0.05 : 0;
  let timeCreditMinutes = mandatoryRestMinutes;
  let cashAmountCents =
    baseAmountCents +
    overtimePremiumCents +
    nightPremiumCents +
    holidayPremiumCents +
    sundayPremiumCents;
  if (duty.settlement === "TIME_OFF") {
    if (family === "TVOED_K" && agreement.timeOffMode === "FACTORIZED") {
      const perHour =
        agreement.rule === "CARE"
          ? 17.5
          : ({ I: 37, II: 46, III: 55 } as const)[duty.standbyLevel as "I" | "II" | "III"];
      timeCreditMinutes = (actualMinutes * perHour) / 60 + holiday * 0.25 + night * 0.15;
    } else if (family === "TVUK")
      timeCreditMinutes = weightedMinutes * 1.25 + night * factor * 0.25 + sunday * factor * 0.4;
    else
      timeCreditMinutes =
        weightedMinutes +
        (family === "TVOED_K" ? holiday * factor * 0.25 : 0) +
        (family === "TVOED_K" || family === "TVOED_B" ? night * 0.15 : 0);
    // TV-UK's additional fifteen night percentage points cannot be converted.
    cashAmountCents = family === "TVUK" ? amount(deepNight * factor, 0.15) : 0;
  }
  const hasSfnCash =
    duty.settlement === "PAY"
      ? nightPremiumCents > 0 ||
        holidayPremiumCents > 0 ||
        sundayPremiumCents > 0 ||
        ((family === "TVL_43" || family === "TVH_43") && holiday > 0)
      : cashAmountCents > 0;
  return {
    actualMinutes,
    weightedMinutes,
    factorBasisPoints: Math.round(factor * 10000),
    hourlyCents: rate.cents,
    payGroup: rate.group,
    baseAmountCents,
    overtimePremiumCents,
    nightPremiumCents,
    holidayPremiumCents,
    sundayPremiumCents,
    cashAmountCents,
    timeCreditMinutes,
    mandatoryRestMinutes,
    notes: hasSfnCash
      ? [
          "Die Vergütung ist berechnet. Die steuerliche Behandlung der Nacht-, Sonn- oder Feiertagsanteile ist noch offen.",
        ]
      : [],
  };
}
