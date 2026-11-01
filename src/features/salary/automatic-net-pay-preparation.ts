import type { MonthlyNetPaySettings, SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type {
  SalaryPaymentPreferences,
  SalaryPaymentProjection,
  SalaryPerspective,
} from "@/domain/salary-payment";
import type { UserProfile } from "@/domain/types";
import { createAutomaticNetPayCache } from "@/engine/net-pay-automatic-cache";
import {
  calculateAutomaticNetPayForecastSteps,
  calculateAutomaticNetPayForecast,
  type AutomaticNetPayForecast,
} from "@/engine/net-pay-automatic-forecast";
import {
  calculateAutomaticPaymentNetPayForecastSteps,
  type AutomaticPaymentNetPayInput,
} from "@/engine/net-pay-payment-forecast";
import { salaryPaymentInputSteps } from "./salary-payment-input";
import {
  salaryMonthInput,
  salaryMonthInputSteps,
  type SalaryMonthContext,
} from "./salary-month-input";
import { annualSalaryForecast, annualSalaryForecastSteps } from "./annual-salary-forecast";

const forecasts = createAutomaticNetPayCache();
type PaymentCacheInput = AutomaticPaymentNetPayInput & {
  readonly shifts: ReturnType<typeof salaryMonthInput>["shifts"];
  readonly pay: ReturnType<typeof salaryMonthInput>["pay"];
};
const paymentForecasts = createAutomaticNetPayCache<PaymentCacheInput>((input) => [
  input.projection,
  input.sourceSettings,
  input.socialInsuranceAttribution,
]);

export interface SalaryPaymentPreparation {
  readonly preferences: SalaryPaymentPreferences;
  readonly perspective: SalaryPerspective;
  readonly sourceSettings: readonly SavedMonthlyNetPaySettings[];
  readonly projection?: SalaryPaymentProjection;
}

function* preparePaymentNetPaySteps(
  month: string,
  settings: MonthlyNetPaySettings,
  profile: UserProfile,
  context: SalaryMonthContext,
  payment: SalaryPaymentPreparation,
): Generator<number, AutomaticNetPayForecast, void> {
  const projection =
    payment.projection ??
    (yield* salaryPaymentInputSteps(month, profile, context, payment.preferences, "PAYOUT"));
  const annual = yield* annualSalaryForecastSteps(
    Number(month.slice(0, 4)),
    profile,
    context,
    settings.automation?.annualPayments,
  );
  const forecastSettings = settings.automation
    ? { ...settings, automation: { ...settings.automation, annualPayments: annual.payments } }
    : settings;
  const input: PaymentCacheInput = {
    month,
    profile,
    settings: forecastSettings,
    projection,
    sourceSettings: payment.sourceSettings,
    socialInsuranceAttribution: payment.preferences.socialInsuranceAttribution ?? "UNKNOWN",
    shifts: projection.sources.flatMap((source) => source.shifts),
    pay: projection.pay,
  };
  const cached = paymentForecasts.read(input, context.resolver);
  if (cached !== null) return cached;
  const result = yield* calculateAutomaticPaymentNetPayForecastSteps(input, context.resolver);
  return paymentForecasts.write(input, context.resolver, result);
}

/** The existing synchronous consumers and prepared analysis pages share this exact pipeline. */
export function* prepareAutomaticNetPaySteps(
  month: string,
  settings: MonthlyNetPaySettings,
  profile: UserProfile,
  context: SalaryMonthContext,
  payment?: SalaryPaymentPreparation,
): Generator<number, AutomaticNetPayForecast, void> {
  try {
    if (payment?.perspective === "PAYOUT")
      return yield* preparePaymentNetPaySteps(month, settings, profile, context, payment);
    const { shifts, pay } = yield* salaryMonthInputSteps(month, profile, context);
    yield 0;
    const annual = yield* annualSalaryForecastSteps(
      Number(month.slice(0, 4)),
      profile,
      context,
      settings.automation?.annualPayments,
    );
    yield 0;
    const forecastSettings = settings.automation
      ? { ...settings, automation: { ...settings.automation, annualPayments: annual.payments } }
      : settings;
    const input = { month, profile, settings: forecastSettings, shifts, pay };
    const cached = forecasts.read(input, context.resolver);
    if (cached !== null) return cached;
    const result = yield* calculateAutomaticNetPayForecastSteps(input, context.resolver);
    return forecasts.write(input, context.resolver, result);
  } catch {
    return {
      sourceMonth: settings.month,
      result: {
        status: "unavailable",
        stage: "sfn",
        reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
      },
    };
  }
}

export function prepareAutomaticNetPay(...args: Parameters<typeof prepareAutomaticNetPaySteps>) {
  const [month, settings, profile, context, payment] = args;
  try {
    if (payment?.perspective === "PAYOUT") {
      const steps = preparePaymentNetPaySteps(month, settings, profile, context, payment);
      while (true) {
        const step = steps.next();
        if (step.done) return step.value;
      }
    }
    const { shifts, pay } = salaryMonthInput(month, profile, context);
    const annual = annualSalaryForecast(
      Number(month.slice(0, 4)),
      profile,
      context,
      settings.automation?.annualPayments,
    );
    const forecastSettings = settings.automation
      ? { ...settings, automation: { ...settings.automation, annualPayments: annual.payments } }
      : settings;
    const input = { month, profile, settings: forecastSettings, shifts, pay };
    return forecasts(input, context.resolver, () =>
      calculateAutomaticNetPayForecast(input, context.resolver),
    );
  } catch {
    return {
      sourceMonth: settings.month,
      result: {
        status: "unavailable" as const,
        stage: "sfn" as const,
        reason: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
      },
    };
  }
}
