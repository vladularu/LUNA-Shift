import type { SfnNetPayInput, SfnNetPayResult } from "@/domain/net-pay-sfn";
import type { RuleResolver } from "@/rules/rule-resolver";

import { calculateMonthlyNetPay } from "./net-pay";
import { classifySfnPayroll2026 } from "./net-pay-sfn";

export function calculateMonthlyNetPayWithSfn(
  input: SfnNetPayInput,
  ruleResolver: RuleResolver,
): SfnNetPayResult {
  const classification = classifySfnPayroll2026(input.payroll, ruleResolver);
  if (classification.status !== "available")
    return Object.freeze({ status: "unavailable", stage: "sfn", reason: classification.reason });
  if (
    input.profile &&
    input.profile.worksInSaxony !== (input.payroll.workplace?.federalState === "SN")
  ) {
    return Object.freeze({
      status: "unavailable",
      stage: "net-pay",
      reason:
        "Beschäftigungsort Sachsen ist im Steuerprofil und in der SFN-Zuordnung widersprüchlich.",
    });
  }
  const pay = calculateMonthlyNetPay({
    month: input.payroll.month,
    profile: input.profile,
    specialCases: input.specialCases,
    amounts: classification.amounts,
  });
  if (pay.status !== "available")
    return Object.freeze({ status: "unavailable", stage: "net-pay", reason: pay.reason });
  return Object.freeze({ status: "available", classification, pay });
}
