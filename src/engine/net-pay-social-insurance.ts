import { Big, RoundingMode } from "bigdecimal.js";

import type { NetPayProfile, NetPaySocialInsurance } from "@/domain/net-pay";

/** SVBezGrV 2026; ordinary full-month payroll only, no transition zone. */
export const NET_PAY_RULES_2026 = Object.freeze({
  healthMonthlyLimitCents: 581_250,
  pensionMonthlyLimitCents: 845_000,
  transitionZoneUpperCents: 200_000,
  healthRateBps: 1_460,
  pensionRateBps: 1_860,
  unemploymentRateBps: 260,
  careEmployeeRateBps: 180,
  saxonyCareEmployeeRateBps: 230,
  careChildlessSurchargeBps: 60,
  careChildDiscountBps: 25,
});

function contribution(cents: number, rateBps: number, shared: boolean): number {
  return Big(String(cents))
    .multiply(Big(String(rateBps)))
    .divide(Big(shared ? "20000" : "10000"), 0, RoundingMode.HALF_UP)
    .numberValue();
}

export function careDiscountCount(profile: NetPayProfile): number {
  return Math.max(0, Math.min(5, profile.childrenUnder25) - 1);
}

/** Called only with validated, supported inputs from calculateMonthlyNetPay. */
export function calculateNetPaySocialInsurance2026(
  socialInsuranceGrossCents: number,
  profile: NetPayProfile,
  childlessSurcharge: boolean,
): NetPaySocialInsurance {
  const rules = NET_PAY_RULES_2026;
  const healthBasisCents = Math.min(socialInsuranceGrossCents, rules.healthMonthlyLimitCents);
  const pensionBasisCents = Math.min(socialInsuranceGrossCents, rules.pensionMonthlyLimitCents);
  // The GKV standard and additional contributions are rounded separately (§ 2 BVV).
  const healthStandardCents = contribution(healthBasisCents, rules.healthRateBps, true);
  const healthAdditionalCents = contribution(
    healthBasisCents,
    profile.healthAdditionalRateBps,
    true,
  );
  const careRateBps =
    (profile.worksInSaxony ? rules.saxonyCareEmployeeRateBps : rules.careEmployeeRateBps) +
    (childlessSurcharge ? rules.careChildlessSurchargeBps : 0) -
    careDiscountCount(profile) * rules.careChildDiscountBps;
  const careCents = contribution(healthBasisCents, careRateBps, false);
  const pensionCents = contribution(pensionBasisCents, rules.pensionRateBps, true);
  const unemploymentCents = contribution(pensionBasisCents, rules.unemploymentRateBps, true);
  const healthCents = healthStandardCents + healthAdditionalCents;
  return Object.freeze({
    healthBasisCents,
    pensionBasisCents,
    healthStandardCents,
    healthAdditionalCents,
    healthCents,
    careCents,
    pensionCents,
    unemploymentCents,
    totalCents: healthCents + careCents + pensionCents + unemploymentCents,
  });
}
