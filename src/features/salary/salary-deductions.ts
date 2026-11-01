import type { NetPayResult } from "@/domain/net-pay";

export interface SalaryDeductionRow {
  readonly id:
    | "wage-tax"
    | "solidarity"
    | "church-tax"
    | "pension-insurance"
    | "unemployment-insurance"
    | "health-insurance"
    | "care-insurance"
    | "supplementary-pension"
    | "other-net";
  readonly label: string;
  readonly amountCents: number;
}

/** Uses the finalized payroll amounts, including any already incorporated annual payment. */
export function salaryDeductions(pay: Extract<NetPayResult, { status: "available" }>): {
  readonly totalCents: number;
  readonly rows: readonly SalaryDeductionRow[];
} {
  const rows: SalaryDeductionRow[] = [
    { id: "wage-tax", label: "Lohnsteuer", amountCents: pay.tax.wageTaxCents },
  ];
  if (pay.tax.solidarityCents > 0)
    rows.push({
      id: "solidarity",
      label: "Solidaritätszuschlag",
      amountCents: pay.tax.solidarityCents,
    });
  if (pay.tax.churchTaxCents > 0)
    rows.push({ id: "church-tax", label: "Kirchensteuer", amountCents: pay.tax.churchTaxCents });
  rows.push(
    {
      id: "pension-insurance",
      label: "Rentenversicherung",
      amountCents: pay.socialInsurance.pensionCents,
    },
    {
      id: "unemployment-insurance",
      label: "Arbeitslosenversicherung",
      amountCents: pay.socialInsurance.unemploymentCents,
    },
    {
      id: "health-insurance",
      label: "Krankenversicherung",
      amountCents: pay.socialInsurance.healthCents,
    },
    {
      id: "care-insurance",
      label: "Pflegeversicherung",
      amountCents: pay.socialInsurance.careCents,
    },
  );
  if (pay.pension && pay.pension.scheme !== "NONE")
    rows.push({
      id: "supplementary-pension",
      label: "Zusatzversorgung",
      amountCents: pay.pension.employeeCents,
    });
  if ((pay.additionalNetDeductionCents ?? 0) > 0)
    rows.push({
      id: "other-net",
      label: "Weitere Netto-Abzüge",
      amountCents: pay.additionalNetDeductionCents!,
    });
  return { totalCents: pay.amounts.grossCents - pay.netCents, rows };
}
