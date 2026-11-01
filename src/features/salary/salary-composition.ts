import type { AllowanceStatus, MonthlyPayEstimate, UserProfile } from "@/domain/types";
import type { SalaryPaymentProjection } from "@/domain/salary-payment";
import { formatMonthTitle } from "@/engine/calendar";

export function salaryPaymentHint(
  projection: Pick<SalaryPaymentProjection, "month" | "contributions"> &
    Partial<Pick<SalaryPaymentProjection, "issues">>,
): string | null {
  const missing = [
    ...new Set(
      projection.issues
        ?.filter((issue) => issue.kind === "MISSING_MONTH")
        .map((issue) => issue.month) ?? [],
    ),
  ].sort();
  if (missing.length)
    return `Zulagen für ${missing.map(formatMonthTitle).join(" und ")} noch offen`;
  const variable = projection.contributions.filter(
    (part) =>
      ["PREMIUMS", "MONTHLY_ALLOWANCE", "HOURLY_ALLOWANCE", "OVERTIME", "SPECIAL_DUTY"].includes(
        part.group,
      ) &&
      part.paymentMonth === projection.month &&
      part.amountCents > 0,
  );
  const older = [
    ...new Set(
      variable.filter((part) => part.claimMonth < projection.month).map((part) => part.claimMonth),
    ),
  ].sort();
  if (!older.length) return null;
  const partial = variable.some(
    (part) => part.claimMonth === projection.month && part.amountCents > 0,
  );
  return `Zulagen ${partial ? "teilweise " : ""}aus ${older.map(formatMonthTitle).join(" und ")}`;
}

const ALLOWANCE_LABELS: Readonly<Record<AllowanceStatus, string>> = {
  NONE: "Schichtzulage",
  SHIFT_MONTHLY: "Ständige Schichtzulage",
  SHIFT_HOURLY: "Nichtständige Schichtzulage",
  ALTERNATING_MONTHLY: "Ständige Wechselschichtzulage",
  ALTERNATING_HOURLY: "Nichtständige Wechselschichtzulage",
};

type SalaryCompositionRow = {
  readonly label: string;
  readonly value: string;
  readonly subtitle?: string;
};

function euro(value: number | null): string {
  return value === null
    ? "–"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}
export function salaryComposition(
  profile: UserProfile,
  pay: MonthlyPayEstimate,
  projection?: SalaryPaymentProjection,
) {
  const manualSalary = profile.tariff === null && profile.manualMonthlyGrossCents != null;
  const caption = salaryProfileCaption(profile);
  const allowanceParts = projection?.contributions.filter(
    (part) =>
      (part.group === "MONTHLY_ALLOWANCE" || part.group === "HOURLY_ALLOWANCE") &&
      part.amountCents > 0,
  );
  const allowancePays =
    allowanceParts?.map(
      (part) => projection!.sources.find((source) => source.month === part.claimMonth)!.pay,
    ) ?? [];
  const allowancePay = allowancePays[0] ?? pay;
  const mixedAllowance =
    new Set(
      allowancePays.map(
        (sourcePay) => sourcePay.confirmedAllowance ?? sourcePay.assessment.suggestedAllowance,
      ),
    ).size > 1;
  const compositionRows: readonly SalaryCompositionRow[] = manualSalary
    ? [{ label: "Monatsbrutto", value: euro(pay.personalBaseAmount) }]
    : [
        {
          label:
            profile.nursingTrainingTariff || profile.tvalPflegeTariff
              ? "Ausbildungsentgelt"
              : "Grundentgelt",
          value: euro(pay.personalBaseAmount),
        },
        {
          label: "Zeitzuschläge",
          value: euro(
            projection?.issues.some((issue) => issue.group === "PREMIUMS")
              ? null
              : pay.timePremiumAmount,
          ),
        },
        ...(pay.overtimeAmount > 0
          ? [{ label: "Überstunden", value: euro(pay.overtimeAmount) }]
          : []),
        ...((pay.specialDutyAmount ?? 0) > 0
          ? [
              {
                label: "Bereitschaftsvergütung",
                value: euro(pay.specialDutyAmount!),
              },
            ]
          : []),
        ...(pay.allowanceAmount > 0
          ? [
              {
                label: mixedAllowance
                  ? "Schichtzulagen"
                  : ALLOWANCE_LABELS[
                      allowancePay.confirmedAllowance ?? allowancePay.assessment.suggestedAllowance
                    ],
                subtitle: (
                  allowancePays.length
                    ? allowancePays.some((sourcePay) => sourcePay.confirmedAllowance === null)
                    : allowancePay.confirmedAllowance === null
                )
                  ? "Geschätzt"
                  : undefined,
                value: euro(pay.allowanceAmount),
              },
            ]
          : []),
        ...(pay.tvoedAllowanceAmount > 0
          ? [
              {
                label: "TVöD-Zulage",
                value: euro(pay.tvoedAllowanceAmount),
              },
            ]
          : []),
        ...(pay.careAllowanceAmount > 0
          ? [
              {
                label: profile.tvhKrTariff
                  ? "Pflegezulage TV-H"
                  : profile.tvUkNursingTariff
                    ? "Pflegezulage TV-UK"
                    : profile.tvlKrTariff
                      ? "Pflegezulage TV-L"
                      : "Pflegezulage TVöD-P",
                value: euro(pay.careAllowanceAmount),
              },
            ]
          : []),
      ];

  return { caption, compositionRows };
}

export function salaryProfileCaption(profile: UserProfile) {
  const manualSalary = profile.tariff === null && profile.manualMonthlyGrossCents != null;
  const caption = manualSalary
    ? "Manuell hinterlegt"
    : profile.tvalPflegeTariff
      ? `TVA-L Pflege · ${profile.tvalPflegeTariff.trainingYear}. Ausbildungsjahr`
      : profile.tvhKrTariff
        ? `TV-H ${profile.tvhKrTariff.payGroup} · Stufe ${profile.tvhKrTariff.payLevel}`
        : profile.tvUkNursingTariff
          ? "TV-UK " +
            profile.tvUkNursingTariff.payGroup.replace("PUK", "P-UK") +
            " · Stufe " +
            profile.tvUkNursingTariff.payLevel
          : profile.tvlKrTariff
            ? `TV-L ${profile.tvlKrTariff.payGroup} · Stufe ${profile.tvlKrTariff.payLevel}`
            : profile.vkaETariff
              ? `TVöD ${profile.vkaETariff.payGroup} · Stufe ${profile.vkaETariff.payLevel}`
              : profile.nursingTrainingTariff
                ? `TVAöD Pflege · ${profile.nursingTrainingTariff.trainingYear}. Ausbildungsjahr`
                : profile.tariff
                  ? `TVöD-P ${profile.tariff.payGroup} · Stufe ${profile.tariff.payLevel}`
                  : null;

  return caption;
}
