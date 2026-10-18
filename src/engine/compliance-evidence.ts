import type { ComplianceIssue, FederalState, HolidayRegion } from "@/domain/types";
import { isNightWork } from "@/engine/compliance-night-work";
import type { ComplianceInterval } from "@/engine/compliance-sequences";
import { createComplianceIssue as issue } from "@/engine/compliance-issue";
import type { RuleLegalRules } from "@/rules/contracts.generated";

export interface ComplianceEvidenceOptions {
  readonly allEmploymentWorkRecorded?: boolean | null;
  readonly federalState?: FederalState;
  readonly holidayRegion?: HolidayRegion;
  readonly regularRotatingNightWork?: boolean | null;
}

export function checkEvidenceCompleteness(
  month: string,
  intervals: readonly ComplianceInterval[],
  options: ComplianceEvidenceOptions,
  rules: RuleLegalRules,
): ComplianceIssue[] {
  const monthIntervals = intervals.filter((item) => item.shift.date.startsWith(`${month}-`));
  const firstShift = monthIntervals[0]?.shift;
  if (!firstShift) return [];
  const issues: ComplianceIssue[] = [];
  if (options.allEmploymentWorkRecorded !== true) {
    issues.push(
      issue(
        "warning",
        "LEGAL",
        "ARBZG_DATA_ALL_EMPLOYMENT",
        "Arbeitszeiten aus allen Jobs erfasst?",
        "Für eine vollständige Prüfung müssen die Arbeitszeiten aus allen Jobs erfasst sein.",
        [firstShift],
      ),
    );
  }
  if (
    options.regularRotatingNightWork == null &&
    monthIntervals.some((item) => isNightWork(item, rules))
  ) {
    issues.push(
      issue(
        "warning",
        "LEGAL",
        "ARBZG_6_NIGHT_STATUS_UNKNOWN",
        "Regelmäßige Nacht- oder Wechselschichtarbeit?",
        "Diese Angabe fehlt für die Nachtarbeitsprüfung.",
        [firstShift],
      ),
    );
  }
  if (
    options.holidayRegion === "UNKNOWN" &&
    options.federalState !== undefined &&
    ["BY", "SN", "TH"].includes(options.federalState)
  ) {
    issues.push(
      issue(
        "warning",
        "LEGAL",
        "HOLIDAY_REGION_UNKNOWN",
        "Welche regionalen Feiertage gelten?",
        "Fehlende Angaben können die Prüfung von Feiertagen und Ersatzruhetagen einschränken.",
        [firstShift],
      ),
    );
  }
  return issues;
}
