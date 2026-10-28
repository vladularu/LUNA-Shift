import type { MonthlyComplianceResult, ShiftEntry, UserProfile } from "@/domain/types";
import { createAnalysisResultCache } from "./analysis-result-cache";

export const completedMonthlyCompliance = createAnalysisResultCache<MonthlyComplianceResult>();
export function monthlyComplianceKey(
  month: string,
  profile: UserProfile,
  referenceDate: string,
  shifts: readonly ShiftEntry[],
  youthProtection: boolean,
) {
  return JSON.stringify([month, profile, referenceDate, shifts, youthProtection]);
}
