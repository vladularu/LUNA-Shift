import { Temporal } from "@js-temporal/polyfill";
import { PLANNING_NIGHT_POLICY, type PlanningNightSequence } from "./planning-night-policy";
import {
  PLANNING_WEEKEND_POLICY,
  validPlanningWeekendAssessment,
  type PlanningWeekendAssessment,
  type PlanningWeekendSequence,
} from "./planning-weekend-policy";

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
  | { readonly rule: "PLANNING_7_DAYS"; readonly count: number }
  | {
      readonly rule: "PLANNING_NIGHT_SERIES";
      readonly count: number;
      readonly nightSequence?: PlanningNightSequence;
    }
  | {
      readonly rule: "PLANNING_NIGHT_RECOVERY";
      readonly count: number;
      readonly nightSequence: PlanningNightSequence;
    }
  | { readonly rule: "PLANNING_LATE_EARLY" }
  | { readonly rule: "PLANNING_WEEKEND_RECOVERY"; readonly assessment: PlanningWeekendAssessment }
  | {
      readonly rule: "PLANNING_WEEKENDS";
      /** Missing only on findings produced by the earlier, retired weekend rule. */
      readonly count?: number;
      readonly weekendSeries?: PlanningWeekendSequence;
    };

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
      valid = minutes(facts.count) && facts.count > 0;
      break;
    case "PLANNING_NIGHT_SERIES":
    case "PLANNING_NIGHT_RECOVERY":
      valid =
        minutes(facts.count) &&
        facts.count > 0 &&
        (facts.nightSequence === undefined
          ? facts.rule === "PLANNING_NIGHT_SERIES"
          : validNightSequence(facts.nightSequence, facts.count));
      if (valid && facts.nightSequence !== undefined) {
        const sequence = facts.nightSequence as PlanningNightSequence;
        valid =
          facts.rule === "PLANNING_NIGHT_SERIES"
            ? (facts.count as number) >= PLANNING_NIGHT_POLICY.firstNightHint
            : (facts.count as number) >= PLANNING_NIGHT_POLICY.minimumSeriesForRecovery &&
              (sequence.recoveryStatus === "under24" || sequence.recoveryStatus === "under48");
      }
      break;
    case "PLANNING_LATE_EARLY":
      valid = true;
      break;
    case "PLANNING_WEEKEND_RECOVERY":
      valid =
        validPlanningWeekendAssessment(facts.assessment) &&
        facts.assessment.windows.some(
          (window) =>
            window.assessmentComplete &&
            window.unknownCount === 0 &&
            window.freeCount < PLANNING_WEEKEND_POLICY.minimumFreeWeekends,
        );
      break;
    case "PLANNING_WEEKENDS":
      valid =
        facts.count === undefined && facts.weekendSeries === undefined
          ? true
          : minutes(facts.count) &&
            facts.count >= PLANNING_WEEKEND_POLICY.firstOccupiedWeekendHint &&
            validWeekendSequence(facts.weekendSeries, facts.count);
      break;
  }
  return valid ? (value as ComplianceIssueFacts) : null;
}

function validWeekendSequence(value: unknown, count: number): value is PlanningWeekendSequence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sequence = value as Record<string, unknown>;
  if (
    sequence.policyVersion !== "2026-11-08" ||
    !calendarDate(sequence.firstSaturday) ||
    !calendarDate(sequence.lastSunday)
  )
    return false;
  const first = Temporal.PlainDate.from(sequence.firstSaturday);
  const last = Temporal.PlainDate.from(sequence.lastSunday);
  return (
    first.dayOfWeek === 6 && last.dayOfWeek === 7 && last.since(first).days === (count - 1) * 7 + 1
  );
}

function validNightSequence(value: unknown, count: number): value is PlanningNightSequence {
  if (!value || typeof value !== "object") return false;
  const sequence = value as Record<string, unknown>;
  if (
    sequence.policyVersion !== PLANNING_NIGHT_POLICY.version ||
    !calendarDate(sequence.firstNight) ||
    !calendarDate(sequence.lastNight) ||
    Temporal.PlainDate.from(sequence.lastNight).since(Temporal.PlainDate.from(sequence.firstNight))
      .days !==
      count - 1 ||
    typeof sequence.countIsMinimum !== "boolean" ||
    typeof sequence.lastShiftId !== "string" ||
    !(sequence.nextShiftId === null || typeof sequence.nextShiftId === "string")
  )
    return false;
  const rest = sequence.restMinutes;
  if (rest !== null && sequence.nextShiftId === null) return false;
  switch (sequence.recoveryStatus) {
    case "open":
    case "unknown":
      return rest === null;
    case "under24":
      return minutes(rest) && rest < PLANNING_NIGHT_POLICY.minimumRecoveryMinutes;
    case "under48":
      return (
        minutes(rest) &&
        rest >= PLANNING_NIGHT_POLICY.minimumRecoveryMinutes &&
        rest < PLANNING_NIGHT_POLICY.preferredRecoveryMinutes
      );
    case "atLeast48":
      return minutes(rest) && rest >= PLANNING_NIGHT_POLICY.preferredRecoveryMinutes;
    default:
      return false;
  }
}
