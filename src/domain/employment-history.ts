import type {
  SaveProfileInput,
  UserProfile,
  SaveTvoedWorkPatternSettingsInput,
  TvoedWorkPatternSettings,
} from "./types";
import { validateProfile, ValidationError } from "./validation";
import {
  requireRemunerationDate,
  resolveRemunerationProfile,
  validateRemunerationProfileData,
  type DatedRemunerationProfile,
  type RemunerationProfileData,
} from "./remuneration-profile";

const KEYS = [
  "federalState",
  "holidayRegion",
  "weeklyMinutes",
  "timeZone",
  "industry",
  "tariff",
  "manualMonthlyGrossCents",
  "nursingTrainingTariff",
  "vkaETariff",
  "tvlKrTariff",
  "tvUkNursingTariff",
  "tvhKrTariff",
  "tvalPflegeTariff",
  "regularRotatingNightWork",
  "sundayHolidayWorkEligible",
  "allEmploymentWorkRecorded",
] as const;
export type EmploymentProfileData = Pick<UserProfile, (typeof KEYS)[number]> & {
  readonly workPattern: SaveTvoedWorkPatternSettingsInput | null;
};

function workPattern(value: unknown): SaveTvoedWorkPatternSettingsInput | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("Das gespeicherte Schichtmodell ist ungültig.");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).sort().join() !== "assignment,workplaceCoverage" ||
    !["UNKNOWN", "AROUND_THE_CLOCK", "NOT_AROUND_THE_CLOCK"].includes(
      item.workplaceCoverage as string,
    ) ||
    !["UNKNOWN", "PERMANENT", "TEMPORARY"].includes(item.assignment as string)
  )
    throw new ValidationError("Das gespeicherte Schichtmodell ist ungültig.");
  return Object.freeze({
    workplaceCoverage: item.workplaceCoverage,
    assignment: item.assignment,
  }) as SaveTvoedWorkPatternSettingsInput;
}

/** Capture editor intent without throwing while a repairable form is opening. */
export function captureEmploymentProfile(profile: SaveProfileInput): EmploymentProfileData {
  return Object.freeze({
    ...Object.fromEntries(KEYS.map((key) => [key, profile[key] ?? null])),
    workPattern: profile.workPattern ?? null,
  }) as EmploymentProfileData;
}
export function employmentDataFromProfile(profile: SaveProfileInput): EmploymentProfileData {
  return captureEmploymentProfile({
    ...validateProfile(profile),
    workPattern: workPattern(profile.workPattern),
  });
}

export function validateEmploymentData(value: unknown): EmploymentProfileData {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => ![...KEYS, "workPattern"].includes(key as (typeof KEYS)[number]),
    ) ||
    KEYS.some((key) => !Object.hasOwn(value, key))
  )
    throw new ValidationError("Die gespeicherten Beschäftigungsangaben sind ungültig.");
  return employmentDataFromProfile(value as EmploymentProfileData);
}

function validateEmploymentOverrides(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ValidationError("Die gespeicherte Zeitraumkorrektur ist ungültig.");
  const entries = Object.entries(value);
  if (
    !entries.length ||
    entries.length > KEYS.length + 1 ||
    entries.some(([key]) => ![...KEYS, "workPattern"].includes(key as (typeof KEYS)[number]))
  )
    throw new ValidationError("Die gespeicherte Zeitraumkorrektur ist ungültig.");
  return Object.freeze(
    Object.fromEntries(
      entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, date]) => [key, requireRemunerationDate(date)]),
    ),
  );
}

/** Old flat financial JSON remains readable. No SQL migration or second timeline. */
export function decodeEmploymentPayload(value: unknown): {
  data: RemunerationProfileData;
  employment?: EmploymentProfileData;
  employmentOverrides?: Readonly<Record<string, string>>;
} {
  if (typeof value === "object" && value !== null && "profileVersion" in value) {
    const v = value as Record<string, unknown>;
    if (
      ![1, 2, 3].includes(v.profileVersion as number) ||
      Object.keys(v).sort().join() !==
        (v.profileVersion === 3
          ? "data,employment,employmentOverrides,profileVersion"
          : "data,employment,profileVersion")
    )
      throw new ValidationError("Diese Profilversion wird noch nicht unterstützt.");
    if (
      v.profileVersion !== 1 &&
      (typeof v.employment !== "object" ||
        v.employment === null ||
        !Object.hasOwn(v.employment, "workPattern"))
    )
      throw new ValidationError("Im gespeicherten Beschäftigungsverlauf fehlt das Schichtmodell.");
    const data = validateRemunerationProfileData(v.data);
    const employment = validateEmploymentData(v.employment);
    if (employment.weeklyMinutes !== data.weeklyMinutes)
      throw new ValidationError("Die Wochenstunden der gespeicherten Profile widersprechen sich.");
    return {
      data,
      employment,
      ...(v.profileVersion === 3
        ? { employmentOverrides: validateEmploymentOverrides(v.employmentOverrides) }
        : {}),
    };
  }
  return { data: validateRemunerationProfileData(value) };
}

export function encodeEmploymentPayload(
  data: RemunerationProfileData,
  employment?: EmploymentProfileData,
  employmentOverrides?: Readonly<Record<string, string>>,
): string {
  if (employmentOverrides && !employment)
    throw new ValidationError("Der Zeitraumkorrektur fehlt das Beschäftigungsprofil.");
  const payload = employment
    ? employmentOverrides
      ? { profileVersion: 3, data, employment, employmentOverrides }
      : { profileVersion: 2, data, employment }
    : data;
  decodeEmploymentPayload(payload);
  return JSON.stringify(payload);
}

export function employmentTimelineKey(profiles: readonly DatedRemunerationProfile[]): string {
  return JSON.stringify(profiles);
}

export function employmentProfileAt<T extends UserProfile>(profile: T, date: string): T {
  if (profile.salaryBasisConflict) return profile;
  const history = profile.employmentTimeline;
  if (!history?.some((item) => item.employment)) return profile;
  const selected = resolveRemunerationProfile(history, date).profile;
  return selected?.employment ? { ...profile, ...selected.employment } : profile;
}

/** Resolve shift answers at the same date as the employment inputs. */
export function employmentWorkPatternAt(
  profile: Pick<UserProfile, "employmentTimeline" | "workPattern">,
  fallback: TvoedWorkPatternSettings,
  date: string,
): TvoedWorkPatternSettings {
  const selected = profile.employmentTimeline?.length
    ? resolveRemunerationProfile(profile.employmentTimeline, date).profile
    : null;
  const answers = selected?.employment?.workPattern ?? profile.workPattern;
  return answers ? { ...answers, updatedAt: selected?.updatedAt ?? fallback.updatedAt } : fallback;
}

/** Date boundaries, independent of worked shifts. */
export function employmentMonthPeriods(profile: UserProfile, month: string, lastDay: string) {
  const first = month + "-01";
  const starts = [
    ...new Set([
      first,
      ...(profile.employmentTimeline ?? []).flatMap((item) =>
        item.employment &&
        item.effectiveFrom &&
        item.effectiveFrom > first &&
        item.effectiveFrom <= lastDay
          ? [item.effectiveFrom]
          : [],
      ),
    ]),
  ].sort();
  return starts.map((from, index) => ({
    from,
    until: starts[index + 1] ?? null,
    profile: employmentProfileAt(profile, from),
  }));
}

/** Compatibility for financial-only entries created by older editors. */
export function employmentWithRemuneration(
  base: EmploymentProfileData,
  data: RemunerationProfileData,
): EmploymentProfileData {
  const selection = data.selection;
  if (
    selection.kind === "tariff" &&
    selection.packageId === "tvoed-vka-bt-k" &&
    ["BT_K", "BT_B"].includes(selection.variant)
  ) {
    return employmentDataFromProfile({
      ...base,
      weeklyMinutes: data.weeklyMinutes,
      nursingTrainingTariff: null,
      vkaETariff: null,
      tvlKrTariff: null,
      tvUkNursingTariff: null,
      tvhKrTariff: null,
      tvalPflegeTariff: null,
      manualMonthlyGrossCents: null,
      tariff: {
        payGroup: selection.group,
        payLevel: Number(selection.level),
        sector: selection.variant,
        tariffRegion: selection.region,
        fullTimeWeeklyMinutes: selection.fullTimeWeeklyMinutes,
      } as UserProfile["tariff"],
    });
  }
  if (selection.kind === "own-monthly")
    return employmentDataFromProfile({
      ...base,
      weeklyMinutes: data.weeklyMinutes,
      tariff: null,
      nursingTrainingTariff: null,
      vkaETariff: null,
      tvlKrTariff: null,
      tvUkNursingTariff: null,
      tvhKrTariff: null,
      tvalPflegeTariff: null,
      manualMonthlyGrossCents: selection.monthlyGrossCents,
    });
  return employmentDataFromProfile({ ...base, weeklyMinutes: data.weeklyMinutes });
}
