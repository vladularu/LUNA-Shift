import type { TargetAdjustment, WorkingTimeTargetProfile } from "@/domain/working-time-target";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import type { RuleResolver } from "@/rules/rule-resolver";

export interface CalendarSpecialDayResolution {
  readonly status: "AVAILABLE" | "LOADING" | "UNAVAILABLE";
  readonly days: ReadonlyMap<string, TargetAdjustment>;
}

/** Display adapter only: never classify tariff days as public holidays or infer a new entitlement. */
export function resolveCalendarSpecialDays(
  month: string,
  profile: WorkingTimeTargetProfile,
  resolver: RuleResolver,
): CalendarSpecialDayResolution {
  const empty = new Map<string, TargetAdjustment>();
  const input = profile.workingTimeTarget;
  if (!input) return { status: "AVAILABLE", days: empty };
  if (input.status !== "ready")
    return { status: input.status === "loading" ? "LOADING" : "UNAVAILABLE", days: empty };
  try {
    const target = calculateMonthlyWorkingTimeTarget(month, profile, resolver);
    return {
      status: target.status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
      days: new Map(
        target.adjustments
          .filter((day) => day.kind === "TARIFF_SPECIAL_DAY")
          .map((day) => [day.date, day]),
      ),
    };
  } catch {
    // The caller displays a coverage notice. An invalid input must not crash the calendar.
    return { status: "UNAVAILABLE", days: empty };
  }
}
