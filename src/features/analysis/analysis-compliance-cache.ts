import type { MonthlyComplianceResult, ShiftEntry, UserProfile } from "@/domain/types";
import { createAnalysisResultCache } from "./analysis-result-cache";
import { COMPLIANCE_CALCULATION_VERSION } from "@/engine/compliance-version";

export const completedMonthlyCompliance = createAnalysisResultCache<MonthlyComplianceResult>();
export function monthlyComplianceKey(
  month: string,
  profile: UserProfile,
  referenceDate: string,
  shifts: readonly ShiftEntry[],
  youthProtection: boolean,
) {
  return JSON.stringify([
    COMPLIANCE_CALCULATION_VERSION,
    month,
    profile,
    referenceDate,
    shifts,
    youthProtection,
  ]);
}
