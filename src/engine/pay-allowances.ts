import type { AllowanceStatus, UserProfile } from "@/domain/types";
import { conditionsMatch } from "@/engine/pay-conditions";
import type { RuleTariffPackage } from "@/rules/contracts.generated";

export interface AllowanceCalculationInput {
  readonly date: string;
  readonly fullTimeWeeklyMinutes: number;
  readonly profile: UserProfile;
  readonly rulePackage: RuleTariffPackage;
  readonly status: AllowanceStatus | null;
  readonly workMinutes: number;
  readonly allowExpiredAllowances?: boolean;
}

/** TVöD BT-K § 52 Abs. 5, including the KAV BW protocol. */
export function vkaEFixedAllowanceCents(selection: NonNullable<UserProfile["vkaETariff"]>) {
  if (selection.sector !== "BT_K" || ["E1", "E2", "E3", "E4"].includes(selection.payGroup))
    return 0;
  return selection.tariffRegion === "KAV_BW" ? 3500 : 2500;
}

export interface MonthlyAllowanceAmounts {
  readonly allowanceAmount: number;
  readonly careAllowanceAmount: number;
  readonly tvoedAllowanceAmount: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function configuredAllowanceAmount(
  rule: RuleTariffPackage["rules"]["allowanceRules"][number],
  workMinutes: number,
  profile: UserProfile,
  fullTimeWeeklyMinutes: number,
): number {
  if (profile.tariff === null) return 0;
  const amount =
    rule.amountKind === "FIXED_HOURLY"
      ? (workMinutes / 60) * (rule.amountCents / 100)
      : rule.amountCents / 100;
  const factor = rule.prorateByPartTime ? profile.weeklyMinutes / fullTimeWeeklyMinutes : 1;
  return roundMoney(amount * factor);
}

export function applicableAllowanceRules(
  allowanceType: "alternating-shift" | "care" | "shift" | "tvoed",
  input: AllowanceCalculationInput,
): readonly RuleTariffPackage["rules"]["allowanceRules"][number][] {
  // Older P catalogs encode the KAV Baden-Württemberg exception as two lists of states.
  // Match the published allowance against the employer's tariff region even with those catalogs.
  return input.rulePackage.rules.allowanceRules.filter(
    (rule) =>
      rule.allowanceType === allowanceType &&
      rule.validFrom <= input.date &&
      (rule.validTo === null || input.date <= rule.validTo) &&
      (allowanceType === "tvoed" &&
      rule.conditions.federalStates &&
      !rule.conditions.tariffRegions &&
      input.profile.tariff
        ? rule.conditions.federalStates.includes("BW") ===
            (input.profile.tariff.tariffRegion === "KAV_BW") &&
          conditionsMatch(
            { ...rule.conditions, federalStates: null },
            input.profile,
            input.date,
            null,
            input.status,
          )
        : conditionsMatch(rule.conditions, input.profile, input.date, null, input.status)),
  );
}

function matchingAllowanceAmount(
  allowanceType: "alternating-shift" | "care" | "shift" | "tvoed",
  input: AllowanceCalculationInput,
): number {
  const { date, fullTimeWeeklyMinutes, profile, status, workMinutes } = input;
  if (profile.tariff === null || (allowanceType.includes("shift") && status === null)) return 0;
  const candidates = applicableAllowanceRules(allowanceType, input);
  if (candidates.length === 0 && input.allowExpiredAllowances) return 0;
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one ${allowanceType} allowance rule on ${date}, found ${candidates.length}.`,
    );
  }
  return configuredAllowanceAmount(candidates[0], workMinutes, profile, fullTimeWeeklyMinutes);
}

export function calculateMonthlyAllowanceAmounts(
  input: AllowanceCalculationInput,
): MonthlyAllowanceAmounts {
  const { status } = input;
  const allowanceAmount =
    status === null || status === "NONE"
      ? 0
      : matchingAllowanceAmount(
          status.startsWith("ALTERNATING") ? "alternating-shift" : "shift",
          input,
        );
  return {
    allowanceAmount,
    careAllowanceAmount: matchingAllowanceAmount("care", input),
    tvoedAllowanceAmount: matchingAllowanceAmount("tvoed", input),
  };
}
