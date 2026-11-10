import { describe, expect, it } from "vitest";
import type { ComplianceIssue, MonthlyComplianceResult } from "@/domain/types";
import { TARIFF_SCOPE_SOURCE, TARIFF_TIME_POLICIES } from "@/domain/tariff-time-policy";
import { persistentCheckValue } from "./persistent-analysis-values";
import { annualInputKey } from "./annual-core-report";
import { COMPLIANCE_CALCULATION_VERSION } from "@/engine/compliance-version";
import { monthlyComplianceKey } from "./analysis-compliance-cache";
import { shift, work } from "@/engine/remuneration-test-fixtures";
import { calculateMonthlyCompliance } from "@/engine/compliance";

const issue: ComplianceIssue = {
  id: "tariff-week",
  kind: "LEGAL",
  severity: "info",
  rule: "TARIFF_WEEK_DAYS",
  title: "6 Arbeitstage in einer Kalenderwoche",
  description: "Tarifliche Verteilung prüfen.",
  date: "2026-11-07",
  relatedShiftIds: [],
  tariff: {
    tariffLabel: "TVöD · BT-K",
    ruleId: "TARIFF_WEEK_DAYS",
    status: "REVIEW",
    period: { from: "2026-11-02", until: "2026-11-08" },
    source: TARIFF_TIME_POLICIES.TVOED_K.source,
    ruleText: TARIFF_TIME_POLICIES.TVOED_K.ruleText,
    requirements: ["Betriebliche Ausnahme prüfen."],
    count: 6,
    limit: 5,
  },
};
const result = (value: ComplianceIssue): MonthlyComplianceResult => ({
  month: "2026-11",
  issues: [value],
  criticalCount: 0,
  warningCount: 0,
  infoCount: 1,
  affectedDates: [value.date],
});

describe("cached tariff evidence", () => {
  it("accepts reviewed sources and legacy findings without tariff metadata", () => {
    expect(persistentCheckValue(result(issue))).toBe(true);
    const { tariff: _tariff, ...legacy } = issue;
    expect(persistentCheckValue(result(legacy))).toBe(true);
  });

  it.each(["javascript:alert(1)", "https://example.org/unreviewed-tariff", "http://www.vka.de/"])(
    "rejects a replaced source link: %s",
    (url) => {
      expect(
        persistentCheckValue(
          result({
            ...issue,
            tariff: { ...issue.tariff!, source: { ...issue.tariff!.source, url } },
          }),
        ),
      ).toBe(false);
    },
  );

  it("rejects inconsistent dates, counts and source sections", () => {
    for (const patch of [
      { period: { from: "2026-11-08", until: "2026-11-02" } },
      { period: { from: "2026-02-30", until: "2026-11-02" } },
      { count: -1 },
      { source: { ...issue.tariff!.source, section: "Ungeprüfte Ausnahme" } },
    ])
      expect(
        persistentCheckValue(result({ ...issue, tariff: { ...issue.tariff!, ...patch } })),
      ).toBe(false);
  });

  it("allows the app scope source only for an unavailable scope finding", () => {
    const scope: ComplianceIssue = {
      ...issue,
      rule: "TARIFF_SCOPE",
      tariff: { ...issue.tariff!, status: "UNAVAILABLE", source: TARIFF_SCOPE_SOURCE },
    };
    expect(persistentCheckValue(result(scope))).toBe(true);
    expect(persistentCheckValue(result({ ...scope, rule: "TARIFF_WEEK_DAYS" }))).toBe(false);
    expect(
      persistentCheckValue(result({ ...scope, tariff: { ...scope.tariff!, status: "REVIEW" } })),
    ).toBe(false);
  });

  it("validates tariff metadata moved into cached prerequisites as well", () => {
    expect(
      persistentCheckValue({
        ...result(issue),
        issues: [],
        prerequisites: [{ ...issue, tariff: { ...issue.tariff!, count: "6" } }],
      }),
    ).toBe(false);
  });

  it("versions annual cache keys while retaining canonical property order", () => {
    expect(annualInputKey({ a: 1, b: 2 })).toBe(annualInputKey({ b: 2, a: 1 }));
    expect(annualInputKey({ a: 1 })).not.toBe(JSON.stringify({ a: 1 }));
    expect(annualInputKey({ a: 1 })).toContain(COMPLIANCE_CALCULATION_VERSION);
  });
  it("invalidates the published three-weekend calculation in monthly and annual caches", () => {
    const published = "2026-11-09-night-series-four";
    expect(JSON.parse(monthlyComplianceKey("2026-11", work, "2026-11-09", [], false))[0]).not.toBe(
      published,
    );
    expect(JSON.parse(annualInputKey({ year: 2026 }))[0]).not.toBe(published);
  });
  it("invalidates weekly checks that counted overnight calendar dates", () => {
    const previous = "2026-11-09-weekends-four-weeks";
    expect(JSON.parse(monthlyComplianceKey("2026-11", work, "2026-11-09", [], false))[0]).not.toBe(
      previous,
    );
    expect(JSON.parse(annualInputKey({ year: 2026 }))[0]).not.toBe(previous);
  });
});

const weekendResult = (days = [7, 14, 21]) =>
  calculateMonthlyCompliance(
    "2026-11",
    days.map((day) =>
      shift({
        id: `sat-${day}`,
        date: `2026-11-${String(day).padStart(2, "0")}`,
        type: "DAY",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
      }),
    ),
    work.timeZone,
    {
      employmentProfile: { ...work, allEmploymentWorkRecorded: true },
      allEmploymentWorkRecorded: true,
      referenceDate: "2026-11-30",
    },
  );

describe("cached weekend assessments", () => {
  it.each(["issues", "prerequisites", "scopeNotes"] as const)(
    "rejects individually valid but contradictory models in %s",
    (container) => {
      const raw = weekendResult();
      const finding = raw.issues.find((item) => item.rule === "PLANNING_WEEKEND_RECOVERY")!;
      const contradictory = {
        ...raw,
        issues: [],
        weekendAssessment: weekendResult([]).weekendAssessment,
        [container]: [finding],
      };
      expect(persistentCheckValue(contradictory)).toBe(false);
    },
  );
  it("accepts complete, unknown and met assessments without requiring a finding", () => {
    expect(persistentCheckValue(weekendResult())).toBe(true);
    expect(persistentCheckValue(weekendResult([]))).toBe(true);
    const unknown = calculateMonthlyCompliance("2026-11", [], work.timeZone, {
      employmentProfile: { ...work, allEmploymentWorkRecorded: false },
      allEmploymentWorkRecorded: false,
      referenceDate: "2026-11-30",
    });
    expect(unknown.weekendAssessment!.unknownCount).toBeGreaterThan(0);
    expect(persistentCheckValue(unknown)).toBe(true);
  });
  it.each([
    ["null", null],
    ["missing shape", {}],
    ["wrong month", { month: "2026-10" }],
    ["wrong count", { freeCount: 5 }],
    ["missing windows", { windows: [] }],
  ])("rejects malformed monthly assessment: %s", (_label, patch) => {
    const raw = weekendResult();
    expect(
      persistentCheckValue({
        ...raw,
        weekendAssessment:
          patch === null || Object.keys(patch).length === 0
            ? patch
            : { ...raw.weekendAssessment, ...patch },
      }),
    ).toBe(false);
  });
  it("rejects an incomplete window schema", () => {
    const raw = weekendResult();
    const assessment = raw.weekendAssessment!;
    expect(
      persistentCheckValue({
        ...raw,
        weekendAssessment: {
          ...assessment,
          windows: assessment.windows.map((window, index) =>
            index === 0 ? { ...window, assessmentComplete: undefined } : window,
          ),
        },
      }),
    ).toBe(false);
  });
  it.each(["issues", "prerequisites", "scopeNotes"] as const)(
    "validates new finding facts in %s",
    (container) => {
      const raw = weekendResult();
      const finding = raw.issues.find((item) => item.rule === "PLANNING_WEEKEND_RECOVERY")!;
      expect(finding).toBeDefined();
      for (const facts of [
        undefined,
        {},
        { rule: finding.rule, assessment: { ...raw.weekendAssessment, month: "2026-10" } },
        { rule: finding.rule, assessment: weekendResult([]).weekendAssessment },
      ]) {
        expect(
          persistentCheckValue({ ...raw, issues: [], [container]: [{ ...finding, facts }] }),
        ).toBe(false);
      }
    },
  );
});
