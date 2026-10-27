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
import {
  isReviewedTargetTariff,
  targetTariffForSector,
  tvaoedTargetTariff,
  tvalTargetTariff,
  tvlKrTargetTariff,
  tvhKrTargetTariff,
  tvUkTargetTariff,
} from "./working-time-target-rules";

export type WorkingTimeCalculationProfile = UserProfile & WorkingTimeTargetProfile;

function selectedTariff(selection: RemunerationSelection): TargetTariff {
  if (selection.kind === "tariff" && selection.packageId === "tval-pflege-tdl") {
    if (
      selection.variant === "CARE" &&
      selection.group === "regular" &&
      ["WEST_38_5", "EAST", "EAST_UNIVERSITY_HOSPITAL"].includes(selection.region) &&
      ["1", "2", "3"].includes(selection.level)
    )
      return tvalTargetTariff(selection.tvalEmployerScope);
    return { kind: "UNVERIFIED", id: "TVA_L/UNREVIEWED_SELECTION" };
  }
  if (selection.kind === "tariff" && selection.packageId === "tvaoed-pflege-vka") {
    const tariff = tvaoedTargetTariff(selection.variant);
    if (tariff) return tariff;
  }
  if (
    selection.kind === "tariff" &&
    selection.packageId === "tvl-kr-tdl" &&
    selection.variant === "SECTION_43"
  )
    return tvlKrTargetTariff();
  if (
    selection.kind === "tariff" &&
    ["tvoed-vka-bt-k", LEGACY_RULE_PACKAGE_IDS.tariff].includes(selection.packageId)
  ) {
    const tariff = targetTariffForSector(selection.variant);
    if (tariff) return tariff;
  }
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
    profile.tvalPflegeTariff &&
    !profile.salaryBasisConflict &&
    !profile.tariff &&
    !profile.vkaETariff &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.nursingTrainingTariff
  )
    return tvalTargetTariff(profile.tvalPflegeTariff.employerScope);
  if (
    profile.nursingTrainingTariff &&
    !profile.salaryBasisConflict &&
    !profile.tariff &&
    !profile.vkaETariff &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.tvalPflegeTariff
  )
    return (
      tvaoedTargetTariff(profile.nursingTrainingTariff.sector) ?? {
        kind: "UNVERIFIED",
        id: "TVAOED",
      }
    );
  if (
    profile.tvUkNursingTariff &&
    !profile.salaryBasisConflict &&
    !profile.tariff &&
    !profile.tvlKrTariff &&
    !profile.tvhKrTariff &&
    !profile.vkaETariff &&
    !profile.nursingTrainingTariff &&
    !profile.tvalPflegeTariff
  )
    return tvUkTargetTariff();
  if (
    profile.tvhKrTariff &&
    !profile.salaryBasisConflict &&
    !profile.tariff &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.vkaETariff &&
    !profile.nursingTrainingTariff &&
    !profile.tvalPflegeTariff
  )
    return tvhKrTargetTariff();
  if (
    profile.tvlKrTariff &&
    !profile.salaryBasisConflict &&
    !profile.tariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.vkaETariff &&
    !profile.nursingTrainingTariff &&
    !profile.tvalPflegeTariff
  )
    return tvlKrTargetTariff();
  if (
    profile.vkaETariff &&
    !profile.salaryBasisConflict &&
    !profile.tariff &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.nursingTrainingTariff &&
    !profile.tvalPflegeTariff
  )
    return (
      targetTariffForSector(profile.vkaETariff.sector) ?? {
        kind: "UNVERIFIED",
        id: "VKA_E",
      }
    );
  const tariff = targetTariffForSector(profile.tariff?.sector);
  if (
    tariff &&
    !profile.salaryBasisConflict &&
    !profile.tvlKrTariff &&
    !profile.tvUkNursingTariff &&
    !profile.tvhKrTariff &&
    !profile.vkaETariff &&
    !profile.nursingTrainingTariff &&
    !profile.tvalPflegeTariff
  )
    return tariff;
  return { kind: "UNVERIFIED", id: "CURRENT_SALARY_SELECTION" };
}

/** Old explicit family markers stay stored unchanged; only the projection gains reviewed rules. */
function historicalTariff(tariff: TargetTariff): TargetTariff {
  if (tariff.kind === "UNVERIFIED" && tariff.id === "tvl-kr-tdl/SECTION_43")
    return tvlKrTargetTariff();
  if (
    tariff.kind === "UNVERIFIED" &&
    ["BT_B", "tvoed-vka-bt-k/BT_B", LEGACY_RULE_PACKAGE_IDS.tariff + "/BT_B"].includes(tariff.id)
  )
    return targetTariffForSector("BT_B")!;
  return tariff;
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
  youthProtection: boolean | null = null,
  youthProtectionStatus: "loading" | "ready" | "error" = "ready",
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
          "Wochenstunden, Arbeitsort und Tarif wurden Ã¼bernommen. FÃ¼r nicht dokumentierte frÃ¼here ZeitrÃ¤ume dient dein aktuelles Profil als Planungsgrundlage.",
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
            (!original &&
              resolved.status === "unknown-effective-date" &&
              resolved.profile.data.selection.kind === "tariff" &&
              resolved.profile.data.selection.packageId === "tval-pflege-tdl") ||
            (resolved.status === "dated" &&
              (!original || resolved.profile.effectiveFrom! >= period.validFrom)))
            ? resolved.profile
            : null;
        const employment = dated?.employment
          ? employmentProfileAt({ ...profile, employmentTimeline: history }, validFrom)
          : null;
        const corrected = (field: "weeklyMinutes" | "sundayHolidayWorkEligible" | "tariff") => {
          const on =
            field === "tariff"
              ? Object.entries(dated?.employmentOverrides ?? {})
                  .filter(([key]) =>
                    [
                      "tariff",
                      "nursingTrainingTariff",
                      "vkaETariff",
                      "tvlKrTariff",
                      "tvUkNursingTariff",
                      "tvhKrTariff",
                      "tvalPflegeTariff",
                    ].includes(key),
                  )
                  .map(([, date]) => date)
                  .sort()
                  .at(-1)
              : dated?.employmentOverrides?.[field];
          if (!on) return false;
          if (period.validFrom <= on) return true;
          // The first legacy entry is its setup baseline, even when entered for a future month.
          const before =
            sources.find((p) => p.validFrom <= on && (p.validTo === null || p.validTo >= on)) ??
            sources[0];
          if (!before) return false;
          if (field === "tariff") {
            // Only redundant legacy setup follows a correction past its recorded date.
            // A different later tariff/version/eligibility remains an explicit future change.
            const a = historicalTariff(period.tariff),
              b = historicalTariff(before.tariff);
            return (
              JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort())
            );
          }
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
        let tariff = historicalTariff(period.tariff);
        if (
          employment &&
          (replacesPeriod ||
            corrected("tariff") ||
            // The old E marker has no special part; applicable employment supplies it.
            (tariff.kind === "UNVERIFIED" && tariff.id === "VKA_E" && employment.vkaETariff) ||
            (tariff.kind === "UNVERIFIED" &&
              tariff.id === "TVAOED" &&
              employment.nursingTrainingTariff) ||
            (tariff.kind === "UNVERIFIED" &&
              tariff.id === "TVA_L" &&
              employment.tvalPflegeTariff) ||
            (baseline && currentTariff({ ...profile, ...baseline }).kind === tariff.kind))
        ) {
          const family =
            employment.tvalPflegeTariff &&
            !Object.hasOwn(employment.tvalPflegeTariff, "employerScope") &&
            selected?.kind === "tariff" &&
            selected.packageId === "tval-pflege-tdl"
              ? selectedTariff(selected)
              : currentTariff(employment);
          tariff = isReviewedTargetTariff(family) && tariff.kind === family.kind ? tariff : family;
        } else if (
          selected?.kind === "tariff" &&
          !(
            employment &&
            selected.packageId === "tval-pflege-tdl" &&
            !replacesPeriod &&
            !corrected("tariff") &&
            ["TVAL_COMMON", "TVAL_GENERAL", "TVAL_KR"].includes(tariff.kind) &&
            tariff.kind !== selectedTariff(selected).kind
          )
        ) {
          const family = selectedTariff(selected);
          tariff = isReviewedTargetTariff(family) && tariff.kind === family.kind ? tariff : family;
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
              "Die Wochenstunden haben sich geÃ¤ndert. Die feste Verteilung auf Wochentage ist noch offen.",
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
        ...(youthProtection !== null || youthProtectionStatus !== "ready"
          ? { youthProtection, youthProtectionStatus }
          : {}),
        context: { ...original, periods, days },
      },
    };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "RemunerationProfileError") throw error;
    return { ...profile, workingTimeTarget: { status: "error", notices: [] } };
  }
}
