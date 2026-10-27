import type { AllowanceStatus, MonthlyPayEstimate, UserProfile } from "@/domain/types";

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
export function salaryComposition(profile: UserProfile, pay: MonthlyPayEstimate) {
  const manualSalary = profile.tariff === null && profile.manualMonthlyGrossCents != null;
  const caption = salaryProfileCaption(profile);
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
          value: euro(pay.timePremiumAmount),
        },
        ...(pay.overtimeAmount > 0
          ? [{ label: "Überstunden", value: euro(pay.overtimeAmount) }]
          : []),
        ...(pay.allowanceAmount > 0
          ? [
              {
                label:
                  ALLOWANCE_LABELS[pay.confirmedAllowance ?? pay.assessment.suggestedAllowance],
                subtitle: pay.confirmedAllowance === null ? "Geschätzt" : undefined,
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
