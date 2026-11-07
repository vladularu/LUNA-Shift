import { describe, expect, it, vi } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { RuleResolutionError, bundledRuleResolver } from "@/rules/rule-resolver";
import { annualNetPaySteps, type AnnualNetPayRequest } from "@/features/analysis/annual-net-pay";
import { buildReportSteps, type ReportInput } from "./report-data";
import * as netPreparation from "@/features/salary/automatic-net-pay-preparation";
import { reportView } from "./report-view-data";
import { reportToCsv, reportToHtml } from "./report-formats";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (compute: () => unknown) => {
    try {
      return { ok: true, value: compute() };
    } catch (error) {
      if (!(error instanceof RuleResolutionError)) throw error;
      return { ok: false, error, failure: error.failure };
    }
  },
}));
function finish<Y, T>(steps: Generator<Y, T, void>): T {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
function fixture(start = "2026-01", lag: 0 | 1 | 2 = 0, year = 2026): AnnualNetPayRequest {
  const settings = automatedSettings(start);
  return {
    year,
    profile: forecastProfile,
    timeline: [{ settings, revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
    preferences: setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, `${year}-01`, lag),
    context: {
      entries: Array.from({ length: 12 }, (_, index) =>
        forecastShift({
          id: `m-${index}`,
          date: `${year}-${String(index + 1).padStart(2, "0")}-05`,
        }),
      ),
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: bundledRuleResolver,
      testMonths: [],
    },
  };
}
function check(request: AnnualNetPayRequest, calculationProfile?: ReportInput["profile"]) {
  const ui = finish(annualNetPaySteps(request));
  const input: ReportInput & { salaryPaymentPreferences: AnnualNetPayRequest["preferences"] } = {
    period: String(request.year),
    entries: request.context.entries,
    profile: calculationProfile ?? request.profile,
    netPayProfile: request.profile,
    tariffDecisions: request.context.tariffDecisions,
    workPatternSettings: request.context.workPatternSettings,
    ruleResolver: request.context.resolver,
    referenceDate: `${request.year}-11-07`,
    createdAt: `${request.year}-11-07T12:00:00Z`,
    youthProtection: false,
    testMonths: request.context.testMonths ?? [],
    netPayTimeline: request.timeline,
    salaryPaymentPreferences: request.preferences,
  };
  const report = finish(buildReportSteps(input));
  const pdf = reportView(report);
  expect(pdf.net).toBe(ui.netCents === null ? null : ui.netCents / 100);
  expect(pdf.netCount).toBe(ui.availableMonthCount);
  expect(pdf.monthly.map((month) => month.net)).toEqual(
    ui.months.map((month) => (month.netCents === null ? null : month.netCents / 100)),
  );
  for (const layout of ["standard", "compact"] as const) {
    expect(reportToHtml(report, { layout, includeSalary: true })).toContain(
      `Netto: ${ui.availableMonthCount}/12 Monate verfügbar`,
    );
  }
  const csv = reportToCsv(report);
  expect(csv).not.toContain("Netto");
  expect(csv.trim().split("\r\n")).toHaveLength(request.context.entries.length + 1);
  return { ui, report, pdf };
}
describe("annual PDF uses the UI net-pay rules", () => {
  it("retains the month and base net when the annual payment lacks its own net basis", () => {
    const request = fixture();
    const saved = request.timeline[0];
    const timeline: readonly SavedMonthlyNetPaySettings[] = [
      {
        ...saved,
        settings: {
          ...saved.settings,
          automation: {
            ...saved.settings.automation!,
            annualPayments: [
              { revision: 1, payoutMonth: "2026-07", grossCents: 360000, netBasis: null },
            ],
          },
        },
      },
    ];
    const { ui, report } = check({ ...request, timeline });
    expect(ui.months[6].netCents).toBeGreaterThan(0);
    expect(ui.months[6].notes).toContain("Sonderzahlung nur im Brutto");
    expect(ui.availableMonthCount).toBe(12);
    expect(reportToHtml(report)).toContain("Jahresgrundlagen ergänzen");
  });
  it.each([0, 1, 2] as const)(
    "uses the saved payout delay of %s months for every net forecast",
    (lag) => {
      expect(check(fixture("2026-01", lag)).ui.availableMonthCount).toBeGreaterThan(0);
    },
  );
  it.each([0, 1, 12])("keeps availability correct for %s configured months", (count) => {
    const request = fixture(count === 1 ? "2026-12" : "2026-01");
    const { ui } = check(count === 0 ? { ...request, timeline: [] } : request);
    expect(ui.availableMonthCount).toBe(count);
  });
  it("excludes test months without treating their missing net as zero", () => {
    const request = fixture();
    const { ui } = check({ ...request, context: { ...request.context, testMonths: ["2026-08"] } });
    expect(ui.months[7].netCents).toBeNull();
    expect(ui.availableMonthCount).toBe(11);
  });
  it("uses the net settings effective in each individual month", () => {
    const request = fixture();
    const changed = {
      ...request.timeline[0],
      settings: {
        ...automatedSettings("2026-08"),
        profile: { ...request.timeline[0].settings.profile, taxClass: 3 as const },
      },
    };
    const { ui } = check({ ...request, timeline: [...request.timeline, changed] });
    expect(ui.months[6].netCents).not.toBe(ui.months[7].netCents);
  });
  it("counts a genuinely available zero net instead of marking it missing", () => {
    // A known zero at the forecast boundary must survive both aggregations and PDF formatting.
    const original = netPreparation.prepareAutomaticNetPaySteps;
    const preparation = vi
      .spyOn(netPreparation, "prepareAutomaticNetPaySteps")
      .mockImplementation(function* (...args: Parameters<typeof original>) {
        const forecast = yield* original(...args);
        return forecast.result.status === "available"
          ? {
              ...forecast,
              result: { ...forecast.result, pay: { ...forecast.result.pay, netCents: 0 } },
            }
          : forecast;
      });
    try {
      const { ui, pdf } = check(fixture());
      expect(ui.netCents).toBe(0);
      expect(ui.availableMonthCount).toBe(12);
      expect(pdf.netDisplay).toContain("0,00");
    } finally {
      preparation.mockRestore();
    }
  });
  it("retains previous-year basis notices in the following year's PDF", () => {
    const { ui, report } = check(fixture("2027-01", 0, 2027));
    expect(ui.availableMonthCount).toBeGreaterThan(0);
    expect(ui.preliminary).toBe(true);
    expect(reportToHtml(report)).toContain("vorläufig");
  });
  it("includes the annual payment net when its full basis is available", () => {
    const request = fixture();
    const saved = request.timeline[0];
    const timeline = [
      {
        ...saved,
        settings: {
          ...saved.settings,
          automation: {
            ...saved.settings.automation!,
            annualPayments: [
              {
                revision: 1,
                payoutMonth: "2026-07",
                grossCents: 360000,
                netBasis: { kind: "CONSTANT_PAY" as const },
              },
            ],
          },
        },
      },
    ];
    const { ui } = check({ ...request, timeline });
    expect(ui.months[6].notes).toContain("Jahressonderzahlung enthalten");
    expect(ui.months[6].netCents).toBeGreaterThan(check(request).ui.months[6].netCents!);
  });
  it("keeps annual net tied to the same saved profile as the UI even when report account inputs are enriched", () => {
    const request = fixture();
    check(request, { ...request.profile, tariff: null, manualMonthlyGrossCents: 900000 });
  });
});
