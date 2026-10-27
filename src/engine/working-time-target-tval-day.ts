import type { TargetAdjustment, TargetDayFact, TargetNotice } from "@/domain/working-time-target";
import type { TargetTariffRules } from "./working-time-target-rules";

/** General TV-L referral: lost hours, never the hospital roster-free fifth. */
export function tvalLossDayAdjustment(input: {
  readonly date: string;
  readonly weekday: number;
  readonly holiday: string | undefined;
  readonly base: number;
  readonly fact: TargetDayFact | undefined;
  readonly rules: TargetTariffRules;
  readonly forecast: boolean;
  readonly eligibilityVerified: boolean;
  readonly notice: (value: TargetNotice) => void;
}): (Omit<TargetAdjustment, "minutes"> & { readonly numerator: number }) | null {
  const { date, weekday, holiday, base, fact, rules, forecast, eligibilityVerified, notice } =
    input;
  const special = date.endsWith("-12-24") || date.endsWith("-12-31");
  if ((!holiday && !special) || weekday === 7) return null;
  if (fact?.rosterStatus === "FINAL" && fact.disposition === "WORK_REQUIRED") {
    notice({
      date,
      code: holiday ? "HOLIDAY_TIME_OFF_SEPARATE" : "COMPENSATORY_LEAVE_SEPARATE",
      affectsTarget: false,
      message:
        "Arbeit am Feiertag oder Sondertag: Zeitgutschrift und Freizeitausgleich getrennt prüfen.",
    });
    return null;
  }
  if (
    fact?.rosterStatus === "FINAL" &&
    fact.disposition === "ROSTER_FREE" &&
    fact.mustWorkElsewhere === false
  )
    return null;
  // Only the weekday base can be forecast; a Saturday needs explicitly confirmed loss hours.
  if (forecast && base === 0) return null;
  const confirmed =
    eligibilityVerified &&
    fact?.rosterStatus === "FINAL" &&
    fact.lostMinutes != null &&
    (fact.disposition === "RELEASED" ||
      (fact.disposition === "ROSTER_FREE" && fact.mustWorkElsewhere === true));
  if (!forecast && !confirmed && base === 0 && fact?.lostMinutes == null) return null;
  const rule = holiday
    ? forecast
      ? rules.holidayForecast
      : rules.holiday
    : forecast
      ? rules.specialForecast
      : rules.special;
  return {
    date,
    kind: holiday ? "STATUTORY_HOLIDAY" : "TARIFF_SPECIAL_DAY",
    label:
      holiday ??
      (date.endsWith("-24")
        ? "Heiligabend (tariflicher Sondertag)"
        : "Silvester (tariflicher Sondertag)"),
    numerator: confirmed ? fact.lostMinutes! * 5 : forecast ? base : 0,
    ...rule,
    status: confirmed ? "CONFIRMED" : forecast ? "PROFILE_ESTIMATE" : "PENDING",
    condition: confirmed
      ? "Bestätigte ausgefallene Stunden nach allgemeiner Arbeitgeberregel; kein pauschales Fünftel"
      : forecast
        ? "Vorläufige Montag-bis-Freitag-Verluststundenreferenz. Arbeitgebergeltung und individuelle Ausfallstunden nicht bestätigt; kein pauschaler Samstagsabzug."
        : "Arbeitgebergeltung und ausgefallene Stunden nicht abschließend bestätigt",
  };
}
