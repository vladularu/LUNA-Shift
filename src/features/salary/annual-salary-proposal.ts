import { employmentProfileAt } from "@/domain/employment-history";
import type { UserProfile } from "@/domain/types";
import { salaryMonthInput, type SalaryMonthContext } from "./salary-month-input";

export interface AnnualSalaryProposal {
  readonly grossCents: number;
  readonly basisCents: number;
  readonly rateBasisPoints: number;
  readonly referenceMonths: readonly string[];
  readonly note: string;
}

/** Dated 2026 source-backed proposal, never a confirmation of the employee's entitlement.
 * High TV-H KR groups absent from the published JSZ mapping and other years stay manual.
 * See docs/jahressonderzahlung-netto-2026.md for the normative references.
 */
export function annualSalaryProposal(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
): AnnualSalaryProposal | null {
  const contexts = [
    employmentProfileAt(profile, `${year}-01-01`),
    ...(profile.employmentTimeline ?? [])
      .filter((item) => item.employment && item.effectiveFrom?.startsWith(String(year)))
      .map((item) => ({ ...profile, ...item.employment })),
  ];
  const basis = (p: UserProfile) => [
    p.tariff?.payGroup,
    p.vkaETariff?.payGroup,
    p.tvlKrTariff?.payGroup,
    p.tvhKrTariff?.payGroup,
    p.tvUkNursingTariff?.payGroup,
    !!p.nursingTrainingTariff,
    !!p.tvalPflegeTariff,
  ];
  if (new Set(contexts.map((p) => JSON.stringify(basis(p)))).size > 1) return null;
  profile = employmentProfileAt(profile, `${year}-12-01`);
  if (year !== 2026 || profile.salaryBasisConflict || context.testMonths?.length) return null;
  let rate: number;
  let months = [7, 8, 9];
  const group = (value: string) => Number(value.replace(/\D/g, ""));
  if (profile.nursingTrainingTariff) {
    rate = 9000;
    months = [8, 9, 10];
  } else if (profile.tvalPflegeTariff) {
    rate = 9500;
    months = [11];
  } else if (profile.tariff) rate = group(profile.tariff.payGroup) <= 8 ? 9000 : 8500;
  else if (profile.vkaETariff) rate = group(profile.vkaETariff.payGroup) <= 8 ? 9000 : 8500;
  else if (profile.tvUkNursingTariff) rate = 8800;
  else if (profile.tvhKrTariff) {
    const value = group(profile.tvhKrTariff.payGroup);
    if (value > 12) return null;
    rate = value <= 8 ? 9000 : 6000;
  } else if (profile.tvlKrTariff) {
    const value = group(profile.tvlKrTariff.payGroup);
    rate = value <= 6 ? 8743 : value <= 8 ? 8814 : value <= 15 ? 7435 : 4647;
  } else return null;
  const referenceMonths = months.map((m) => `${year}-${String(m).padStart(2, "0")}`);
  let sum = 0;
  try {
    for (const month of referenceMonths) {
      const { pay } = salaryMonthInput(month, profile, context);
      if (!pay.available || pay.estimatedGrossAmount === null || pay.personalBaseAmount === null)
        return null;
      sum += Math.round(
        (profile.tvalPflegeTariff
          ? pay.personalBaseAmount
          : pay.estimatedGrossAmount - pay.overtimeAmount) * 100,
      );
    }
  } catch {
    return null;
  }
  return {
    grossCents: Math.round((sum * rate) / (months.length * 10_000)),
    basisCents: Math.round(sum / months.length),
    rateBasisPoints: rate,
    referenceMonths,
    note: profile.tvalPflegeTariff
      ? "Prognose bei vollem Jahresanspruch aus dem November-Ausbildungsentgelt. Zulagen und Zeitzuschläge erhöhen diese Grundlage nicht. Anspruch am Stichtag und mögliche Kürzungen sind nicht bestätigt."
      : profile.nursingTrainingTariff
        ? "Prognose bei vollem Jahresanspruch aus dem durchschnittlichen Entgelt von August bis Oktober einschließlich berücksichtigungsfähiger Zulagen. Zusätzliche Überstundenvergütung bleibt ausgenommen. Anspruch am Stichtag und mögliche Kürzungen sind nicht bestätigt."
        : "Vorschlag bei vollem Jahresanspruch und unveränderter gewählter Gehaltsbasis. Dienstplan und enthaltene Zulagen sind berücksichtigt, Überstunden ausgenommen. Beschäftigung am Stichtag, Fehlzeiten, Stufenwechsel und dienstplanmäßige Überstunden bitte prüfen; den Betrag gegebenenfalls anpassen.",
  };
}
