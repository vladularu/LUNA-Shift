import type {
  TargetAdjustment,
  TargetDayFact,
  TargetNotice,
  TargetProfilePeriod,
  TargetTariff,
} from "@/domain/working-time-target";
import { WorkingTimeTargetError } from "./working-time-target-input";
import type { TargetTariffRules } from "./working-time-target-rules";

/** A daily policy only. Month coverage, holiday catalog and rounding belong to the shared engine. */
export function tvUkDayAdjustment(input: {
  readonly date: string;
  readonly weekday: number;
  readonly holiday: string | undefined;
  readonly period: TargetProfilePeriod;
  readonly tariff: Extract<TargetTariff, { kind: "TVUK_NURSING" }>;
  readonly fact: TargetDayFact | undefined;
  readonly rules: TargetTariffRules;
  readonly reviewed: boolean;
  readonly forecast: boolean;
  readonly notice: (value: TargetNotice) => void;
}): (Omit<TargetAdjustment, "minutes"> & { readonly numerator: number }) | null {
  const { date, weekday, holiday, period, tariff, fact, rules, reviewed, forecast, notice } = input;
  const special = date.endsWith("-12-24") || date.endsWith("-12-31");
  if (!holiday && !special) return null;
  if (!rules.tvUkLoss) throw new WorkingTimeTargetError("Die TV-UK-Tagesregel fehlt.");
  const fixed = period.model.kind === "FIXED_WEEK" ? period.model : null;
  const fixedMinutes = fixed?.weekdayMinutes[weekday - 1];
  const confirmedShift =
    period.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
    period.model.sevenDayShiftPlanConfirmed === true;
  const account =
    tariff.accountRuleConfirmed === true ||
    (tariff.accountRuleConfirmed === null && confirmedShift);
  const accountForecast =
    forecast &&
    tariff.accountRuleConfirmed === null &&
    period.model.kind === "ROTATING_FIVE_IN_SEVEN" &&
    period.model.sevenDayShiftPlanConfirmed !== false;
  const accountReference = account || accountForecast;
  const applicable = reviewed && tariff.scopeConfirmed !== false;
  if (forecast && applicable)
    notice({
      date: period.validFrom,
      code: "TARGET_RULE_FORECAST",
      affectsTarget: true,
      message: accountReference
        ? "TV-UK Pflege BW: Planwert nach § 13 nur Montag bis Freitag, unabhängig von Diensten."
        : tariff.accountRuleConfirmed === false
          ? "TV-UK Pflege BW: Planwert nach § 8 aus festen Tagesstunden außerhalb des Kontenbereichs."
          : "TV-UK Pflege BW: Planwert nach § 8 aus festen Tagesstunden; Kontenbereich nach § 13 ungeklärt.",
    });
  if (weekday === 7 || (accountReference && weekday === 6)) return null;

  const kind: TargetAdjustment["kind"] = holiday ? "STATUTORY_HOLIDAY" : "TARIFF_SPECIAL_DAY";
  const label =
    holiday ??
    (date.endsWith("-24")
      ? "Heiligabend (tariflicher Sondertag)"
      : "Silvester (tariflicher Sondertag)");
  const source = accountReference
    ? forecast
      ? rules.holidayForecast
      : rules.holiday
    : forecast
      ? rules.tvUkLoss.forecast
      : rules.tvUkLoss.actual;
  const line = (numerator: number, status: TargetAdjustment["status"], condition: string) => ({
    date,
    kind,
    label,
    ...source,
    numerator,
    status,
    condition,
  });
  if (!applicable || (!forecast && tariff.scopeConfirmed !== true))
    return line(0, "PENDING", "Tariffassung oder persönlicher Geltungsbereich nicht bestätigt");
  if (accountReference)
    return line(
      period.weeklyMinutes,
      forecast ? "PROFILE_ESTIMATE" : "CONFIRMED",
      forecast
        ? "Monatsprognose im Kontenbereich: ein Fünftel der Wochenzeit, ausschließlich Montag bis Freitag; keine Dienstplanbestätigung"
        : "Bestätigter Kontenbereich nach § 13 Abs. 1: Fünftelabzug Montag bis Freitag, unabhängig von Arbeit oder frei",
    );

  // § 8 is a loss rule, not the account's flat fifth. Do not turn roster-free into loss evidence.
  if (forecast && fixed)
    return fixedMinutes! > 0
      ? line(
          fixedMinutes! * 5,
          "PROFILE_ESTIMATE",
          "Planungsreferenz: feste Tagesstunden fallen aus; persönlicher Kontenbereich kann abweichen",
        )
      : null;
  if (tariff.accountRuleConfirmed !== false)
    return line(
      0,
      "PENDING",
      "Anwendbarer Kontenbereich oder tatsächlicher Stundenausfall nicht bestätigt",
    );
  if (
    fixedMinutes === 0 ||
    (fact?.rosterStatus === "FINAL" && fact.disposition === "WORK_REQUIRED")
  )
    return null;
  if (
    fixed &&
    fact?.rosterStatus === "FINAL" &&
    fact.disposition === "RELEASED" &&
    fact.lostMinutes != null
  ) {
    if (fact.lostMinutes > fixedMinutes!) throw new WorkingTimeTargetError();
    return line(
      fact.lostMinutes * 5,
      "CONFIRMED",
      "Außerhalb des Kontenbereichs: bestätigte Freistellung mit ausgefallenen festen Tagesstunden",
    );
  }
  return line(
    0,
    "PENDING",
    "§ 8 Abs. 3: tatsächlicher Ausfall und Abgrenzung zu regelmäßig frei nicht belegt",
  );
}
