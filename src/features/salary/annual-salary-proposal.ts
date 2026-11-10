import { incompleteSpecialDuties } from "@/domain/special-duty-review";
import { employmentProfileAt } from "@/domain/employment-history";
import type { UserProfile } from "@/domain/types";
import { salaryMonthInputSteps, type SalaryMonthContext } from "./salary-month-input";
import { createAnnualSalaryProposalCache } from "./annual-salary-proposal-cache";
import type { AnnualSalaryIssue } from "./annual-salary-issue";

export interface AnnualSalaryProposal {
  readonly grossCents: number;
  readonly basisCents: number;
  readonly rateBasisPoints: number;
  readonly referenceMonths: readonly string[];
  readonly note: string;
}

const cachedProposal = createAnnualSalaryProposalCache();

/** Dated 2026 source-backed proposal, never a confirmation of the employee's entitlement.
 * High TV-H KR groups absent from the published JSZ mapping and other years stay manual.
 * See docs/jahressonderzahlung-netto-2026.md for the normative references.
 */
export function annualSalaryProposal(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
): AnnualSalaryProposal | null {
  const steps = annualSalaryProposalSteps(year, profile, context);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export function* annualSalaryProposalSteps(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
): Generator<number, AnnualSalaryProposal | null, void> {
  return (yield* annualSalaryProposalResultSteps(year, profile, context)).proposal;
}

export function* annualSalaryProposalResultSteps(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
): Generator<
  number,
  { readonly proposal: AnnualSalaryProposal | null; readonly issue: AnnualSalaryIssue | null },
  void
> {
  const unavailable = (issue: AnnualSalaryIssue) => ({ proposal: null, issue });
  if (year !== 2026) return unavailable({ code: "UNSUPPORTED_YEAR" });
  if (profile.salaryBasisConflict) return unavailable({ code: "SALARY_BASIS_CONFLICT" });
  if (context.testMonths?.length) return unavailable({ code: "TEST_DATA" });
  const contexts = [
    employmentProfileAt(profile, `${year}-01-01`),
    ...(profile.employmentTimeline ?? [])
      .filter((item) => item.employment && item.effectiveFrom?.startsWith(String(year)))
      .map((item) => employmentProfileAt(profile, item.effectiveFrom!)),
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
  if (new Set(contexts.map((p) => JSON.stringify(basis(p)))).size > 1)
    return unavailable({ code: "TARIFF_CHANGE" });
  profile = employmentProfileAt(profile, `${year}-12-01`);
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
    if (value > 12) return unavailable({ code: "UNSUPPORTED_GROUP" });
    rate = value <= 8 ? 9000 : 6000;
  } else if (profile.tvlKrTariff) {
    const value = group(profile.tvlKrTariff.payGroup);
    rate = value <= 6 ? 8743 : value <= 8 ? 8814 : value <= 15 ? 7435 : 4647;
  } else return unavailable({ code: "NO_TARIFF" });
  const referenceMonths = months.map((m) => `${year}-${String(m).padStart(2, "0")}`);
  const cached = cachedProposal.read(year, profile, context);
  if (cached !== null) return { proposal: cached, issue: null };
  let sum = 0;
  let referenceMonth = referenceMonths[0];
  try {
    for (const month of referenceMonths) {
      referenceMonth = month;
      const { pay } = yield* salaryMonthInputSteps(month, profile, context);
      if (!pay.available || pay.estimatedGrossAmount === null || pay.personalBaseAmount === null) {
        const duties = incompleteSpecialDuties(pay);
        return unavailable({
          code: "REFERENCE_MONTH_UNAVAILABLE",
          month,
          ...(duties.length ? { duties } : {}),
        });
      }
      sum += Math.round(
        (profile.tvalPflegeTariff
          ? pay.personalBaseAmount
          : pay.estimatedGrossAmount - pay.overtimeAmount) * 100,
      );
    }
  } catch {
    return unavailable({ code: "REFERENCE_MONTH_FAILED", month: referenceMonth });
  }
  const proposal = cachedProposal.write(year, profile, context, {
    grossCents: Math.round((sum * rate) / (months.length * 10_000)),
    basisCents: Math.round(sum / months.length),
    rateBasisPoints: rate,
    referenceMonths,
    note: profile.tvalPflegeTariff
      ? "Prognose bei vollem Jahresanspruch aus dem November-Ausbildungsentgelt. Zulagen und Zeitzuschläge erhöhen diese Grundlage nicht. Anspruch am Stichtag und mögliche Kürzungen sind nicht bestätigt."
      : profile.nursingTrainingTariff
        ? "Prognose bei vollem Jahresanspruch aus dem durchschnittlichen Entgelt von August bis Oktober einschließlich berücksichtigungsfähiger Zulagen. Zusätzliche Überstundenvergütung bleibt ausgenommen. Anspruch am Stichtag und mögliche Kürzungen sind nicht bestätigt."
        : "Vorschlag bei vollem Jahresanspruch und unveränderter gewählter Gehaltsbasis. Dienstplan und enthaltene Zulagen sind berücksichtigt, Überstunden ausgenommen. Beschäftigung am Stichtag, Fehlzeiten, Stufenwechsel und dienstplanmäßige Überstunden bitte prüfen; den Betrag gegebenenfalls anpassen.",
  });
  return { proposal, issue: null };
}
