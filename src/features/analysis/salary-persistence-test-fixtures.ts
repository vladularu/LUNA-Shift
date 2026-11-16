import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { SALARY_PAYMENT_GROUPS } from "@/domain/salary-payment";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { createRuleResolver } from "@/rules/rule-resolver";
import type { AnalysisSalaryRequest } from "./analysis-salary";

export function salaryPersistenceRequest(month = "2026-10"): AnalysisSalaryRequest {
  const year = month.slice(0, 4);
  const settings = automatedSettings("2026-01");
  return {
    month,
    profile: structuredClone(forecastProfile),
    settings,
    annualPayments: [],
    payment: {
      perspective: "PAYOUT",
      preferences: {
        version: 1,
        periods: [
          {
            effectiveMonth: "2026-01",
            delays: Object.fromEntries(
              SALARY_PAYMENT_GROUPS.map((group) => [
                group,
                group === "PREMIUMS" ? 2 : group === "MONTHLY_ALLOWANCE" ? 1 : 0,
              ]),
            ) as Record<(typeof SALARY_PAYMENT_GROUPS)[number], 0 | 1 | 2>,
          },
        ],
        reviewedEmptyMonths: [],
        socialInsuranceAttribution: "CASH_VARIABLE",
      },
      sourceSettings: [
        {
          settings,
          revision: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
    context: {
      entries: [7, 8, 9, 10].map((m) =>
        forecastShift({ id: `source-${m}`, date: `${year}-${String(m).padStart(2, "0")}-05` }),
      ),
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: createRuleResolver(),
      testMonths: [],
    },
  };
}
