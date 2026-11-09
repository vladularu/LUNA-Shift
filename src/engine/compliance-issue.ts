import type {
  ComplianceIssue,
  ComplianceKind,
  ComplianceSeverity,
  ShiftEntry,
} from "@/domain/types";
import type { ComplianceIssueFacts } from "@/domain/compliance-issue-facts";

function stableId(rule: string, date: string, shiftIds: readonly string[]): string {
  return `${rule}:${date}:${[...shiftIds].sort().join(",")}`;
}

export function createComplianceIssue(
  severity: ComplianceSeverity,
  kind: ComplianceKind,
  rule: string,
  title: string,
  description: string,
  related: readonly ShiftEntry[],
  date = related.at(-1)?.date ?? "0000-00-00",
  facts?: ComplianceIssueFacts,
): ComplianceIssue {
  const relatedShiftIds = related.map((shift) => shift.id);
  return {
    id: stableId(rule, date, relatedShiftIds),
    severity,
    kind,
    rule,
    title,
    description,
    relatedShiftIds,
    date,
    ...(facts === undefined ? {} : { facts }),
  };
}

export function germanQuantity(value: number, capitalize = false): string {
  const words: Readonly<Record<number, string>> = {
    5: "fünf",
    6: "sechs",
    7: "sieben",
  };
  const valueLabel = words[value] ?? String(value);
  return capitalize ? `${valueLabel.charAt(0).toUpperCase()}${valueLabel.slice(1)}` : valueLabel;
}
