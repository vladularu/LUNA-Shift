import type { NetPayPensionScheme } from "./net-pay-automation";

export type NetPayCalculationMode = "VERIFIED" | "FORECAST";

export interface NetPayCalculationBasis {
  readonly payrollYear: number;
  /** Year of the tax, social-insurance, pension and SFN assumptions, not the shift dates. */
  readonly rulesYear: number;
  readonly status: "VERIFIED" | "PREVIOUS_YEAR_ESTIMATE";
  readonly revision: string;
}

/** Inputs are explicit payroll assumptions, not inferred from a tariff label. */
export interface NetPayProfile {
  readonly birthDate: string;
  readonly taxClass: 1 | 2 | 3 | 4 | 5 | 6;
  /** null means no factor procedure; otherwise the ELStAM factor in thousandths. */
  readonly factorPermille: number | null;
  readonly churchTaxRatePercent: 0 | 8 | 9;
  /** 1 means a child allowance of 0.5; unrelated to Pflegeversicherung children. */
  readonly childAllowanceHalfUnits: number;
  readonly isParent: boolean;
  /** Eligible children for this payroll month, already confirmed by the caller. */
  readonly childrenUnder25: number;
  readonly worksInSaxony: boolean;
  /** Full, employer/employee combined additional GKV rate: 269 means 2.69%. */
  readonly healthAdditionalRateBps: number;
  /** Monthly ELStAM allowance, not an annual allowance. */
  readonly monthlyTaxAllowanceCents: number;
}

export interface NetPayAmounts {
  readonly grossCents: number;
  readonly taxableGrossCents: number;
  readonly socialInsuranceGrossCents: number;
  /** Regular expected SV income used to detect the transition zone. */
  readonly regularMonthlySocialInsuranceGrossCents: number;
}

export type NetPaySpecialCase =
  | "PRIVATE_INSURANCE"
  | "MINIJOB"
  | "MIDIJOB"
  | "MULTIPLE_EMPLOYMENTS"
  | "ONE_OFF_PAYMENT"
  | "ADDITIONAL_DEDUCTIONS"
  | "PARTIAL_MONTH"
  | "PENSIONER"
  | "APPRENTICE"
  | "OTHER_INSURANCE_STATUS";

export interface NetPayInput {
  readonly month: string;
  readonly profile: NetPayProfile | null;
  readonly amounts: NetPayAmounts;
  /** An empty list explicitly confirms ordinary full-month GKV/RV/AV payroll. */
  readonly specialCases: readonly NetPaySpecialCase[];
  readonly employmentKind?: "EMPLOYEE" | "APPRENTICE";
  readonly pension?: {
    readonly scheme: NetPayPensionScheme;
    readonly contributionBasisCents: number;
    readonly regularContributionBasisCents: number;
    readonly employeeRateBps?: number;
  };
  readonly additionalNetDeductionCents?: number;
}

export interface NetPayPension {
  readonly scheme: NetPayPensionScheme;
  readonly contributionBasisCents: number;
  readonly employeeCents: number;
  readonly taxableAdjustmentCents: number;
  readonly socialInsuranceAdjustmentCents: number;
}

export interface NetPaySocialInsurance {
  readonly healthBasisCents: number;
  readonly pensionBasisCents: number;
  readonly healthStandardCents: number;
  readonly healthAdditionalCents: number;
  readonly healthCents: number;
  readonly careCents: number;
  readonly pensionCents: number;
  readonly unemploymentCents: number;
  readonly totalCents: number;
}

export interface NetPayTax {
  readonly wageTaxCents: number;
  readonly solidarityCents: number;
  readonly churchTaxBasisCents: number;
  readonly churchTaxCents: number;
  readonly totalCents: number;
}

export type NetPayResult =
  | {
      readonly status: "available";
      readonly month: string;
      readonly ruleVersion: "DE-2026-PAP1-SV2026-PROTOTYPE";
      readonly calculationBasis?: NetPayCalculationBasis;
      readonly amounts: NetPayAmounts;
      readonly tax: NetPayTax;
      readonly socialInsurance: NetPaySocialInsurance;
      readonly pension?: NetPayPension;
      readonly additionalNetDeductionCents?: number;
      /** Before unmodelled personal deductions; not the guaranteed bank payment. */
      readonly netCents: number;
    }
  | {
      readonly status: "missing-profile" | "invalid-input" | "unsupported";
      readonly reason: string;
    };
