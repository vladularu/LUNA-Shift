import { describe, expect, it } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { annualSalaryForecast } from "@/features/salary/annual-salary-forecast";
import { prepareAutomaticNetPay } from "@/features/salary/automatic-net-pay-preparation";
import { SALARY_PAYMENT_GROUPS, type SalaryPaymentDelays } from "@/domain/salary-payment";
import { salaryMonthInput } from "@/features/salary/salary-month-input";
import {
  analysisSalaryKey,
  prepareAnalysisSalarySteps,
  readAnalysisSalary,
  type AnalysisSalaryRequest,
} from "./analysis-salary";

function request(month = "2026-11"): AnalysisSalaryRequest {
  return {
    month,
    profile: structuredClone(forecastProfile),
    settings: automatedSettings("2026-01"),
    annualPayments: [],
    context: {
      entries: [7, 8, 9, 11].map((m) =>
        forecastShift({ id: `m${m}`, date: `2026-${String(m).padStart(2, "0")}-05` }),
      ),
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: { ...bundledRuleResolver },
      testMonths: [],
    },
  };
}
function prepare(input: AnalysisSalaryRequest) {
  const steps = prepareAnalysisSalarySteps(input, analysisSalaryKey(input));
  let count = 0;
  while (true) {
    const step = steps.next();
    if (step.done) return { result: step.value, count };
    count++;
  }
}

describe("complete prepared analysis salary", () => {
  function paymentRequest(): AnalysisSalaryRequest {
    const input = request("2026-10");
    return {
      ...input,
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
              ) as SalaryPaymentDelays,
            },
          ],
          reviewedEmptyMonths: [],
          socialInsuranceAttribution: "CASH_VARIABLE",
        },
        sourceSettings: [
          {
            settings: input.settings!,
            revision: 1,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      context: {
        ...input.context,
        entries: [8, 9, 10].map((m) =>
          forecastShift({ id: `month-${m}`, date: `2026-${String(m).padStart(2, "0")}-05` }),
        ),
      },
    };
  }

  it("prepares payout from original claim months while annual reference amounts stay earned", () => {
    const input = paymentRequest();
    const actual = prepare(input).result;
    expect(actual.projection?.perspective).toBe("PAYOUT");
    expect(actual.projection?.contributions).toContainEqual(
      expect.objectContaining({
        group: "PREMIUMS",
        claimMonth: "2026-08",
        paymentMonth: "2026-10",
        amountCents: Math.round(
          salaryMonthInput("2026-08", input.profile, input.context).pay.timePremiumAmount * 100,
        ),
      }),
    );
    expect(actual.annual).toEqual(
      annualSalaryForecast(2026, input.profile, input.context, input.annualPayments),
    );
    expect(actual.forecast).toEqual(
      prepareAutomaticNetPay(
        input.month,
        input.settings!,
        input.profile,
        input.context,
        input.payment,
      ),
    );
    const earned = prepare({
      ...input,
      payment: { ...input.payment!, perspective: "EARNED" },
    }).result;
    expect(earned.projection?.perspective).toBe("EARNED");
    expect(earned.forecast).toBeNull();
    expect(earned.annual).toEqual(actual.annual);
  });

  it("invalidates a cash result for source evidence, source settings, timing and perspective", () => {
    const input = paymentRequest();
    const key = analysisSalaryKey(input);
    const changedEvidence = {
      ...input,
      context: {
        ...input.context,
        entries: [
          ...input.context.entries,
          forecastShift({ id: "source-lookback", date: "2026-07-20" }),
        ],
      },
    };
    expect(analysisSalaryKey(changedEvidence)).not.toBe(key);
    const changedSettings = { ...input, payment: { ...input.payment!, sourceSettings: [] } };
    expect(analysisSalaryKey(changedSettings)).not.toBe(key);
    const changedPerspective = {
      ...input,
      payment: { ...input.payment!, perspective: "EARNED" as const },
    };
    expect(analysisSalaryKey(changedPerspective)).not.toBe(key);
    const changedTiming = {
      ...input,
      payment: { ...input.payment!, preferences: { ...input.payment!.preferences, periods: [] } },
    };
    expect(analysisSalaryKey(changedTiming)).not.toBe(key);
    expect(
      analysisSalaryKey({
        ...input,
        context: {
          ...input.context,
          entries: [
            ...input.context.entries,
            forecastShift({ id: "unrelated", date: "2010-01-01" }),
          ],
        },
      }),
    ).toBe(key);
  });

  it("prepares gross payout even when no net settings exist", () => {
    const input = { ...paymentRequest(), settings: null };
    const actual = prepare(input).result;
    expect(actual.projection?.contributions.some((part) => part.claimMonth === "2026-08")).toBe(
      true,
    );
    expect(actual.forecast).toBeNull();
  });

  it("invalidates manual cash preparation when an earlier timing-exemption candidate changes", () => {
    const original = paymentRequest();
    const input: AnalysisSalaryRequest = {
      ...original,
      month: "2026-04",
      settings: null,
      profile: { ...original.profile, tariff: null, manualMonthlyGrossCents: 400000 },
      context: { ...original.context, entries: [] },
      payment: {
        ...original.payment!,
        preferences: { version: 1, periods: [], reviewedEmptyMonths: [] },
      },
    };
    expect(prepare(input).result.projection?.available).toBe(true);
    const key = analysisSalaryKey(input);
    const changed = {
      ...input,
      context: {
        ...input.context,
        entries: [forecastShift({ id: "manual-candidate", date: "2026-02-05" })],
      },
    };
    expect(analysisSalaryKey(changed)).not.toBe(key);
    expect(readAnalysisSalary(changed, analysisSalaryKey(changed))).toBeNull();
    expect(
      analysisSalaryKey({
        ...input,
        context: {
          ...input.context,
          entries: [forecastShift({ id: "outside-candidates", date: "2026-01-01" })],
        },
      }),
    ).toBe(key);
  });
  it("preserves the complete annual and net outputs, including different saved payment sources", () => {
    const input = request();
    const grossOverride = {
      revision: 1,
      payoutMonth: "2026-11",
      grossCents: 123400,
      netBasis: { kind: "CONSTANT_PAY" as const },
    };
    const netOverride = { ...grossOverride, grossCents: 99900 };
    const different = {
      ...input,
      annualPayments: [grossOverride],
      settings: {
        ...input.settings!,
        automation: { ...input.settings!.automation!, annualPayments: [netOverride] },
      },
    };
    const prepared = prepare(different);
    expect(prepared.count).toBeGreaterThan(4);
    expect(prepared.result.annual).toEqual(
      annualSalaryForecast(2026, different.profile, different.context, different.annualPayments),
    );
    expect(prepared.result.forecast).toEqual(
      prepareAutomaticNetPay(
        different.month,
        different.settings,
        different.profile,
        different.context,
      ),
    );
    expect(prepared.result.annual.payments[0].grossCents).toBe(123400);
    expect(prepared.result.forecast?.result.status).toBe("available");
    expect(readAnalysisSalary(different, analysisSalaryKey(different))).toEqual(prepared.result);
  });
  it("shares content-equivalent inputs and excludes unrelated history without missing assessment-window changes", () => {
    const input = request();
    const first = prepare(input).result;
    const key = analysisSalaryKey(input);
    const copy = {
      ...input,
      context: {
        ...input.context,
        entries: [...input.context.entries, forecastShift({ id: "old", date: "2010-01-01" })],
      },
    };
    expect(analysisSalaryKey(copy)).toBe(key);
    expect(readAnalysisSalary(copy, key)).toEqual(first);
    const changed = {
      ...input,
      context: {
        ...input.context,
        entries: [...input.context.entries, forecastShift({ id: "lookback", date: "2026-06-05" })],
      },
    };
    expect(analysisSalaryKey(changed)).not.toBe(key);
    const mutated = structuredClone({
      ...input,
      context: { ...input.context, resolver: undefined },
    });
    mutated.context.entries = mutated.context.entries.map((entry, index) =>
      entry.kind === "SHIFT" && index === 0 ? { ...entry, endTime: "05:00" } : entry,
    );
    expect(
      analysisSalaryKey({
        ...mutated,
        context: { ...mutated.context, resolver: input.context.resolver },
      }),
    ).not.toBe(key);
    expect(
      readAnalysisSalary(
        { ...input, context: { ...input.context, resolver: { ...bundledRuleResolver } } },
        key,
      ),
    ).toBeNull();
  });
  it.each(["2026-11", "2027-01"])(
    "keeps failed or incomplete forecasts retryable for %s",
    (month) => {
      const input = request(month);
      const invalid = { ...input, profile: { ...input.profile, weeklyMinutes: 0 } };
      const prepared = prepare(invalid).result;
      expect(prepared.forecast?.result.status).toBe("unavailable");
      expect(readAnalysisSalary(invalid, analysisSalaryKey(invalid))).toBeNull();
      expect(prepare(invalid).result).toEqual(prepared);
    },
  );
});
