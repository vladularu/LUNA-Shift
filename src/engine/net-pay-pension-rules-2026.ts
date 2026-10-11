import type { KnownNetPayPensionScheme } from "@/domain/net-pay-pension-schemes";

interface PensionRules {
  readonly employeeBps: number;
  readonly employeeCapitalBps: number;
  readonly employerCapitalBps: number;
  readonly employerUmlageBps: number;
  readonly flatTaxAllowanceCents: number;
  readonly sharedCapitalBps?: number;
}

/** Monthly distribution, ordinary tariff contributions, no Riester or salary conversion.
 * Sources: docs/brutto-netto-zusatzversorgung-erweiterung.md and brutto-netto-zvk-darmstadt.md.
 * Employer restructuring payments are not employee deductions or capital contributions.
 */
export const NET_PAY_PENSION_RULES_2026: Readonly<Record<KnownNetPayPensionScheme, PensionRules>> =
  {
    VBL_WEST: {
      employeeBps: 181,
      employeeCapitalBps: 0,
      employerCapitalBps: 0,
      employerUmlageBps: 549,
      flatTaxAllowanceCents: 9203,
    },
    VBL_EAST: {
      employeeBps: 425,
      employeeCapitalBps: 425,
      employerCapitalBps: 200,
      employerUmlageBps: 106,
      flatTaxAllowanceCents: 8948,
    },
    KZVK: {
      employeeBps: 40,
      employeeCapitalBps: 40,
      employerCapitalBps: 560,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
    },
    KZVK_DORTMUND: {
      employeeBps: 75,
      employeeCapitalBps: 75,
      employerCapitalBps: 525,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
    },
    EZVK_DARMSTADT: {
      employeeBps: 0,
      employeeCapitalBps: 0,
      employerCapitalBps: 660,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
      sharedCapitalBps: 660,
    },
    EZVK_KARLSRUHE: {
      employeeBps: 0,
      employeeCapitalBps: 0,
      employerCapitalBps: 700,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
      sharedCapitalBps: 700,
    },
    BVK_I: {
      employeeBps: 0,
      employeeCapitalBps: 0,
      employerCapitalBps: 400,
      employerUmlageBps: 375,
      flatTaxAllowanceCents: 8948,
    },
    BVK_II: {
      employeeBps: 0,
      employeeCapitalBps: 0,
      employerCapitalBps: 480,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
    },
    KVBW_I: {
      employeeBps: 55,
      employeeCapitalBps: 0,
      employerCapitalBps: 65,
      employerUmlageBps: 575,
      flatTaxAllowanceCents: 8948,
    },
    KVBW_II: {
      employeeBps: 40,
      employeeCapitalBps: 40,
      employerCapitalBps: 810,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
    },
    RZVK: {
      employeeBps: 0,
      employeeCapitalBps: 0,
      employerCapitalBps: 0,
      employerUmlageBps: 425,
      flatTaxAllowanceCents: 8948,
    },
    KVW_I: {
      employeeBps: 0,
      employeeCapitalBps: 0,
      employerCapitalBps: 0,
      employerUmlageBps: 450,
      flatTaxAllowanceCents: 8948,
    },
    KVW_II: {
      employeeBps: 40,
      employeeCapitalBps: 40,
      employerCapitalBps: 400,
      employerUmlageBps: 250,
      flatTaxAllowanceCents: 8948,
    },
    KVK_I: {
      employeeBps: 65,
      employeeCapitalBps: 0,
      employerCapitalBps: 0,
      employerUmlageBps: 585,
      flatTaxAllowanceCents: 8948,
    },
    ZVK_DARMSTADT_I: {
      employeeBps: 50,
      employeeCapitalBps: 0,
      employerCapitalBps: 0,
      employerUmlageBps: 570,
      flatTaxAllowanceCents: 8948,
    },
    ZVK_DARMSTADT_II: {
      employeeBps: 40,
      employeeCapitalBps: 40,
      // The employer's 0.49% restructuring surcharge is outside ordinary capital contributions.
      employerCapitalBps: 611,
      employerUmlageBps: 0,
      flatTaxAllowanceCents: 0,
    },
    KVBBG: {
      employeeBps: 240,
      employeeCapitalBps: 240,
      employerCapitalBps: 240,
      employerUmlageBps: 110,
      flatTaxAllowanceCents: 8948,
    },
    ZVK_SACHSEN: {
      employeeBps: 240,
      employeeCapitalBps: 240,
      employerCapitalBps: 246,
      employerUmlageBps: 160,
      flatTaxAllowanceCents: 8948,
    },
    ZVK_THUERINGEN: {
      employeeBps: 240,
      employeeCapitalBps: 240,
      employerCapitalBps: 200,
      employerUmlageBps: 170,
      flatTaxAllowanceCents: 8948,
    },
  };
