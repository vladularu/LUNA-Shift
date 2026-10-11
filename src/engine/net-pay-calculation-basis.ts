import type { NetPayCalculationBasis, NetPayCalculationMode } from "@/domain/net-pay";

/** Only register a new rules year together with its engine and reference tests. */
const BASES: Readonly<Record<number, NetPayCalculationBasis>> = Object.freeze({
  2026: Object.freeze({
    payrollYear: 2026,
    rulesYear: 2026,
    status: "VERIFIED",
    revision: "DE-NET-2026-VERIFIED-v1",
  }),
  2027: Object.freeze({
    payrollYear: 2027,
    rulesYear: 2026,
    status: "PREVIOUS_YEAR_ESTIMATE",
    revision: "DE-NET-2027-ESTIMATE-2026-v1",
  }),
});

export function resolveNetPayCalculationBasis(
  month: string,
  mode: NetPayCalculationMode = "VERIFIED",
): NetPayCalculationBasis | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const basis = BASES[Number(month.slice(0, 4))];
  if (!basis || (basis.status !== "VERIFIED" && mode !== "FORECAST")) return null;
  return basis;
}
