import type { AllowanceStatus, ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleConditions } from "@/rules/contracts.generated";

function normalizedIdentifier(value: string): string {
  return value.toLowerCase().replaceAll("_", "-");
}

export function conditionsMatch(
  conditions: RuleConditions,
  profile: UserProfile,
  date: string,
  shift: ShiftEntry | null,
  allowanceStatus: AllowanceStatus | null,
): boolean {
  const shiftType = shift ? normalizedIdentifier(shift.type) : null;
  const tariff = profile.tariff;
  return (
    (conditions.requiresShiftTypes.length === 0 ||
      (shiftType !== null && conditions.requiresShiftTypes.includes(shiftType))) &&
    (shiftType === null || !conditions.excludesShiftTypes.includes(shiftType)) &&
    (conditions.payGroups === null ||
      (tariff !== null && conditions.payGroups.includes(tariff.payGroup.toLowerCase()))) &&
    (conditions.sectors === null ||
      (tariff !== null && conditions.sectors.includes(tariff.sector))) &&
    (conditions.tariffRegions == null ||
      (tariff !== null && conditions.tariffRegions.includes(tariff.tariffRegion))) &&
    (conditions.federalStates === null ||
      conditions.federalStates.includes(profile.federalState)) &&
    (conditions.holidayPremiumModes === null ||
      (shift !== null && conditions.holidayPremiumModes.includes(shift.holidayPremiumMode))) &&
    (conditions.allowanceStatuses === null ||
      (allowanceStatus !== null &&
        allowanceStatus !== "NONE" &&
        conditions.allowanceStatuses.includes(allowanceStatus))) &&
    (conditions.monthDays === null || conditions.monthDays.includes(date.slice(5)))
  );
}

/** One synchronous traversal of immutable inputs; evaluate only on the first applicable minute. */
export function createPayConditionMatcher(
  profile: UserProfile,
  shift: ShiftEntry,
  allowanceStatus: AllowanceStatus | null = null,
) {
  const dates = new Map<string, Map<RuleConditions, boolean>>();
  return (conditions: RuleConditions, date: string) => {
    const cache = dates.get(date) ?? new Map<RuleConditions, boolean>();
    const existing = cache.get(conditions);
    if (existing !== undefined) return existing;
    const result = conditionsMatch(conditions, profile, date, shift, allowanceStatus);
    cache.set(conditions, result);
    dates.set(date, cache);
    return result;
  };
}
