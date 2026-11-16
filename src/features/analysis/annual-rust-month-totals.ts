/** Temporary Build-54 OTA adapter: Rust owns each month's financial calculation. */
type RecordValue = Record<string, unknown>;
export type AnnualSalarySource = "TARIFF" | "MANUAL" | "UNSET";
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function annualRustMonthTotals(
  year: number,
  source: AnnualSalarySource,
  outputs: readonly unknown[],
) {
  if (outputs.length !== 12) throw new Error("RUST_ANNUAL_MONTHS_INCOMPLETE");
  let estimatedGrossAmount = 0,
    premiumAmount = 0,
    overtimeAmount = 0,
    allowanceAmount = 0,
    availablePayMonthCount = 0;
  const months = outputs.map((output, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    if (!record(output) || output.month !== month || typeof output.available !== "boolean")
      throw new Error("RUST_ANNUAL_MONTH_INVALID");
    const available = output.available && output.estimatedGrossAmount !== null;
    if (!available)
      return { month, timePremiumAmount: null, estimatedGrossAmount: null, premiumAmount: 0 };
    const fields = [
      "estimatedGrossAmount",
      "timePremiumAmount",
      "overtimeAmount",
      "allowanceAmount",
      "tvoedAllowanceAmount",
      "careAllowanceAmount",
    ] as const;
    for (const field of fields)
      if (typeof output[field] !== "number" || !Number.isFinite(output[field]))
        throw new Error("RUST_ANNUAL_MONTH_INVALID");
    const pay = output as Record<(typeof fields)[number], number>;
    estimatedGrossAmount += pay.estimatedGrossAmount;
    premiumAmount += pay.timePremiumAmount;
    overtimeAmount += pay.overtimeAmount;
    allowanceAmount += pay.allowanceAmount + pay.tvoedAllowanceAmount + pay.careAllowanceAmount;
    availablePayMonthCount++;
    return {
      month,
      timePremiumAmount: source === "TARIFF" ? pay.timePremiumAmount : null,
      estimatedGrossAmount: pay.estimatedGrossAmount,
      premiumAmount:
        pay.timePremiumAmount +
        pay.overtimeAmount +
        pay.allowanceAmount +
        pay.tvoedAllowanceAmount +
        pay.careAllowanceAmount,
    };
  });
  return {
    year,
    salarySource: source,
    availablePayMonthCount,
    estimatedGrossAmount: money(estimatedGrossAmount),
    premiumAmount: money(premiumAmount),
    overtimeAmount: money(overtimeAmount),
    allowanceAmount: money(allowanceAmount),
    months,
  };
}
