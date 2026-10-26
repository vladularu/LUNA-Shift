import { employmentProfileAt } from "@/domain/employment-history";
import { LEGACY_RULE_PACKAGE_IDS } from "@/rules/bundled-rules";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEntry, UserProfile } from "@/domain/types";
import type {
  DatedRemunerationProfile,
  RemunerationSelection,
} from "@/domain/remuneration-profile";
import { resolveRemunerationProfile } from "@/domain/remuneration-profile";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import type {
  TargetProfilePeriod,
  TargetTariff,
  WorkingTimeTargetInput,
  WorkingTimeTargetProfile,
} from "@/domain/working-time-target";
import { TVOED_K_TARGET_REVIEW } from "./working-time-target-rules";

export type WorkingTimeCalculationProfile = UserProfile & WorkingTimeTargetProfile;

function selectedTariff(selection: RemunerationSelection): TargetTariff {
  if (
    selection.kind === "tariff" &&
    ["tvoed-vka-bt-k", LEGACY_RULE_PACKAGE_IDS.tariff].includes(selection.packageId) &&
    selection.variant === "BT_K"
  )
    return { kind: "TVOED_K", version: TVOED_K_TARGET_REVIEW.version, scopeConfirmed: null };
  // Salary selection identifies the family, not the individual's working-time scope.
  return {
    kind: "UNVERIFIED",
    id:
      selection.kind === "tariff"
        ? selection.packageId + "/" + selection.variant
        : "OWN_OR_UNCONFIGURED",
  };
}

function currentTariff(profile: UserProfile): TargetTariff {
  if (
    profile.tariff?.sector === "BT_K" &&
    !profile.salaryBasisConflict &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.vkaETariff &&
    !profile.nursingTrainingTariff &&
    !profile.tvalPflegeTariff
  )
    return { kind: "TVOED_K", version: TVOED_K_TARGET_REVIEW.version, scopeConfirmed: null };
  return { kind: "UNVERIFIED", id: "CURRENT_SALARY_SELECTION" };
}

/** Planning defaults from the existing employment answer; never saved as roster evidence. */
export function deriveWorkingTimeForecastModel(
  profile: UserProfile,
  weeklyMinutes: number,
): TargetProfilePeriod["model"] {
  if (profile.sundayHolidayWorkEligible === true)
    return {
      kind: "ROTATING_FIVE_IN_SEVEN",
      monthlyReference: "WEEKDAYS_ONE_FIFTH",
      sevenDayShiftPlanConfirmed: null,
    };
  if (profile.sundayHolidayWorkEligible === false) {
    const daily = Math.floor(weeklyMinutes / 5);
    return {
      kind: "FIXED_WEEK",
      weekdayMinutes: [daily, daily, daily, daily, weeklyMinutes - daily * 4, 0, 0],
    };
  }
  return { kind: "UNKNOWN" };
}

/** Combines existing sources without writing back, guessing history, or confirming a claim. */
export function createWorkingTimeCalculationProfile(
  profile: UserProfile,
  snapshot: WorkingTimeTargetSnapshot | null,
  history: readonly DatedRemunerationProfile[],
  status: WorkingTimeTargetInput["status"] = "ready",
  // Retained for callers; calendar entries never determine a contractual forecast.
  _entries: readonly CalendarEntry[] = [],
): WorkingTimeCalculationProfile {
  if (status !== "ready") return { ...profile, workingTimeTarget: { status, notices: [] } };
  try {
    history = history.length ? history : (profile.employmentTimeline ?? []);
    const original = snapshot?.context;
    const notices: WorkingTimeTargetInput["notices"][number][] = [];
    if (!original && !history.some((item) => item.employment))
      notices.push({
        date: null,
        code: "EMPLOYMENT_REFERENCE_UNCONFIRMED",
        affectsTarget: true,
        message:
          "Wochenstunden, Arbeitsort und Tarif wurden übernommen. Für nicht dokumentierte frühere Zeiträume dient dein aktuelles Profil als Planungsgrundlage.",
      });
    const sources: readonly TargetProfilePeriod[] = original?.periods ?? [
      {
        validFrom: "1900-01-01",
        validTo: null,
        weeklyMinutes: profile.weeklyMinutes,
        federalState: profile.federalState,
        holidayRegion: profile.holidayRegion,
        model: deriveWorkingTimeForecastModel(profile, profile.weeklyMinutes),
        tariff: currentTariff(profile),
      },
    ];
    const periods: TargetProfilePeriod[] = [];
    for (const period of sources) {
      const starts = [
        period.validFrom,
        ...history.flatMap((item) =>
          item.effectiveFrom !== null &&
          item.effectiveFrom > period.validFrom &&
          (period.validTo === null || item.effectiveFrom <= period.validTo)
            ? [item.effectiveFrom]
            : [],
        ),
      ].sort();
      for (let index = 0; index < starts.length; index++) {
        const validFrom = starts[index];
        const validTo = starts[index + 1]
          ? Temporal.PlainDate.from(starts[index + 1])
              .subtract({ days: 1 })
              .toString()
          : period.validTo;
        const resolved = resolveRemunerationProfile(history, validFrom);
        // A newer explicit working-time period wins over an older salary snapshot.
        const dated =
          resolved.profile &&
          (resolved.profile.employment ||
            (resolved.status === "dated" &&
              (!original || resolved.profile.effectiveFrom! >= period.validFrom)))
            ? resolved.profile
            : null;
        const employment = dated?.employment
          ? employmentProfileAt({ ...profile, employmentTimeline: history }, validFrom)
          : null;
        const corrected = (field: "weeklyMinutes" | "sundayHolidayWorkEligible") => {
          const on = dated?.employmentOverrides?.[field];
          if (!on) return false;
          if (period.validFrom <= on) return true;
          // The first legacy entry is its setup baseline, even when entered for a future month.
          const before =
            sources.find((p) => p.validFrom <= on && (p.validTo === null || p.validTo >= on)) ??
            sources[0];
          if (!before) return false;
          return field === "weeklyMinutes"
            ? period.weeklyMinutes === before.weeklyMinutes
            : JSON.stringify(period.model) === JSON.stringify(before.model);
        };
        const baseline = history.find((item) => item.effectiveFrom === null)?.employment;
        const replacesPeriod =
          !original ||
          (dated?.effectiveFrom !== null &&
            dated?.effectiveFrom !== undefined &&
            dated.effectiveFrom >= period.validFrom);
        // Reuse redundant old setup values, but retain an explicit differing historical override.
        const weeklyMinutes = employment
          ? replacesPeriod ||
            corrected("weeklyMinutes") ||
            period.weeklyMinutes === baseline?.weeklyMinutes
            ? employment.weeklyMinutes
            : period.weeklyMinutes
          : (dated?.data.weeklyMinutes ?? period.weeklyMinutes);
        const selected = dated?.data.selection;
        // A salary amount or missing salary setup is not a change of the confirmed working-time tariff.
        let tariff = period.tariff;
        if (
          employment &&
          (replacesPeriod ||
            (baseline && currentTariff({ ...profile, ...baseline }).kind === period.tariff.kind))
        ) {
          const family = currentTariff(employment);
          tariff =
            family.kind === "TVOED_K" && period.tariff.kind === "TVOED_K" ? period.tariff : family;
        } else if (selected?.kind === "tariff") {
          const family = selectedTariff(selected);
          tariff =
            family.kind === "TVOED_K" && period.tariff.kind === "TVOED_K" ? period.tariff : family;
        } else if (selected && !original) tariff = selectedTariff(selected);
        const standardFixed =
          period.model.kind === "FIXED_WEEK" &&
          period.model.weekdayMinutes
            .slice(0, 4)
            .every((v) => v === Math.floor(period.weeklyMinutes / 5)) &&
          period.model.weekdayMinutes[4] ===
            period.weeklyMinutes - Math.floor(period.weeklyMinutes / 5) * 4 &&
          period.model.weekdayMinutes[5] === 0 &&
          period.model.weekdayMinutes[6] === 0;
        const changedFixed =
          original !== undefined &&
          period.model.kind === "FIXED_WEEK" &&
          !(employment && standardFixed) &&
          weeklyMinutes !== period.weeklyMinutes;
        const model = changedFixed
          ? { kind: "UNKNOWN" as const }
          : corrected("weeklyMinutes") && standardFixed && !corrected("sundayHolidayWorkEligible")
            ? deriveWorkingTimeForecastModel(
                { ...profile, sundayHolidayWorkEligible: false },
                weeklyMinutes,
              )
            : (employment &&
                  (replacesPeriod ||
                    corrected("sundayHolidayWorkEligible") ||
                    (baseline &&
                      deriveWorkingTimeForecastModel(
                        { ...profile, ...baseline },
                        baseline.weeklyMinutes,
                      ).kind === period.model.kind)) &&
                  (period.model.kind !== "FIXED_WEEK" || standardFixed)) ||
                !original ||
                period.model.kind === "UNKNOWN"
              ? deriveWorkingTimeForecastModel(employment ?? profile, weeklyMinutes)
              : period.model;
        if (changedFixed)
          notices.push({
            date: validFrom,
            code: "FIXED_DISTRIBUTION_CHANGED",
            affectsTarget: true,
            message:
              "Die Wochenstunden haben sich geändert. Die feste Verteilung auf Wochentage ist noch offen.",
          });
        periods.push({
          ...period,
          validFrom,
          validTo,
          weeklyMinutes,
          model,
          tariff,
          ...(employment
            ? { federalState: employment.federalState, holidayRegion: employment.holidayRegion }
            : {}),
        });
      }
    }
    const days = (original?.days ?? []).map((day) => {
      const before = original?.periods.find(
        (period) =>
          period.validFrom <= day.date && (period.validTo === null || day.date <= period.validTo),
      );
      const after = periods.find(
        (period) =>
          period.validFrom <= day.date && (period.validTo === null || day.date <= period.validTo),
      );
      const changed =
        before &&
        after &&
        (before.weeklyMinutes !== after.weeklyMinutes ||
          JSON.stringify(before.tariff) !== JSON.stringify(after.tariff) ||
          JSON.stringify(before.model) !== JSON.stringify(after.model));
      return changed
        ? { ...day, rosterStatus: "DRAFT" as const, lostMinutes: null, mustWorkElsewhere: null }
        : day;
    });
    return {
      ...profile,
      employmentTimeline: history,
      workingTimeTarget: {
        status,
        notices,
        mode: "FORECAST",
        context: { ...original, periods, days },
      },
    };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "RemunerationProfileError") throw error;
    return { ...profile, workingTimeTarget: { status: "error", notices: [] } };
  }
}
