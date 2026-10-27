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
import { tvUkDayAdjustment } from "./working-time-target-tvuk-day";
import {
  TARGET_RULES,
  isReviewedTargetTariff,
  reviewedTargetTariffRules,
  knownTargetTariffRules,
  type TargetRuleSource,
  type TargetTariffRules,
} from "@/engine/working-time-target-rules";
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

const LEGACY_CACHE = new WeakMap<RuleResolver, Map<string, MonthlyWorkingTimeTarget>>();

function line(
  date: string,
  kind: TargetAdjustment["kind"],
  label: string,
  numerator: number,
  rule: TargetRuleSource,
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
  rules: TargetTariffRules,
  automaticReference?: number,
  eligibilityVerified = true,
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
    eligibilityVerified &&
    fact?.rosterStatus === "FINAL" &&
    fact.lostMinutes != null &&
    (fact.disposition === "RELEASED" ||
      (fact.disposition === "ROSTER_FREE" && fact.mustWorkElsewhere === true));
  return line(
    date,
    "TARIFF_SPECIAL_DAY",
    label,
    eligible ? fact.lostMinutes! * 5 : (automaticReference ?? 0),
    automaticReference !== undefined ? rules.specialForecast : rules.special,
    eligible
      ? fact.disposition === "RELEASED"
        ? "Bestätigte Freistellung und ausgefallene Arbeitszeit"
        : "Bestätigt dienstplanmäßig frei; ohne Verminderung nachzuarbeiten; ausgefallene Stunden bestätigt"
      : automaticReference !== undefined
        ? "Automatischer Planwert: Freistellung oder planmäßig frei mit Nacharbeit angenommen; gleichmäßige Referenzstunden. Individuelle Ausfallstunden können abweichen."
        : "Abschließender Dienstplan und ausgefallene Stunden beziehungsweise Nacharbeitspflicht fehlen",
    eligible ? "CONFIRMED" : automaticReference !== undefined ? "PROFILE_ESTIMATE" : "PENDING",
  );
}

function rotatingHoliday(
  date: string,
  label: string,
  weeklyMinutes: number,
  fact: TargetDayFact | undefined,
  rules: TargetTariffRules,
  notice: (value: TargetNotice) => void,
  profileEstimate = false,
  eligibilityVerified = true,
): RawAdjustment | null {
  if (
    rules.holidayWork.kind === "SEPARATE_COMPENSATION" &&
    fact?.rosterStatus === "FINAL" &&
    fact.disposition === "WORK_REQUIRED"
  ) {
    notice({
      date,
      code: "HOLIDAY_TIME_OFF_SEPARATE",
      affectsTarget: false,
      message:
        "Feiertagsarbeit: Freizeitausgleich nach " +
        rules.holidayWork.legalBasis +
        " getrennt prüfen; kein pauschaler Fünftelabzug von der Sollzeit.",
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
    eligibilityVerified &&
    fact?.rosterStatus === "FINAL" &&
    (fact.disposition === "WORK_REQUIRED" ||
      (fact.disposition === "ROSTER_FREE" && fact.mustWorkElsewhere === true));
  return line(
    date,
    "STATUTORY_HOLIDAY",
    label,
    eligible || profileEstimate ? weeklyMinutes : 0,
    profileEstimate ? rules.holidayForecast : rules.holiday,
    eligible
      ? fact.disposition === "WORK_REQUIRED"
        ? "Bestätigter 7-Tage-Schichtplan und Arbeitspflicht am Werktagsfeiertag"
        : "Bestätigter 7-Tage-Schichtplan; dienstplanmäßig frei, nicht wegen des Feiertags; regelmäßige Arbeitszeit andernorts zu erbringen"
      : profileEstimate
        ? rules.holidayWork.kind === "SEPARATE_COMPENSATION"
          ? "Planungsreferenz für qualifiziert dienstplanmäßig freie Werktagsfeiertage: ein Fünftel der Wochenstunden. Kein bestätigter Tagesanspruch; Feiertagsarbeit und Freizeitausgleich werden getrennt behandelt."
          : "Monatsprognose im 7-Tage-Modell: ein Fünftel der Wochenstunden je Werktagsfeiertag, unabhängig von eingetragenen Diensten."
        : "Anspruch nach " +
          rules.holiday.legalBasis +
          " nicht abschließend bestätigt; Freistellung und Zeitgutschrift gegebenenfalls separat prüfen",
    eligible ? "CONFIRMED" : profileEstimate ? "PROFILE_ESTIMATE" : "PENDING",
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
  const input = profile.workingTimeTarget;
  if (input && input.status !== "ready")
    throw new WorkingTimeTargetError(
      input.status === "loading"
        ? "Die Arbeitszeitangaben werden geladen."
        : "Die Arbeitszeitangaben konnten nicht geladen werden. Bitte erneut versuchen.",
    );
  context ??= input?.context;
  validateTargetInputs(month, profile, context);
  const cacheKey = `${month}/${profile.federalState}/${profile.holidayRegion ?? "NONE"}/${profile.weeklyMinutes}`;
  const cacheable = context === undefined && input === undefined;
  const cached = cacheable ? LEGACY_CACHE.get(resolver)?.get(cacheKey) : undefined;
  if (cached) return cached;
  const first = Temporal.PlainYearMonth.from(month);
  const forecast = input?.mode === "FORECAST";
  const facts = new Map(forecast ? [] : context?.days.map((day) => [day.date, day]));
  const notices: TargetNotice[] = [...(input?.notices ?? [])];
  const noticeKeys = new Set<string>();
  const notice = (item: TargetNotice) => {
    const key = `${item.code}/${item.date}`;
    if (!noticeKeys.has(key)) {
      noticeKeys.add(key);
      notices.push(item);
    }
  };
  if (forecast)
    notice({
      date: null,
      code: "CONTRACTUAL_TARGET_FORECAST",
      message:
        "Sollzeit-Prognose aus den Beschäftigungsangaben. Einzelne Dienste, Zeitgutschriften und Freizeitausgleich werden getrennt berechnet.",
      affectsTarget: true,
    });
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
    const supportedTariff = isReviewedTargetTariff(tariff);
    const reviewedRules = supportedTariff ? reviewedTargetTariffRules(tariff, date) : null;
    const verifiedTariff =
      reviewedRules !== null && supportedTariff && tariff.scopeConfirmed === true;
    const forecastTariff =
      forecast && reviewedRules !== null && supportedTariff && tariff.scopeConfirmed !== false;
    if (
      forecastTariff &&
      holiday &&
      plainDate.dayOfWeek <= 6 &&
      period?.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
      period.model.sevenDayShiftPlanConfirmed !== false &&
      reviewedRules.holidayWork.kind === "SEPARATE_COMPENSATION"
    )
      notice({
        date: null,
        code: "CONDITIONAL_ROSTER_FREE_FORECAST",
        affectsTarget: true,
        message:
          reviewedRules.label +
          ": " +
          (reviewedRules.forecastQualifier ??
            "Planwert für dienstplanmäßig freie Feiertage. Feiertagsarbeit und Freizeitausgleich werden getrennt geprüft."),
      });
    // New family recognition must retain the old provisional reference outside review coverage.
    const legacyInferredForecast =
      forecast &&
      (tariff?.kind === "TVOED_B" ||
        tariff?.kind === "TVL_KR" ||
        tariff?.kind === "TVH_KR" ||
        tariff?.kind === "TVUK_NURSING") &&
      tariff.scopeConfirmed === null &&
      !reviewedRules;
    if (period) tariffNotices(period, reviewedRules !== null, notice);
    if (
      period &&
      tariff?.kind === "TVUK_NURSING" &&
      !legacyInferredForecast &&
      (period.model.kind !== "UNKNOWN" || tariff.accountRuleConfirmed === true)
    ) {
      const adjustment = tvUkDayAdjustment({
        date,
        weekday: plainDate.dayOfWeek,
        holiday,
        period,
        tariff,
        fact,
        rules: reviewedRules ?? knownTargetTariffRules(tariff.kind),
        reviewed: reviewedRules !== null,
        forecast,
        notice,
      });
      if (adjustment) adjustments.push(adjustment);
      raw.push({ date, base, adjustments, unavailable: false });
      continue;
    }
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
        supportedTariff &&
        !legacyInferredForecast &&
        plainDate.dayOfWeek <= 6
      ) {
        const verified = verifiedTariff && period.model.sevenDayShiftPlanConfirmed === true;
        const adjustment = rotatingHoliday(
          date,
          holiday,
          settings.weeklyMinutes,
          fact,
          reviewedRules ?? knownTargetTariffRules(tariff.kind),
          notice,
          forecastTariff && period.model.sevenDayShiftPlanConfirmed !== false,
          verified,
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
        (verifiedTariff || forecastTariff) &&
        plainDate.dayOfWeek <= 6 &&
        (fixed
          ? base > 0
          : period?.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
            (period.model.sevenDayShiftPlanConfirmed === true ||
              (forecastTariff && period.model.sevenDayShiftPlanConfirmed !== false)))
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
          reviewedRules!,
          forecastTariff ? (fixed ? base : settings.weeklyMinutes) : undefined,
          verifiedTariff &&
            (fixed !== null ||
              (period?.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
                period.model.sevenDayShiftPlanConfirmed === true)),
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
  if (cacheable) {
    const cache = LEGACY_CACHE.get(resolver) ?? new Map<string, MonthlyWorkingTimeTarget>();
    cache.set(cacheKey, result);
    LEGACY_CACHE.set(resolver, cache);
  }
  return result;
}

function tariffNotices(
  period: TargetProfilePeriod,
  reviewed: boolean,
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
  if (isReviewedTargetTariff(tariff)) {
    const rules = knownTargetTariffRules(tariff.kind);
    if (tariff.scopeConfirmed !== true)
      notice({
        date: at,
        code: "TARIFF_SCOPE_UNCONFIRMED",
        message: "Die Geltung des " + rules.label + " ist nicht bestätigt.",
        affectsTarget: true,
      });
    if (!reviewed)
      notice({
        date: at,
        code: "TARIFF_VERSION_UNREVIEWED",
        message:
          "Für Tarifstand oder Berechnungsdatum liegt noch keine geprüfte Sollzeitregel vor.",
        affectsTarget: true,
      });
    if (
      tariff.kind !== "TVUK_NURSING" &&
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
