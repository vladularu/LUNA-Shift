import { Temporal } from "@js-temporal/polyfill";
import { Big, RoundingMode } from "bigdecimal.js";

import type {
  NetPayCalculationMode,
  NetPayInput,
  NetPayProfile,
  NetPayResult,
  NetPayTax,
} from "@/domain/net-pay";
import { isNetPayProfileValid } from "@/domain/net-pay-profile";
import {
  calculateNetPaySocialInsurance2026,
  careDiscountCount,
  NET_PAY_RULES_2026,
} from "@/engine/net-pay-social-insurance";
import { Lohnsteuer2026 } from "@/vendor/bmf/lohnsteuer2026";
import { calculateNetPayPension2026 } from "./net-pay-pension";
import { resolveNetPayCalculationBasis } from "./net-pay-calculation-basis";

function integerInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function ageOn(birthDate: Temporal.PlainDate, date: Temporal.PlainDate): number {
  return birthDate.until(date, { largestUnit: "years" }).years;
}

export function calculateTax2026(
  taxableGrossCents: number,
  profile: NetPayProfile,
  childlessSurcharge: boolean,
  oneOff?: { readonly grossCents: number; readonly annualTaxableGrossCents: number },
): NetPayTax {
  // All PAP defaults are made explicit where they affect the supported scope.
  // In 2026 KRV=0 and ALV=0 mean insured (older PAP years differ).
  const tax = new Lohnsteuer2026({
    RE4: String(taxableGrossCents),
    LZZ: 2,
    STKL: profile.taxClass,
    af: profile.factorPermille === null ? 0 : 1,
    f: profile.factorPermille === null ? 1 : profile.factorPermille / 1_000,
    R: profile.churchTaxRatePercent === 0 ? 0 : 1,
    ZKF: Big(String(profile.childAllowanceHalfUnits)).divide(Big("2")).toString(),
    KVZ: Big(String(profile.healthAdditionalRateBps)).divide(Big("100")).toString(),
    PVS: profile.worksInSaxony ? 1 : 0,
    PVZ: childlessSurcharge ? 1 : 0,
    PVA: String(careDiscountCount(profile)),
    PKV: 0,
    KRV: 0,
    ALV: 0,
    ALTER1: 0,
    LZZFREIB: String(profile.monthlyTaxAllowanceCents),
    LZZHINZU: "0",
    SONSTB: String(oneOff?.grossCents ?? 0),
    JRE4: String(oneOff?.annualTaxableGrossCents ?? 0),
    JFREIB: String(profile.monthlyTaxAllowanceCents * 12),
  });
  tax.MAIN();
  const wageTaxCents = tax.getLstlzz().numberValue() + tax.getSts().numberValue();
  const solidarityCents = tax.getSolzlzz().numberValue() + tax.getSolzs().numberValue();
  const churchTaxBasisCents = tax.getBk().numberValue() + tax.getBks().numberValue();
  // Fractions of a cent are discarded, not rounded commercially.
  const churchTaxCents = [tax.getBk().numberValue(), tax.getBks().numberValue()].reduce(
    (sum, basis) =>
      sum +
      Big(String(basis))
        .multiply(Big(String(profile.churchTaxRatePercent)))
        .divide(Big("100"), 0, RoundingMode.DOWN)
        .numberValue(),
    0,
  );
  return Object.freeze({
    wageTaxCents,
    solidarityCents,
    churchTaxBasisCents,
    churchTaxCents,
    totalCents: wageTaxCents + solidarityCents + churchTaxCents,
  });
}

/**
 * Offline model: regular full-month payroll, GKV with Krankengeld,
 * mandatory RV/AV, no other deductions. Amounts must already be classified;
 * this does not infer SFN exemption from tariff premium labels.
 */
export function calculateMonthlyNetPay(
  input: NetPayInput,
  mode: NetPayCalculationMode = "VERIFIED",
): NetPayResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    return { status: "invalid-input", reason: "Der Abrechnungsmonat ist ungültig." };
  }
  const calculationBasis = resolveNetPayCalculationBasis(input.month, mode);
  if (!calculationBasis || calculationBasis.rulesYear !== 2026) {
    return {
      status: "unsupported",
      reason:
        mode === "FORECAST"
          ? "Für dieses Jahr fehlen Berechnungsgrundlagen für eine vorläufige Netto-Prognose."
          : "Der Prototyp unterstützt ausschließlich 2026.",
    };
  }
  if (input.profile === null || input.profile === undefined) {
    return { status: "missing-profile", reason: "Die Angaben für die Netto-Prognose fehlen." };
  }
  const profile = input.profile;
  if (!isNetPayProfileValid(profile)) {
    return {
      status: "invalid-input",
      reason: "Die Steuer- oder Versicherungsangaben sind ungültig.",
    };
  }
  if (!Array.isArray(input.specialCases)) {
    return { status: "invalid-input", reason: "Der Beschäftigungsumfang muss bestätigt werden." };
  }
  const apprentice = input.employmentKind === "APPRENTICE";
  if (
    input.employmentKind !== undefined &&
    !["EMPLOYEE", "APPRENTICE"].includes(input.employmentKind)
  )
    return { status: "invalid-input", reason: "Die Beschäftigungsart ist ungültig." };
  if (input.specialCases.some((value) => value !== "APPRENTICE" || !apprentice)) {
    return { status: "unsupported", reason: "Dieser Abrechnungsfall ist noch nicht unterstützt." };
  }
  const amounts = input.amounts;
  if (
    !amounts ||
    !Object.values(amounts).every((value) => integerInRange(value, 0, 10_000_000)) ||
    !integerInRange(amounts.grossCents, 1, 10_000_000) ||
    !integerInRange(amounts.taxableGrossCents, 0, amounts.grossCents) ||
    !integerInRange(
      amounts.socialInsuranceGrossCents,
      amounts.taxableGrossCents,
      amounts.grossCents,
    ) ||
    !integerInRange(amounts.regularMonthlySocialInsuranceGrossCents, 1, 10_000_000)
  ) {
    return {
      status: "invalid-input",
      reason: "Die Bruttobeträge sind ungültig oder widersprüchlich.",
    };
  }
  let birthDate: Temporal.PlainDate;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(profile.birthDate)) throw new Error("Invalid date format");
    birthDate = Temporal.PlainDate.from(profile.birthDate);
  } catch {
    return { status: "invalid-input", reason: "Das Geburtsdatum ist ungültig." };
  }
  const monthStart = Temporal.PlainDate.from(`${input.month}-01`);
  const ageAtMonthStart = ageOn(birthDate, monthStart);
  if (
    ageAtMonthStart < (apprentice ? 15 : 18) ||
    ageOn(birthDate, monthStart.with({ month: 1, day: 1 })) >= 64
  ) {
    return {
      status: "unsupported",
      reason: "Dieser Alters- oder Versorgungsfall ist nicht unterstützt.",
    };
  }
  // The childless surcharge starts AFTER the month of the 23rd birthday (§ 55 SGB XI).
  const childlessSurcharge =
    !profile.isParent && Temporal.PlainDate.compare(birthDate.add({ years: 23 }), monthStart) < 0;
  const additionalNetDeductionCents = input.additionalNetDeductionCents ?? 0;
  if (!integerInRange(additionalNetDeductionCents, 0, 10_000_000))
    return { status: "invalid-input", reason: "Die weiteren Netto-Abzüge sind ungültig." };
  let pension;
  let regularPension;
  try {
    pension = input.pension
      ? calculateNetPayPension2026(
          input.pension.scheme,
          input.pension.contributionBasisCents,
          input.pension.employeeRateBps,
        )
      : undefined;
    regularPension = input.pension
      ? calculateNetPayPension2026(
          input.pension.scheme,
          input.pension.regularContributionBasisCents,
          input.pension.employeeRateBps,
        )
      : undefined;
  } catch (failure) {
    return {
      status: "unsupported",
      reason:
        failure instanceof Error ? failure.message : "Die Zusatzversorgung ist nicht unterstützt.",
    };
  }
  const adjustedAmounts = {
    ...amounts,
    taxableGrossCents: amounts.taxableGrossCents + (pension?.taxableAdjustmentCents ?? 0),
    socialInsuranceGrossCents:
      amounts.socialInsuranceGrossCents + (pension?.socialInsuranceAdjustmentCents ?? 0),
    regularMonthlySocialInsuranceGrossCents:
      amounts.regularMonthlySocialInsuranceGrossCents +
      (regularPension?.socialInsuranceAdjustmentCents ?? 0),
  };
  if (
    ![
      adjustedAmounts.taxableGrossCents,
      adjustedAmounts.socialInsuranceGrossCents,
      adjustedAmounts.regularMonthlySocialInsuranceGrossCents,
    ].every((value) => integerInRange(value, 0, 10_000_000))
  )
    return {
      status: "invalid-input",
      reason: "Die Zusatzversorgungsbeträge passen nicht zum Entgelt.",
    };
  if (
    adjustedAmounts.regularMonthlySocialInsuranceGrossCents <=
    (apprentice ? 32_500 : NET_PAY_RULES_2026.transitionZoneUpperCents)
  )
    return {
      status: "unsupported",
      reason: apprentice
        ? "Ausbildungsentgelte bis 325 Euro benötigen eine gesonderte Beitragsberechnung."
        : "Mini- und Midijobs benötigen eine eigene Berechnung.",
    };
  const socialInsurance = calculateNetPaySocialInsurance2026(
    adjustedAmounts.socialInsuranceGrossCents,
    profile,
    childlessSurcharge,
  );
  const tax = calculateTax2026(adjustedAmounts.taxableGrossCents, profile, childlessSurcharge);
  const netCents =
    amounts.grossCents -
    tax.totalCents -
    socialInsurance.totalCents -
    (pension?.employeeCents ?? 0) -
    additionalNetDeductionCents;
  if (netCents < 0) {
    return { status: "invalid-input", reason: "Die Abzüge übersteigen das angegebene Brutto." };
  }
  return Object.freeze({
    status: "available",
    month: input.month,
    ruleVersion: "DE-2026-PAP1-SV2026-PROTOTYPE",
    calculationBasis,
    amounts: Object.freeze(adjustedAmounts),
    tax,
    socialInsurance,
    ...(pension ? { pension } : {}),
    ...(additionalNetDeductionCents ? { additionalNetDeductionCents } : {}),
    netCents,
  });
}
