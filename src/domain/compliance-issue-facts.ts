import { Temporal } from "@js-temporal/polyfill";

/** Presentation facts copied from a finding's calculation, never used to assess it. */
export type ComplianceIssueFacts =
  | {
      readonly rule: "ARBZG_5_REST_10H" | "JARBSCHG_13_REST";
      readonly restMinutes: number;
      readonly minimumRestMinutes: number;
    }
  | {
      readonly rule: "ARBZG_5_REST_11H";
      readonly restMinutes: number;
      readonly compensationMinutes: number;
      readonly compensationDeadline: string;
    }
  | {
      readonly rule: "ARBZG_4_BREAK";
      readonly recordedBreakMinutes: number;
      readonly requiredBreakMinutes: number;
    }
  | { readonly rule: "ARBZG_4_INTERRUPTION"; readonly interruptionMinutes: number }
  | {
      readonly rule: "ARBZG_3_MAX_10H";
      readonly netMinutes: number;
      readonly maximumMinutes: number;
    }
  | { readonly rule: "ARBZG_3_OVER_8H"; readonly netMinutes: number }
  | { readonly rule: "ARBZG_4_CONTINUOUS"; readonly maximumContinuousMinutes: number }
  | {
      readonly rule: "TIME_PLAUSIBILITY";
      readonly breakMinutes: number;
      readonly grossMinutes: number;
    }
  | { readonly rule: "TIME_GROSS_OVER_16H"; readonly grossMinutes: number }
  | { readonly rule: "PLANNING_7_DAYS" | "PLANNING_NIGHT_SERIES"; readonly count: number }
  | { readonly rule: "PLANNING_LATE_EARLY" | "PLANNING_WEEKENDS" };

const minutes = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
}

/** Reject malformed metadata without inferring replacement facts from localized text. */
export function validComplianceIssueFacts(
  value: unknown,
  rule: string,
): ComplianceIssueFacts | null {
  if (!value || typeof value !== "object" || !("rule" in value) || value.rule !== rule) return null;
  const facts = value as Record<string, unknown>;
  let valid = false;
  switch (facts.rule) {
    case "ARBZG_5_REST_10H":
    case "JARBSCHG_13_REST":
      valid =
        minutes(facts.restMinutes) &&
        minutes(facts.minimumRestMinutes) &&
        facts.minimumRestMinutes > 0;
      break;
    case "ARBZG_5_REST_11H":
      valid =
        minutes(facts.restMinutes) &&
        minutes(facts.compensationMinutes) &&
        facts.compensationMinutes > 0 &&
        calendarDate(facts.compensationDeadline);
      break;
    case "ARBZG_4_BREAK":
      valid = minutes(facts.recordedBreakMinutes) && minutes(facts.requiredBreakMinutes);
      break;
    case "ARBZG_4_INTERRUPTION":
      valid = minutes(facts.interruptionMinutes);
      break;
    case "ARBZG_3_MAX_10H":
      valid =
        minutes(facts.netMinutes) && minutes(facts.maximumMinutes) && facts.maximumMinutes > 0;
      break;
    case "ARBZG_3_OVER_8H":
      valid = minutes(facts.netMinutes);
      break;
    case "ARBZG_4_CONTINUOUS":
      valid = minutes(facts.maximumContinuousMinutes) && facts.maximumContinuousMinutes > 0;
      break;
    case "TIME_PLAUSIBILITY":
      valid = minutes(facts.breakMinutes) && minutes(facts.grossMinutes);
      break;
    case "TIME_GROSS_OVER_16H":
      valid = minutes(facts.grossMinutes);
      break;
    case "PLANNING_7_DAYS":
    case "PLANNING_NIGHT_SERIES":
      valid = minutes(facts.count) && facts.count > 0;
      break;
    case "PLANNING_LATE_EARLY":
    case "PLANNING_WEEKENDS":
      valid = true;
      break;
  }
  return valid ? (value as ComplianceIssueFacts) : null;
}
