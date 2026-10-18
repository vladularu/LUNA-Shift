export type AnnualPaymentNetBasis =
  | { readonly kind: "CONSTANT_PAY" }
  | {
      readonly kind: "PAYROLL";
      /** Projected taxable annual pay including earlier one-offs, excluding this payment. */
      readonly annualTaxableGrossCents: number;
      /** SV days and already assessed bases through the payment month, excluding this payment. */
      readonly socialInsuranceDays: number;
      readonly healthAssessedCents: number;
      readonly pensionAssessedCents: number;
    };

/** A confirmed amount belongs to a cash month, never to every subsequent month. */
export interface AnnualSalaryPayment {
  readonly revision: number;
  readonly payoutMonth: string;
  readonly grossCents: number;
  readonly netBasis: AnnualPaymentNetBasis | null;
}

export function annualSalaryGrossCents(
  month: string,
  payments: readonly AnnualSalaryPayment[] = [],
): number {
  return payments.find((payment) => payment.payoutMonth === month)?.grossCents ?? 0;
}

function money(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 120_000_000
  );
}
function keys(value: object, expected: readonly string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

export function validateAnnualSalaryPayments(value: unknown): readonly AnnualSalaryPayment[] {
  if (!Array.isArray(value) || value.length > 120)
    throw new Error("Die Sonderzahlungen sind ungültig.");
  const seen = new Set<string>();
  return Object.freeze(
    value.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        !keys(item, ["revision", "payoutMonth", "grossCents", "netBasis"]) ||
        !Number.isSafeInteger(item.revision) ||
        item.revision < 1 ||
        item.revision > 1_000_000_000 ||
        !money(item.grossCents) ||
        item.grossCents > 10_000_000
      )
        throw new Error("Die Sonderzahlung ist ungültig.");
      if (
        typeof item.payoutMonth !== "string" ||
        !/^(19\d{2}|[2-3]\d{3}|40\d{2})-(0[1-9]|1[0-2])$/.test(item.payoutMonth)
      )
        throw new Error("Ungültiger Auszahlungsmonat.");
      const payoutMonth: string = item.payoutMonth;
      if (seen.has(payoutMonth))
        throw new Error("Sonderzahlungen eines Monats bitte als Gesamtbetrag erfassen.");
      seen.add(payoutMonth);
      const basis = item.netBasis;
      if (
        basis !== null &&
        (!basis ||
          typeof basis !== "object" ||
          Array.isArray(basis) ||
          (basis.kind === "CONSTANT_PAY"
            ? !keys(basis, ["kind"])
            : basis.kind !== "PAYROLL" ||
              !keys(basis, [
                "kind",
                "annualTaxableGrossCents",
                "socialInsuranceDays",
                "healthAssessedCents",
                "pensionAssessedCents",
              ]) ||
              !money(basis.annualTaxableGrossCents) ||
              !money(basis.healthAssessedCents) ||
              !money(basis.pensionAssessedCents) ||
              !Number.isSafeInteger(basis.socialInsuranceDays) ||
              basis.socialInsuranceDays < 1 ||
              basis.socialInsuranceDays > Number(payoutMonth.slice(5)) * 30))
      )
        throw new Error("Die Jahresgrundlagen der Sonderzahlung sind ungültig.");
      return Object.freeze({
        revision: item.revision,
        payoutMonth,
        grossCents: item.grossCents,
        netBasis: basis === null ? null : Object.freeze({ ...basis }),
      }) as AnnualSalaryPayment;
    }),
  );
}
