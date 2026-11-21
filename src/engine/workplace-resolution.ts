import type {
  ComplianceIssue,
  MonthlyComplianceResult,
  ShiftEntry,
  UserProfile,
} from "@/domain/types";
import { rulesAt, type QuestionId } from "@/domain/workplace-rules";
import { planningWeekendIssues } from "./planning-weekends";

export function applyWorkplacePlanning(
  result: MonthlyComplianceResult,
  history: UserProfile["workplaceHistory"],
  shifts: readonly ShiftEntry[],
): MonthlyComplianceResult {
  if (!history?.length) return result;
  const covers = (topic: QuestionId, date: string) => {
    const rule = rulesAt(history, date)[topic];
    return rule && rule.mode !== "none" && rule.mode !== "unknown";
  };
  const assessment = result.weekendAssessment;
  const windows = assessment?.windows.map((window) =>
    covers("weekend", window.until) ? { ...window, workplaceRuleApplies: true as const } : window,
  );
  const weekendsChanged = windows?.some((window) => window.workplaceRuleApplies);
  const weekendAssessment =
    weekendsChanged && assessment && windows
      ? windows.every((window) => window.workplaceRuleApplies)
        ? undefined
        : { ...assessment, windows }
      : assessment;
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
  const issues = result.issues.flatMap((issue) => {
    if (issue.kind !== "PLANNING") return [issue];
    if (issue.rule === "PLANNING_WEEKEND_RECOVERY" && weekendsChanged)
      return weekendAssessment ? planningWeekendIssues(weekendAssessment) : [];
    const local = rulesAt(history, issue.date);
    if (issue.rule === "PLANNING_7_DAYS" && local.series?.mode === "limit") return [];
    if (
      issue.rule === "PLANNING_LATE_EARLY" &&
      local.switch?.mode === "switch" &&
      local.switch.from === "LATE" &&
      local.switch.to === "EARLY"
    )
      return [];
    const facts = issue.facts;
    if (facts?.rule === "PLANNING_NIGHT_SERIES" || facts?.rule === "PLANNING_NIGHT_RECOVERY") {
      const sequence = facts.nightSequence;
      const next = sequence?.nextShiftId ? shiftsById.get(sequence.nextShiftId) : null;
      const recovery = rulesAt(history, next?.date ?? issue.date).recovery;
      const hasRecovery = recovery?.mode === "recovery" && facts.count >= recovery.nights;
      // Night-work recommendations also cover shifts recorded under a different type.
      const nightsMatch = issue.relatedShiftIds
        .filter((id) => id !== sequence?.nextShiftId)
        .every((id) => shiftsById.get(id)?.type === "NIGHT");
      if (!nightsMatch) return [issue];
      const hasNight = local.night?.mode === "off" || local.night?.mode === "limit";
      if (facts.rule === "PLANNING_NIGHT_RECOVERY") return hasRecovery ? [] : [issue];
      if (hasNight) {
        if (!sequence || hasRecovery || !["under24", "under48"].includes(sequence.recoveryStatus))
          return [];
        return [
          {
            ...issue,
            id: issue.id.replace("PLANNING_NIGHT_SERIES", "PLANNING_NIGHT_RECOVERY"),
            rule: "PLANNING_NIGHT_RECOVERY",
            title: "Erholung nach dem Nachtblock",
            facts: {
              rule: "PLANNING_NIGHT_RECOVERY" as const,
              count: facts.count,
              nightSequence: sequence,
            },
          },
        ];
      }
    }
    return [issue];
  });
  return {
    ...result,
    issues,
    weekendAssessment,
    criticalCount: issues.filter((i) => i.severity === "critical").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
    affectedDates: [...new Set(issues.map((i) => i.date))].sort(),
  };
}

// Compare evidence for one transition; different duties on the same date stay independent.
export function restFindingKeys(issues: readonly ComplianceIssue[]) {
  return issues.flatMap((issue) => {
    const facts = issue.facts;
    if (
      issue.kind !== "LEGAL" ||
      (facts?.rule !== "ARBZG_5_REST_10H" && facts?.rule !== "JARBSCHG_13_REST")
    )
      return [];
    return [JSON.stringify([issue.date, issue.relatedShiftIds, facts.restMinutes])];
  });
}
