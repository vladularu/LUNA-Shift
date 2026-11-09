import { describe, expect, it } from "vitest";
import type { ComplianceIssue, MonthlyComplianceResult } from "@/domain/types";
import { buildAnnualCoreReport } from "./annual-core-report";
import {
  classifyChecks,
  countChecks,
  isCheckPrerequisite,
  selectAnnualCheckDisplay,
  selectVisibleCompliance,
} from "./check-visibility";

const issues: readonly ComplianceIssue[] = [
  {
    id: "legal",
    kind: "LEGAL",
    severity: "critical",
    rule: "REST",
    title: "Ruhezeit",
    description: "",
    date: "2026-09-01",
    relatedShiftIds: [],
  },
  {
    id: "info",
    kind: "LEGAL",
    severity: "info",
    rule: "EVIDENCE",
    title: "Angaben offen",
    description: "",
    date: "2026-09-02",
    relatedShiftIds: [],
  },
  {
    id: "planning",
    kind: "PLANNING",
    severity: "warning",
    rule: "NIGHTS",
    title: "Nachtserie",
    description: "",
    date: "2026-09-03",
    relatedShiftIds: [],
  },
];
const monthly: MonthlyComplianceResult = {
  month: "2026-09",
  issues,
  criticalCount: 1,
  warningCount: 1,
  infoCount: 1,
  affectedDates: issues.map((issue) => issue.date),
};

describe("display-only check selection", () => {
  it("clears retired observations and stale prerequisite counts from a projected cache", () => {
    const retired: ComplianceIssue = {
      ...issues[2],
      id: "retired-open",
      rule: "PLANNING_WEEKENDS",
    };
    const cached = { ...monthly, issues: [], prerequisites: [retired], prerequisiteCount: 1 };
    const original = JSON.stringify(cached);
    const selected = selectVisibleCompliance(cached, true);
    expect(selected.prerequisites).toBeUndefined();
    expect(selected.prerequisiteCount).toBeUndefined();
    expect(selected).not.toHaveProperty("tariffPrerequisiteCount");
    expect(selectVisibleCompliance(selected, true)).toEqual(selected);
    expect(JSON.stringify(cached)).toBe(original);
  });
  it.each([true, false])(
    "retires old three-weekend findings without hiding legal findings when planning is %s",
    (showPlanning) => {
      const retired: ComplianceIssue = {
        ...issues[2],
        id: "retired-weekends",
        rule: "PLANNING_WEEKENDS",
        severity: "info",
      };
      const current: ComplianceIssue = {
        ...retired,
        id: "four-weekends",
        rule: "PLANNING_WEEKEND_RECOVERY",
      };
      const unknown: ComplianceIssue = {
        ...retired,
        id: "unknown-planning",
        rule: "UNKNOWN_PLANNING_RULE",
        severity: "critical",
      };
      const legal: ComplianceIssue = {
        ...retired,
        id: "same-name-legal",
        kind: "LEGAL",
        severity: "critical",
      };
      const raw = { ...monthly, issues: [...issues, retired, current, unknown, legal] };
      const original = JSON.stringify(raw);
      const selected = selectVisibleCompliance(raw, showPlanning);
      expect(selected.issues.some((issue) => issue.id === retired.id)).toBe(false);
      expect(selected.issues).toContain(legal);
      expect(selected.issues.includes(current)).toBe(showPlanning);
      expect(selected.issues.includes(unknown)).toBe(showPlanning);
      expect(selectVisibleCompliance(selected, showPlanning)).toEqual(selected);
      expect(JSON.stringify(raw)).toBe(original);
    },
  );
  it("excludes retired weekend observations from raw category counts and annual display", () => {
    const retired: ComplianceIssue = {
      ...issues[2],
      id: "old-weekend",
      rule: "PLANNING_WEEKENDS",
      severity: "info",
    };
    const actual: ComplianceIssue = {
      ...retired,
      id: "new-weekend",
      rule: "PLANNING_WEEKEND_RECOVERY",
    };
    expect(countChecks([retired])).toEqual({ criticalCount: 0, warningCount: 0, infoCount: 0 });
    expect(classifyChecks([retired, actual]).planning.infoCount).toBe(1);
    const core = buildAnnualCoreReport(2026, [], { timeZone: "Europe/Berlin" });
    const report = {
      ...core,
      months: core.months.map((month, index) => ({
        ...month,
        checkCounts: classifyChecks(index === 10 ? [retired, actual] : []),
      })),
    };
    expect(selectAnnualCheckDisplay(report, true).infoCount).toBe(1);
    expect(selectAnnualCheckDisplay(report, false).infoCount).toBe(0);
  });
  it("keeps recurring special-duty scope out of findings, dates and warning counts", () => {
    const notices = [1, 2, 3].map((day) => ({
      ...issues[0],
      id: `scope-${day}`,
      date: `2026-09-0${day}`,
      severity: "warning" as const,
      rule: "SPECIAL_DUTY_REVIEW",
    }));
    const raw = { ...monthly, issues: [...notices, ...issues] };
    const visible = selectVisibleCompliance(raw, false);
    expect(visible.issues).toEqual(issues.slice(0, 2));
    expect(visible.scopeNotes).toEqual(notices);
    expect(visible.scopeCount).toBe(1);
    expect(visible.prerequisiteCount).toBeUndefined();
    expect(visible.warningCount).toBe(0);
    expect(visible.affectedDates).toEqual(["2026-09-01", "2026-09-02"]);
    expect(selectVisibleCompliance(visible, false)).toEqual(visible);
    const categories = classifyChecks(notices);
    expect(categories.legal).toMatchObject({ warningCount: 0, infoCount: 0, scopeCount: 1 });
    expect(raw.issues).toHaveLength(6);
  });
  it("retains critical scope rules and incomplete callout findings", () => {
    const critical = { ...issues[0], rule: "SPECIAL_DUTY_REVIEW" };
    const incomplete = {
      ...issues[0],
      id: "callouts",
      severity: "warning" as const,
      rule: "SPECIAL_DUTY_CALLOUTS_INCOMPLETE",
    };
    const visible = selectVisibleCompliance({ ...monthly, issues: [critical, incomplete] }, false);
    expect(visible.issues).toEqual([critical, incomplete]);
    expect([visible.criticalCount, visible.warningCount]).toEqual([1, 1]);
    expect(visible.scopeCount).toBeUndefined();
    const restored = selectVisibleCompliance(
      {
        ...monthly,
        issues: [],
        scopeNotes: [critical, { ...incomplete, rule: "UNKNOWN_LEGAL_RULE" }],
        scopeCount: 1,
      },
      false,
    );
    expect([restored.criticalCount, restored.warningCount]).toEqual([1, 1]);
    expect(restored.scopeCount).toBeUndefined();
  });
  it("keeps annual scope distinct from missing inputs and warnings", () => {
    const notice = { ...issues[0], rule: "SPECIAL_DUTY_REVIEW", severity: "info" as const };
    const core = buildAnnualCoreReport(2026, [], { timeZone: "Europe/Berlin" });
    const raw = {
      ...core,
      months: core.months.map((month, index) => ({
        ...month,
        checkCounts: classifyChecks(index === 8 ? [notice] : []),
      })),
    };
    const visible = selectAnnualCheckDisplay(raw, false);
    expect(visible.scopeCount).toBe(1);
    expect(visible.months[8].scopeCount).toBe(1);
    expect(visible.prerequisiteCount).toBeUndefined();
    expect([visible.warningCount, visible.infoCount]).toEqual([0, 0]);
  });
  it("separates known prerequisites, retains actual findings and is stable on repeated selection", () => {
    const open = {
      ...issues[0],
      id: "open",
      rule: "ARBZG_10_ELIGIBILITY",
      severity: "warning" as const,
    };
    const incomplete = { ...open, id: "work", rule: "ARBZG_DATA_ALL_EMPLOYMENT" };
    const raw = { ...monthly, issues: [...issues, open, incomplete] };
    const displayed = selectVisibleCompliance(raw, true);
    expect(displayed.issues).toEqual(issues);
    expect(displayed.prerequisites).toEqual([open, incomplete]);
    expect(displayed.prerequisiteCount).toBe(2);
    expect(displayed.warningCount).toBe(1);
    expect(selectVisibleCompliance(displayed, true)).toEqual(displayed);
    expect(raw.issues).toHaveLength(5);
    expect(isCheckPrerequisite({ ...open, severity: "critical" })).toBe(false);
    expect(isCheckPrerequisite({ ...open, rule: "UNKNOWN_LEGAL_RULE" })).toBe(false);
    expect(selectVisibleCompliance(raw, false).criticalCount).toBe(1);
    expect(selectVisibleCompliance(raw, false).prerequisiteCount).toBe(2);
  });
  it("keeps annual prerequisites separate from warning totals and preserves them when planning is hidden", () => {
    const open = {
      ...issues[0],
      rule: "ARBZG_6_NIGHT_STATUS_UNKNOWN",
      severity: "warning" as const,
    };
    const core = buildAnnualCoreReport(2026, [], { timeZone: "Europe/Berlin" });
    const raw = {
      ...core,
      months: core.months.map((month, index) => ({
        ...month,
        checkCounts: classifyChecks(index === 8 ? [open, ...issues] : []),
      })),
    };
    const displayed = selectAnnualCheckDisplay(raw, false);
    expect(displayed.warningCount).toBe(0);
    expect(displayed.criticalCount).toBe(1);
    expect(displayed.prerequisiteCount).toBe(1);
    expect(displayed.months[8].prerequisiteCount).toBe(1);
    expect(selectAnnualCheckDisplay(displayed, true).warningCount).toBe(1);
  });
  it("retains legal critical and informational issues and derives counts/dates without mutation", () => {
    expect(selectVisibleCompliance(monthly, false)).toEqual({
      ...monthly,
      issues: issues.slice(0, 2),
      warningCount: 0,
      affectedDates: issues.slice(0, 2).map((issue) => issue.date),
    });
    expect(selectVisibleCompliance(monthly, true)).toEqual(monthly);
    expect(monthly.issues).toHaveLength(3);
  });
  it("projects annual and month counts from cached categories without changing pay/time/coverage", () => {
    const core = buildAnnualCoreReport(2026, [], { timeZone: "Europe/Berlin" });
    const report = {
      ...core,
      months: core.months.map((month, index) => ({
        ...month,
        checkCounts: classifyChecks(index === 8 ? issues : []),
      })),
      estimatedGrossAmount: 12345,
      complianceCoverageComplete: false,
    };
    const hidden = selectAnnualCheckDisplay(report, false);
    expect([hidden.criticalCount, hidden.warningCount, hidden.infoCount]).toEqual([1, 0, 1]);
    expect(hidden.months[8].infoCount).toBe(1);
    expect(hidden.estimatedGrossAmount).toBe(12345);
    expect(hidden.actualMinutes).toBe(report.actualMinutes);
    expect(hidden.complianceCoverageComplete).toBe(false);
    expect(selectAnnualCheckDisplay(report, true).warningCount).toBe(1);
    expect(selectAnnualCheckDisplay(hidden, true).warningCount).toBe(1);
  });
  it("never hides unclassified findings from older report objects", () => {
    const core = buildAnnualCoreReport(2026, [], { timeZone: "Europe/Berlin" });
    const report = { ...core, months: [{ ...core.months[0], warningCount: 2 }] };
    expect(selectAnnualCheckDisplay(report, false).warningCount).toBe(2);
  });
});
