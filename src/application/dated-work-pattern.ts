import { useMemo } from "react";
import type { TvoedWorkPatternSettings, UserProfile } from "@/domain/types";
import type { PflegeShiftProfileValue } from "./working-time-provider";

/** Use the provider's dated profile projection; raw app preferences are legacy fallback only. */
export function useDatedWorkPattern<
  T extends { readonly workPatternSettings: TvoedWorkPatternSettings },
>(value: T, profile: UserProfile | null): T {
  const answers = profile?.workPattern;
  return useMemo(
    () =>
      answers
        ? {
            ...value,
            workPatternSettings: { ...value.workPatternSettings, ...answers },
          }
        : value,
    [answers, value],
  );
}

/** Preserve legacy answers until an employment-dated value exists. */
export function useEmploymentProfileValue(
  profile: UserProfile | null,
  updateProfile: PflegeShiftProfileValue["updateProfile"],
  workPatternSettings: TvoedWorkPatternSettings,
): PflegeShiftProfileValue {
  return useMemo(
    () => ({
      profile: profile
        ? {
            ...profile,
            workPattern: profile.workPattern ?? {
              workplaceCoverage: workPatternSettings.workplaceCoverage,
              assignment: workPatternSettings.assignment,
            },
          }
        : null,
      updateProfile,
    }),
    [profile, updateProfile, workPatternSettings],
  );
}
