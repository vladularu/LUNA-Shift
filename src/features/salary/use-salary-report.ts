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
import { useRustSalaryPreparation } from "./use-rust-salary-preparation";

function useOriginalSalaryReport(month: string, enabled = true) {
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
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
    absenceNetBasis: {
      profile,
      resolver: ruleResolver,
      attribution: payment.preferences.socialInsuranceAttribution,
    },
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

export function useNativeSalaryReport(
  month: string,
  enabled = true,
): ReturnType<typeof useOriginalSalaryReport> {
  const prepared = useRustSalaryPreparation(month, enabled);
  const [previous, setPrevious] = useState<{
    key: string;
    resolver: typeof prepared.resolver;
    projection: NonNullable<typeof prepared.result>["projection"];
  } | null>(null);
  const currentProjection = prepared.result?.projection;
  if (
    currentProjection &&
    prepared.projectionIdentity &&
    (previous?.key !== prepared.projectionIdentity ||
      previous.resolver !== prepared.resolver ||
      previous.projection !== currentProjection)
  ) {
    setPrevious({
      key: prepared.projectionIdentity,
      resolver: prepared.resolver,
      projection: currentProjection,
    });
  }
  const projection =
    currentProjection ??
    (previous?.key === prepared.projectionIdentity && previous.resolver === prepared.resolver
      ? previous.projection
      : undefined);
  const calculation = useMemo(() => {
    if (!projection) return null;
    const premiums = new Set(
      projection.contributions
        .filter((part) => part.group === "PREMIUMS")
        .map((part) => part.claimMonth),
    );
    const allowances = [
      ...new Set(
        projection.contributions
          .filter((part) => part.group === "MONTHLY_ALLOWANCE" || part.group === "HOURLY_ALLOWANCE")
          .map((part) => part.claimMonth),
      ),
    ];
    return {
      ok: true as const,
      value: {
        monthShifts: projection.sources.find((source) => source.month === month)?.shifts ?? [],
        premiumShifts: projection.sources
          .filter((source) => premiums.has(source.month))
          .flatMap((source) => source.shifts),
        pay: projection.pay,
        projection,
        paymentHint: salaryPaymentHint(projection),
        allowanceMonth: allowances.length === 1 ? allowances[0] : null,
      },
    };
  }, [projection, month]);
  return {
    absenceNetBasis: {
      profile: prepared.profile,
      resolver: prepared.resolver,
      attribution: prepared.payment.preferences.socialInsuranceAttribution,
    },
    error: prepared.sourceError ?? (projection ? null : prepared.error),
    ready: prepared.sourceReady && (prepared.ready || projection !== undefined),
    reload: prepared.reload,
    profile:
      projection?.sources.find((source) => source.month === month)?.profile ?? prepared.profile,
    entries: prepared.entries,
    calculation,
    testMonths: prepared.testMonths,
    payment: prepared.payment,
    retryRules: prepared.retry,
  };
}

export const useSalaryReport: typeof useOriginalSalaryReport =
  process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION === "1"
    ? useNativeSalaryReport
    : useOriginalSalaryReport;
