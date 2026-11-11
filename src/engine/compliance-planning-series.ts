import { PLANNING_GUIDANCE_POLICY } from "@/domain/planning-guidance-policy";
import { PLANNING_NIGHT_POLICY } from "@/domain/planning-night-policy";
import type { ComplianceIssue } from "@/domain/types";
import type { RuleLegalRules } from "@/rules/contracts.generated";
import { createComplianceIssue as issue, germanQuantity } from "./compliance-issue";
import {
  consecutiveDateStreaks,
  type ComplianceInterval as Interval,
} from "./compliance-sequences";
import { isNightWork } from "./compliance-night-work";

export function checkPlanningSeries(
  intervals: readonly Interval[],
  rules: RuleLegalRules,
  includeLegacyNightSeries = true,
): ComplianceIssue[] {
  const shifts = intervals.map((item) => item.shift);
  const issues: ComplianceIssue[] = [];
  for (const streak of consecutiveDateStreaks(shifts)) {
    if (streak.length >= PLANNING_GUIDANCE_POLICY.firstWorkSeriesHint) {
      issues.push(
        issue(
          "warning",
          "PLANNING",
          "PLANNING_7_DAYS",
          `${germanQuantity(PLANNING_GUIDANCE_POLICY.firstWorkSeriesHint, true)} oder mehr Arbeitstage in Folge`,
          `${streak.length} aufeinanderfolgende Arbeitstage wurden erkannt.`,
          streak,
          undefined,
          { rule: "PLANNING_7_DAYS", count: streak.length },
        ),
      );
    }
  }

  if (!includeLegacyNightSeries) return issues;

  const nightShifts = intervals
    .filter((item) => isNightWork(item, rules))
    .map((item) => item.shift);
  for (const streak of consecutiveDateStreaks(nightShifts)) {
    if (streak.length >= PLANNING_NIGHT_POLICY.firstNightHint) {
      issues.push(
        issue(
          "warning",
          "PLANNING",
          "PLANNING_NIGHT_SERIES",
          `${germanQuantity(PLANNING_NIGHT_POLICY.firstNightHint, true)} oder mehr Nachtdienste in Folge`,
          `${streak.length} aufeinanderfolgende Nachtdienste wurden erkannt.`,
          streak,
          undefined,
          { rule: "PLANNING_NIGHT_SERIES", count: streak.length },
        ),
      );
    }
  }

  return issues;
}
