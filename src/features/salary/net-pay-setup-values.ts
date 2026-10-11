import type { NetPayPensionScheme } from "@/domain/net-pay-automation";
import { netPayPensionMaxOwnRate } from "@/domain/net-pay-pension-schemes";
import {
  validateMonthlyNetPaySettings,
  type MonthlyNetPaySettings,
} from "@/domain/net-pay-profile";
import {
  monthlyNetPaySettingsFromForm,
  netPayFormValues,
  parseNetPayDecimal,
  type NetPayFormValues,
} from "./net-pay-form-values";

/** Official 2026 forecast average, not an individual health fund's contribution. */
export const NET_PAY_HEALTH_FORECAST_RATE = "2,90";

export function netPaySetupValues(
  initial: MonthlyNetPaySettings | null,
  worksInSaxony: boolean,
): NetPayFormValues {
  const existing = netPayFormValues(initial);
  return {
    ...existing,
    factorMode: initial?.profile.factorPermille ? "FACTOR" : "NONE",
    childAllowance: initial ? existing.childAllowance : "0",
    childrenUnder25: String(initial?.profile.childrenUnder25 ?? 0),
    healthAdditionalRate: initial ? existing.healthAdditionalRate : NET_PAY_HEALTH_FORECAST_RATE,
    monthlyTaxAllowance: initial ? existing.monthlyTaxAllowance : "0",
    specialCases: initial?.specialCases ?? [],
    worksInSaxony,
    sfnBasicHourlyPay: "",
  };
}

export function validateNetPaySetupStep(month: string, step: number, form: NetPayFormValues) {
  if (form.taxClass === null) throw new Error("Bitte deine Steuerklasse auswählen.");
  if (form.churchTaxRate === null) throw new Error("Bitte auswählen, ob du Kirchensteuer zahlst.");
  if (step === 0) {
    monthlyNetPaySettingsFromForm(
      month,
      {
        ...form,
        birthDate: "01.01.1900",
        isParent: false,
        childrenUnder25: "0",
        healthAdditionalRate: NET_PAY_HEALTH_FORECAST_RATE,
      },
      null,
    );
    return;
  }
  if (form.isParent === null) throw new Error("Bitte auswählen, ob du Kinder hast.");
  // Validate the family before later, optional contribution settings can affect navigation.
  monthlyNetPaySettingsFromForm(
    month,
    step === 1
      ? {
          ...form,
          factorMode: "NONE",
          childAllowance: "0",
          monthlyTaxAllowance: "0",
          healthAdditionalRate: NET_PAY_HEALTH_FORECAST_RATE,
        }
      : form,
    null,
  );
}

export function netPaySetupSettings(
  month: string,
  form: NetPayFormValues,
  pensionScheme: NetPayPensionScheme | null,
  additionalGross: string,
  additionalNet: string,
  initial: MonthlyNetPaySettings | null = null,
  pensionEmployeeRate: string = "",
): MonthlyNetPaySettings {
  validateNetPaySetupStep(month, 3, form);
  if (!pensionScheme)
    throw new Error("Bitte Zusatzversorgung auswählen – auch „Weiß ich nicht“ ist möglich.");
  const monthly = monthlyNetPaySettingsFromForm(month, form, null);
  return validateMonthlyNetPaySettings({
    ...monthly,
    version: 2,
    sfnBasicHourlyPayCents: null,
    automation: {
      pensionScheme,
      ...(netPayPensionMaxOwnRate(pensionScheme) !== null
        ? {
            pensionEmployeeRateBps:
              pensionEmployeeRate.trim() === ""
                ? null
                : parseNetPayDecimal(
                    pensionEmployeeRate,
                    100,
                    "den Eigenanteil der Zusatzversorgung",
                  ),
          }
        : {}),
      // Retained storage keys describe the visible assumptions accepted when saving.
      fullMonthAndPayConfirmed: initial?.automation?.fullMonthAndPayConfirmed ?? true,
      plannedWorkConfirmed: initial?.automation?.plannedWorkConfirmed ?? true,
      additionalRecurringGrossCents: parseNetPayDecimal(
        additionalGross,
        100,
        "die weitere laufende Zulage",
      ),
      additionalNetDeductionCents: parseNetPayDecimal(
        additionalNet,
        100,
        "die weiteren Netto-Abzüge",
      ),
    },
  });
}
