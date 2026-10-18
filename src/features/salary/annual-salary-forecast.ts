import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import { annualPayoutMonths, salaryAnnualFamily } from "@/domain/salary-annual-schedule";
import type { UserProfile } from "@/domain/types";
import { annualSalaryProposal } from "./annual-salary-proposal";
import type { SalaryMonthContext } from "./salary-month-input";

/** Derived forecast only. Saved annual instalments (including zero) replace that year's schedule. */
export function annualSalaryForecast(
  year: number,
  profile: UserProfile,
  context: SalaryMonthContext,
  saved: readonly AnnualSalaryPayment[] = [],
) {
  const proposal = annualSalaryProposal(year, profile, context);
  const months = annualPayoutMonths(salaryAnnualFamily(profile), year);
  const automatic =
    proposal !== null &&
    months.length === 1 &&
    !saved.some((payment) => payment.payoutMonth.startsWith(`${year}-`));
  const payments: readonly AnnualSalaryPayment[] = automatic
    ? [
        ...saved,
        {
          revision: 1,
          payoutMonth: months[0],
          grossCents: proposal.grossCents,
          netBasis: { kind: "CONSTANT_PAY" },
        },
      ]
    : saved;
  return { payments, proposal, automatic };
}
