import { captureEmploymentProfile, employmentMonthPeriods } from "@/domain/employment-history";
import {
  remunerationDataFromLegacy,
  resolveRemunerationProfile,
} from "@/domain/remuneration-profile";
import type { UserProfile } from "@/domain/types";

// Ignore storage identity, revisions and correction metadata; retain every actual input.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => JSON.stringify(key) + ":" + canonical(child))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}

/** Coalesce equivalent calculation inputs without modifying the stored history. */
export function payrollEmploymentPeriods(profile: UserProfile, month: string, lastDay: string) {
  const periods = employmentMonthPeriods(profile, month, lastDay);
  if (periods.length < 2) return periods;
  const result: typeof periods = [];
  let previousKey: string | null = null;
  for (const period of periods) {
    const key = canonical({
      employment: captureEmploymentProfile(period.profile),
      remuneration:
        resolveRemunerationProfile(profile.employmentTimeline ?? [], period.from).profile?.data ??
        remunerationDataFromLegacy(period.profile),
    });
    const previous = result.at(-1);
    if (previous && key === previousKey) previous.until = period.until;
    else result.push({ ...period });
    previousKey = key;
  }
  return result;
}
