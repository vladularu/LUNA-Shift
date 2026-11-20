import { formatMonthTitle } from "@/engine/calendar";
import type { MonthlyPayEstimate } from "@/domain/types";

export function provisionalTariffCaption(months?: readonly string[]): string | undefined {
  if (!months?.length) return undefined;
  return "Vorläufig · Tarifstand " + [...new Set(months)].sort().map(formatMonthTitle).join(" / ");
}

export function salaryTariffCaption(
  pay: MonthlyPayEstimate | null | undefined,
): string | undefined {
  if (!pay) return undefined;
  return provisionalTariffCaption(pay.provisionalTariffMonths);
}
