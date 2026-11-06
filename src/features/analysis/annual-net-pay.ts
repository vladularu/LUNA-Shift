import { resolveNetPaySettings, type SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { UserProfile } from "@/domain/types";
import type { SalaryPaymentPreferences } from "@/domain/salary-payment";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { prepareAutomaticNetPaySteps } from "@/features/salary/automatic-net-pay-preparation";
import type { SalaryMonthContext } from "@/features/salary/salary-month-input";
import { netPayCrossYearLabel, netPayForecastLabel } from "@/features/salary/net-pay-format";

export interface AnnualNetPayMonth {
  readonly month: string;
  readonly netCents: number | null;
  readonly status: string | null;
  readonly notes: readonly string[];
  readonly preliminary: boolean;
}
export interface AnnualNetPay {
  readonly year: number;
  readonly months: readonly AnnualNetPayMonth[];
  readonly netCents: number | null;
  readonly availableMonthCount: number;
  readonly notes: readonly string[];
  readonly preliminary: boolean;
}
export interface AnnualNetPayRequest {
  readonly year: number;
  readonly profile: UserProfile;
  readonly timeline: readonly SavedMonthlyNetPaySettings[];
  readonly context: SalaryMonthContext;
  readonly preferences: SalaryPaymentPreferences;
}
export function annualNetPayMonth(
  month: string,
  forecast: AutomaticNetPayForecast,
): AnnualNetPayMonth {
  if (forecast.result.status !== "available")
    return { month, netCents: null, status: forecast.result.reason, notes: [], preliminary: false };
  const pay = forecast.result.pay;
  const notes = [netPayForecastLabel(pay), netPayCrossYearLabel(forecast.payrollTimingEstimate)];
  if (forecast.pensionOmitted || forecast.annualPayment?.pensionOmitted)
    notes.push("Zusatzversorgung nicht berücksichtigt");
  if (forecast.annualPayment)
    notes.push(
      forecast.annualPayment.netIncluded
        ? "Jahressonderzahlung enthalten"
        : "Sonderzahlung nur im Brutto",
    );
  return {
    month,
    netCents: pay.netCents,
    status: null,
    notes: notes.filter((note): note is string => note !== null),
    preliminary: pay.calculationBasis?.status === "PREVIOUS_YEAR_ESTIMATE",
  };
}
export function summarizeAnnualNetPay(
  year: number,
  months: readonly AnnualNetPayMonth[],
): AnnualNetPay {
  const available = months.filter((month) => month.netCents !== null);
  return {
    year,
    months,
    netCents: available.length ? available.reduce((sum, month) => sum + month.netCents!, 0) : null,
    availableMonthCount: available.length,
    notes: [...new Set(available.flatMap((month) => month.notes))],
    preliminary: available.some((month) => month.preliminary),
  };
}
export function* annualNetPaySteps(
  input: AnnualNetPayRequest,
): Generator<number, AnnualNetPay, void> {
  const months: AnnualNetPayMonth[] = [];
  for (let index = 1; index <= 12; index++) {
    const month = `${input.year}-${String(index).padStart(2, "0")}`;
    const blocked = input.context.testMonths?.includes(month);
    const saved = blocked ? null : resolveNetPaySettings(month, input.timeline);
    if (blocked || saved?.settings.version !== 2) {
      months.push({
        month,
        netCents: null,
        status: blocked ? "Im Testmonat gesperrt" : "Noch nicht eingerichtet",
        notes: [],
        preliminary: false,
      });
    } else {
      const forecast = yield* prepareAutomaticNetPaySteps(
        month,
        saved.settings,
        input.profile,
        input.context,
        {
          preferences: input.preferences,
          perspective: "PAYOUT",
          sourceSettings: input.timeline,
        },
      );
      months.push(annualNetPayMonth(month, forecast));
    }
    yield 0;
  }
  return summarizeAnnualNetPay(input.year, months);
}
