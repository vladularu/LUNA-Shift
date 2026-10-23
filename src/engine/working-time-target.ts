import { Temporal } from "@js-temporal/polyfill";

import { holidayRegionsForState } from "@/domain/employment-profile";
import type {
  DailyWorkingTimeTarget,
  MonthlyWorkingTimeTarget,
  TargetAdjustment,
  TargetDayFact,
  TargetNotice,
  TargetProfilePeriod,
  WorkingTimeTargetContext,
  WorkingTimeTargetProfile,
} from "@/domain/working-time-target";
import { getPublicHolidays } from "@/engine/holidays";
import { TARGET_RULES, TVOED_K_TARGET_REVIEW } from "@/engine/working-time-target-rules";
import { validateTargetInputs, WorkingTimeTargetError } from "@/engine/working-time-target-input";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";

interface RawAdjustment extends Omit<TargetAdjustment, "minutes"> {
  /** Integer numerator of minutes / 5; never accumulate floating point hours. */
  readonly numerator: number;
}
interface RawDay {
  readonly date: string;
  readonly base: number;
  readonly unavailable: boolean;
  readonly adjustments: readonly RawAdjustment[];
}

type TargetRule = (typeof TARGET_RULES)[keyof typeof TARGET_RULES];
const LEGACY_CACHE = new WeakMap<RuleResolver, Map<string, MonthlyWorkingTimeTarget>>();

function line(
  date: string,
  kind: TargetAdjustment["kind"],
  label: string,
  numerator: number,
  rule: TargetRule,
  condition: string,
  status: TargetAdjustment["status"] = "CONFIRMED",
): RawAdjustment {
  return { date, kind, label, numerator, ...rule, condition, status };
}

function specialReduction(
  date: string,
  label: string,
  fact: TargetDayFact | undefined,
  notice: (value: TargetNotice) => void,
): RawAdjustment | null {
  if (fact?.rosterStatus === "FINAL" && fact.disposition === "WORK_REQUIRED") {
    notice({
      date,
      code: "COMPENSATORY_LEAVE_SEPARATE",
      message:
        "Arbeit am tariflichen Sondertag: Freizeitausgleich nach § 6 Abs. 3 Satz 2 separat prüfen. Kein Abzug allein wegen der Arbeitsleistung.",
      affectsTarget: false,
    });
    return null;
  }
  if (
    fact?.rosterStatus === "FINAL" &&
    fact.disposition === "ROSTER_FREE" &&
    fact.mustWorkElsewhere === false
  )
    return null;
  const eligible =
    fact?.rosterStatus === "FINAL" &&
    fact.lostMinutes != null &&
    (fact.disposition === "RELEASED" ||
      (fact.disposition === "ROSTER_FREE" && fact.mustWorkElsewhere === true));
  return line(
    date,
    "TARIFF_SPECIAL_DAY",
    label,
    eligible ? fact.lostMinutes! * 5 : 0,
    TARGET_RULES.tvoedKSpecial,
    eligible
      ? fact.disposition === "RELEASED"
        ? "Bestätigte Freistellung und ausgefallene Arbeitszeit"
        : "Bestätigt dienstplanmäßig frei; ohne Verminderung nachzuarbeiten; ausgefallene Stunden bestätigt"
      : "Abschließender Dienstplan und ausgefallene Stunden beziehungsweise Nacharbeitspflicht fehlen",
    eligible ? "CONFIRMED" : "PENDING",
  );
}

function rotatingHoliday(
  date: string,
  label: string,
  weeklyMinutes: number,
  fact: TargetDayFact | undefined,
): RawAdjustment | null {
  if (
    fact?.rosterStatus === "FINAL" &&
    fact.disposition === "ROSTER_FREE" &&
    fact.mustWorkElsewhere === false
  )
    return null;
  const eligible =
    fact?.rosterStatus === "FINAL" &&
    (fact.disposition === "WORK_REQUIRED" ||
      (fact.disposition === "ROSTER_FREE" && fact.mustWorkElsewhere === true));
  return line(
    date,
    "STATUTORY_HOLIDAY",
    label,
    eligible ? weeklyMinutes : 0,
    TARGET_RULES.tvoedKHoliday,
    eligible
      ? fact.disposition === "WORK_REQUIRED"
        ? "Bestätigter 7-Tage-Schichtplan und Arbeitspflicht am Werktagsfeiertag"
        : "Bestätigter 7-Tage-Schichtplan; dienstplanmäßig frei, nicht wegen des Feiertags; regelmäßige Arbeitszeit andernorts zu erbringen"
      : "Anspruch nach BT-K § 49 Abs. 2 nicht abschließend bestätigt; Freistellung und Zeitgutschrift gegebenenfalls separat prüfen",
    eligible ? "CONFIRMED" : "PENDING",
  );
}

function roundLedger(
  month: string,
  raw: readonly RawDay[],
  notices: readonly TargetNotice[],
): MonthlyWorkingTimeTarget {
  let base = 0,
    statutory = 0,
    tariff = 0,
    previousBase = 0,
    previousStatutory = 0,
    previousTariff = 0,
    previousTarget = 0;
  const adjustments: TargetAdjustment[] = [];
  const days: DailyWorkingTimeTarget[] = [];
  for (const day of raw) {
    base += day.base;
    let statutoryMinutes = 0,
      tariffMinutes = 0;
    for (const adjustment of day.adjustments) {
      const isStatutory = adjustment.kind === "STATUTORY_HOLIDAY";
      const before = isStatutory ? statutory : tariff;
      if (isStatutory) statutory += adjustment.numerator;
      else tariff += adjustment.numerator;
      const minutes = Math.round((before + adjustment.numerator) / 5) - Math.round(before / 5);
      if (isStatutory) statutoryMinutes += minutes;
      else tariffMinutes += minutes;
      const { numerator: _numerator, ...detail } = adjustment;
      adjustments.push(Object.freeze({ ...detail, minutes }));
    }
    const nextBase = Math.round(base / 5),
      nextStatutory = Math.round(statutory / 5),
      nextTariff = Math.round(tariff / 5);
    const nextTarget = Math.round((base - statutory - tariff) / 5);
    const baseMinutes = nextBase - previousBase;
    const targetMinutes = nextTarget - previousTarget;
    days.push(
      Object.freeze({
        date: day.date,
        baseMinutes,
        statutoryReductionMinutes: statutoryMinutes,
        tariffReductionMinutes: tariffMinutes,
        roundingMinutes: targetMinutes - baseMinutes + statutoryMinutes + tariffMinutes,
        targetMinutes: day.unavailable ? null : targetMinutes,
      }),
    );
    previousBase = nextBase;
    previousStatutory = nextStatutory;
    previousTariff = nextTariff;
    previousTarget = nextTarget;
  }
  const unavailable = raw.some((day) => day.unavailable) || previousTarget < 0;
  const pending =
    adjustments.some((adjustment) => adjustment.status !== "CONFIRMED") ||
    notices.some((notice) => notice.affectsTarget);
  return Object.freeze({
    month,
    status: unavailable ? "UNAVAILABLE" : pending ? "PROVISIONAL" : "FINAL",
    baseMinutes: previousBase,
    statutoryReductionMinutes: previousStatutory,
    tariffReductionMinutes: previousTariff,
    roundingMinutes: previousTarget - previousBase + previousStatutory + previousTariff,
    targetMinutes: unavailable ? null : previousTarget,
    adjustments: Object.freeze(adjustments),
    notices: Object.freeze(notices.map((notice) => Object.freeze(notice))),
    days: Object.freeze(days),
  });
}

/** One engine for daily/monthly target accounting. Actual work and absence credits stay separate. */
export function calculateMonthlyWorkingTimeTarget(
  month: string,
  profile: WorkingTimeTargetProfile,
  resolver: RuleResolver = bundledRuleResolver,
  context?: WorkingTimeTargetContext,
): MonthlyWorkingTimeTarget {
  validateTargetInputs(month, profile, context);
  const cacheKey = `${month}/${profile.federalState}/${profile.holidayRegion ?? "NONE"}/${profile.weeklyMinutes}`;
  const cached = context === undefined ? LEGACY_CACHE.get(resolver)?.get(cacheKey) : undefined;
  if (cached) return cached;
  const first = Temporal.PlainYearMonth.from(month);
  const facts = new Map(context?.days.map((day) => [day.date, day]));
  const notices: TargetNotice[] = [];
  const noticeKeys = new Set<string>();
  const notice = (item: TargetNotice) => {
    const key = `${item.code}/${item.date}`;
    if (!noticeKeys.has(key)) {
      noticeKeys.add(key);
      notices.push(item);
    }
  };
  if (!context)
    notice({
      date: null,
      code: "LEGACY_WORK_MODEL_UNKNOWN",
      message:
        "Vorläufige Montag-bis-Freitag-Referenz: Arbeitszeitmodell, historische Geltung und tarifliche Ansprüche sind nicht bestätigt.",
      affectsTarget: true,
    });
  const holidayMaps = new Map<string, ReadonlyMap<string, string>>();
  const raw: RawDay[] = [];
  for (let day = 1; day <= first.daysInMonth; day++) {
    const plainDate = first.toPlainDate({ day }),
      date = plainDate.toString();
    const empty: RawDay = { date, base: 0, unavailable: false, adjustments: [] };
    if (
      context?.employment &&
      (date < context.employment.from ||
        (context.employment.to !== null && date > context.employment.to))
    ) {
      raw.push(empty);
      continue;
    }
    const period = context?.periods.find(
      (period) => period.validFrom <= date && (period.validTo === null || date <= period.validTo),
    );
    if (context && !period) {
      notice({
        date,
        code: "WORK_PROFILE_MISSING",
        message: "Für diesen Tag fehlen historische Arbeitszeitangaben.",
        affectsTarget: true,
      });
      raw.push({ ...empty, unavailable: true });
      continue;
    }
    const settings = period ?? profile;
    const fixed = period?.model.kind === "FIXED_WEEK" ? period.model : null;
    const base = fixed
      ? fixed.weekdayMinutes[plainDate.dayOfWeek - 1] * 5
      : plainDate.dayOfWeek <= 5
        ? settings.weeklyMinutes
        : 0;
    if (context && holidayRegionsForState(settings.federalState).length > 1) {
      const holidayPackage = resolver.resolveHoliday(date);
      const regionUnknown = settings.holidayRegion === "UNKNOWN";
      if (regionUnknown || (holidayPackage.ok && holidayPackage.value.engineContractVersion < 2)) {
        notice({
          date: period!.validFrom,
          code: regionUnknown ? "HOLIDAY_REGION_UNKNOWN" : "HOLIDAY_REGION_UNSUPPORTED",
          message: regionUnknown
            ? "Die Feiertagsregion des Arbeitsorts ist nicht bestätigt."
            : "Für diesen Arbeitsort ist ein Feiertagskatalog mit geprüften regionalen Regeln erforderlich.",
          affectsTarget: true,
        });
        raw.push({ date, base, unavailable: true, adjustments: [] });
        continue;
      }
    }
    const holidayKey = `${settings.federalState}/${settings.holidayRegion ?? "NONE"}`;
    let holidays = holidayMaps.get(holidayKey);
    if (!holidays) {
      holidays = new Map(
        getPublicHolidays(
          first.year,
          settings.federalState,
          resolver,
          settings.holidayRegion ?? "NONE",
        ).map((holiday) => [holiday.date, holiday.name]),
      );
      holidayMaps.set(holidayKey, holidays);
    }
    const holiday = holidays.get(date),
      fact = facts.get(date);
    const adjustments: RawAdjustment[] = [];
    const tariff = period?.tariff;
    const tvoedK =
      tariff?.kind === "TVOED_K" &&
      tariff.scopeConfirmed === true &&
      tariff.version === TVOED_K_TARGET_REVIEW.version &&
      date >= TVOED_K_TARGET_REVIEW.from &&
      date <= TVOED_K_TARGET_REVIEW.to;
    if (period) tariffNotices(period, date, notice);
    if (holiday) {
      if (fixed && base > 0) {
        if (
          fact?.rosterStatus === "DRAFT" ||
          fact?.disposition === "UNKNOWN" ||
          fact?.disposition === "ROSTER_FREE"
        ) {
          adjustments.push(
            line(
              date,
              "STATUTORY_HOLIDAY",
              holiday,
              0,
              TARGET_RULES.fixedHoliday,
              "Abweichender oder unvollständiger Dienstplan am festen Arbeitstag",
              "PENDING",
            ),
          );
        } else if (fact?.disposition === "WORK_REQUIRED") {
          notice({
            date,
            code: "HOLIDAY_TIME_OFF_SEPARATE",
            message:
              "Feiertagsarbeit außerhalb der bestätigten 7-Tage-Regel: Freizeitausgleich und Zeitkonto separat prüfen.",
            affectsTarget: true,
          });
        } else {
          const loss = fact?.lostMinutes == null ? base : fact.lostMinutes * 5;
          if (loss > base) throw new WorkingTimeTargetError();
          adjustments.push(
            line(
              date,
              "STATUTORY_HOLIDAY",
              holiday,
              loss,
              TARGET_RULES.fixedHoliday,
              "Feste vertragliche Tagesverteilung; reguläre Arbeitszeit fällt wegen des Feiertags aus",
            ),
          );
        }
      } else if (
        period?.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
        tariff?.kind === "TVOED_K" &&
        plainDate.dayOfWeek <= 6
      ) {
        const verified = tvoedK && period.model.sevenDayShiftPlanConfirmed === true;
        const adjustment = rotatingHoliday(
          date,
          holiday,
          settings.weeklyMinutes,
          verified ? fact : undefined,
        );
        if (adjustment) adjustments.push(adjustment);
      } else if (!fixed && base > 0) {
        adjustments.push(
          line(
            date,
            "STATUTORY_HOLIDAY",
            holiday,
            base,
            TARGET_RULES.legacyHoliday,
            "Unbestätigte bisherige Referenzverteilung",
            "LEGACY_ESTIMATE",
          ),
        );
      }
    } else if (date.endsWith("-12-24") || date.endsWith("-12-31")) {
      if (
        tvoedK &&
        plainDate.dayOfWeek <= 6 &&
        (fixed
          ? base > 0
          : period?.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
            period.model.sevenDayShiftPlanConfirmed === true)
      ) {
        if (fixed && fact?.lostMinutes != null && fact.lostMinutes * 5 > base)
          throw new WorkingTimeTargetError();
        const adjustment = specialReduction(
          date,
          date.endsWith("-24")
            ? "Heiligabend (tariflicher Sondertag)"
            : "Silvester (tariflicher Sondertag)",
          fact,
          notice,
        );
        if (adjustment) adjustments.push(adjustment);
      }
    }
    raw.push({ date, base, adjustments, unavailable: false });
  }
  const result = roundLedger(month, raw, notices);
  if (result.targetMinutes === null && !raw.some((day) => day.unavailable)) {
    notice({
      date: null,
      code: "NEGATIVE_MONTH_TARGET",
      message:
        "Die bestätigte Referenzverteilung und die Abzüge ergeben eine negative Monatssollzeit. Betriebliche Teilmonatsberechnung prüfen.",
      affectsTarget: true,
    });
    return roundLedger(month, raw, notices);
  }
  if (!context) {
    const cache = LEGACY_CACHE.get(resolver) ?? new Map<string, MonthlyWorkingTimeTarget>();
    cache.set(cacheKey, result);
    LEGACY_CACHE.set(resolver, cache);
  }
  return result;
}

function tariffNotices(
  period: TargetProfilePeriod,
  date: string,
  notice: (value: TargetNotice) => void,
): void {
  const tariff = period.tariff;
  const at = period.validFrom;
  if (period.model.kind === "UNKNOWN")
    notice({
      date: at,
      code: "WORK_MODEL_UNKNOWN",
      message: "Die Verteilung der Arbeitszeit ist nicht bestätigt; nur Referenzberechnung.",
      affectsTarget: true,
    });
  if (tariff.kind === "UNVERIFIED")
    notice({
      date: at,
      code: "TARIFF_UNSUPPORTED",
      message: `Die Sollzeit-Sonderregeln für ${tariff.id} sind noch nicht angebunden.`,
      affectsTarget: true,
    });
  if (tariff.kind === "CUSTOM" && period.model.kind === "ROTATING_FIVE_IN_SEVEN")
    notice({
      date: at,
      code: "CUSTOM_ROTATING_REFERENCE",
      message:
        "Eigene Vergütung im wechselnden Dienstplan: gesetzliche Ausfallzeiten und betriebliche Referenzberechnung prüfen; keine zusätzlichen Tarifansprüche angesetzt.",
      affectsTarget: true,
    });
  if (tariff.kind === "TVOED_K") {
    if (tariff.scopeConfirmed !== true)
      notice({
        date: at,
        code: "TARIFF_SCOPE_UNCONFIRMED",
        message: "Die Geltung des TVöD-K / BT-K ist nicht bestätigt.",
        affectsTarget: true,
      });
    if (
      tariff.version !== TVOED_K_TARGET_REVIEW.version ||
      date < TVOED_K_TARGET_REVIEW.from ||
      date > TVOED_K_TARGET_REVIEW.to
    )
      notice({
        date: at,
        code: "TARIFF_VERSION_UNREVIEWED",
        message:
          "Für Tarifstand oder Berechnungsdatum liegt noch keine geprüfte Sollzeitregel vor.",
        affectsTarget: true,
      });
    if (
      period.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
      period.model.sevenDayShiftPlanConfirmed !== true
    )
      notice({
        date: at,
        code: "SEVEN_DAY_PLAN_UNCONFIRMED",
        message:
          "Ein regelmäßiger Schicht- oder Wechselschichtdienstplan an sieben Wochentagen ist nicht bestätigt.",
        affectsTarget: true,
      });
  }
}

export function requireTargetMinutes(result: MonthlyWorkingTimeTarget): number {
  if (result.targetMinutes === null)
    throw new WorkingTimeTargetError(
      "Die Sollarbeitszeit ist wegen fehlender oder widersprüchlicher historischer Angaben nicht verfügbar.",
    );
  return result.targetMinutes;
}
