import { useMemo, useState } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { captureRuleComputation } from "@/features/analysis/rule-computation";
import { salaryPaymentInput } from "./salary-payment-input";
import { useSalaryPaymentPreferences } from "./salary-payment-preferences";
import { salaryPaymentHint } from "./salary-composition";

export function useSalaryReport(month: string, enabled = true) {
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const payment = useSalaryPaymentPreferences();
  const paymentReady = payment.ready;
  const [ruleRetryRevision, setRuleRetryRevision] = useState(0);
  const calculation = useMemo(() => {
    void ruleRetryRevision;
    if (!enabled || !ready || !paymentReady || error !== null || profile === null) return null;
    return captureRuleComputation(() => {
      const projection = salaryPaymentInput(
        month,
        profile,
        { entries, tariffDecisions, workPatternSettings, resolver: ruleResolver, testMonths },
        payment.preferences,
        "PAYOUT",
      );
      const premiumMonths = new Set(
        projection.contributions
          .filter((part) => part.group === "PREMIUMS")
          .map((part) => part.claimMonth),
      );
      const allowanceMonths = [
        ...new Set(
          projection.contributions
            .filter(
              (part) => part.group === "MONTHLY_ALLOWANCE" || part.group === "HOURLY_ALLOWANCE",
            )
            .map((part) => part.claimMonth),
        ),
      ];
      return {
        monthShifts: projection.sources.find((source) => source.month === month)?.shifts ?? [],
        premiumShifts: projection.sources
          .filter((source) => premiumMonths.has(source.month))
          .flatMap((source) => source.shifts),
        pay: projection.pay,
        projection,
        paymentHint: salaryPaymentHint(projection),
        allowanceMonth: allowanceMonths.length === 1 ? allowanceMonths[0] : null,
      };
    });
  }, [
    enabled,
    entries,
    error,
    month,
    profile,
    ready,
    paymentReady,
    payment.preferences,
    ruleResolver,
    ruleRetryRevision,
    tariffDecisions,
    workPatternSettings,
    testMonths,
  ]);

  return {
    // A failed inline write leaves the loaded preferences valid and must not discard form drafts.
    error: error ?? (!paymentReady ? payment.error : null),
    ready: ready && paymentReady,
    reload: async () => {
      await Promise.all([reload(), payment.reload()]);
    },
    profile: calculation?.ok
      ? (calculation.value.projection.sources.find((source) => source.month === month)?.profile ??
        profile)
      : profile,
    entries,
    calculation,
    testMonths,
    payment,
    retryRules: () => setRuleRetryRevision((value) => value + 1),
  };
}
