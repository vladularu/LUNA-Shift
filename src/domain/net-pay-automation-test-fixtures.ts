import { settings } from "./net-pay-profile-test-fixtures";
import type { MonthlyNetPaySettings } from "./net-pay-profile";

export function automatedSettings(month = "2026-07"): MonthlyNetPaySettings {
  return {
    ...settings(month),
    version: 2,
    automation: {
      fullMonthAndPayConfirmed: true,
      plannedWorkConfirmed: true,
      additionalRecurringGrossCents: 0,
      additionalNetDeductionCents: 0,
      pensionScheme: "NONE",
    },
  };
}
