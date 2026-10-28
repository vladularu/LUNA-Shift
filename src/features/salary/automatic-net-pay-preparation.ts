import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { UserProfile } from "@/domain/types";
import { createAutomaticNetPayCache } from "@/engine/net-pay-automatic-cache";
import {
  calculateAutomaticNetPayForecastSteps,
  calculateAutomaticNetPayForecast,
  type AutomaticNetPayForecast,
} from "@/engine/net-pay-automatic-forecast";
import {
  salaryMonthInput,
  salaryMonthInputSteps,
  type SalaryMonthContext,
} from "./salary-month-input";
import { annualSalaryForecast, annualSalaryForecastSteps } from "./annual-salary-forecast";

const forecasts = createAutomaticNetPayCache();

/** The existing synchronous consumers and prepared analysis pages share this exact pipeline. */
export function* prepareAutomaticNetPaySteps(
  month: string,
  settings: MonthlyNetPaySettings,
  profile: UserProfile,
  context: SalaryMonthContext,
): Generator<number, AutomaticNetPayForecast, void> {
  try {
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
  const [month, settings, profile, context] = args;
  try {
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
