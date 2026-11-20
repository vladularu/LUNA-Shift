import type { UserProfile } from "@/domain/types";
import type { RuleTariffPackage } from "@/rules/contracts.generated";
import type { RuleResolver } from "@/rules/rule-resolver";
import { bundledNursingTrainingPackages } from "./simple-nursing-training-pay";
import { overlaySimpleTariffPackage, selectSimpleTariffTable } from "./simple-tariff-table-overlay";
import { bundledVkaEPackages } from "./simple-vka-e-pay";
import { bundledTvlKrPackages } from "./simple-tvl-kr-pay";
import { bundledTvalPflegePackages } from "./simple-tval-pflege-pay";
import {
  coversPayrollDate,
  latestExpiredPayrollValue,
  observePayrollTariffContinuation,
  type DatedPayrollValue,
} from "./payroll-tariff-dates";

const annexPackageId = "tvoed-vka-anlage-a";
const trainingPackageId = "tvaoed-pflege-vka";
const tvlPackageId = "tvl-kr-tdl";
const tvalPackageId = "tval-pflege-tdl";
const bundledPackages = new Map([
  [annexPackageId, bundledVkaEPackages],
  [trainingPackageId, bundledNursingTrainingPackages],
  [tvlPackageId, bundledTvlKrPackages],
  [tvalPackageId, bundledTvalPflegePackages],
]);
const eligiblePackages = ["tvoed-vka-bt-k", "tvoed-p-vka-legacy", ...bundledPackages.keys()];
const recurringAllowances = new Set(["alternating-shift", "shift", "care", "tvoed"]);
const continued = new WeakMap<RuleTariffPackage, RuleTariffPackage>();
const provisionalPackages = new WeakSet<RuleTariffPackage>();

export function payrollTariffPackageIds(profile: UserProfile): readonly (string | undefined)[] {
  if (profile.vkaETariff) return [annexPackageId, undefined];
  if (profile.nursingTrainingTariff) return [trainingPackageId];
  if (profile.tvlKrTariff) return [tvlPackageId];
  if (profile.tvalPflegeTariff) return [tvalPackageId, tvlPackageId];
  return profile.tariff ? [undefined] : [];
}

export function isContinuedPayrollPackage(pkg: RuleTariffPackage): boolean {
  return provisionalPackages.has(pkg);
}

function continuePackage(
  previous: RuleTariffPackage,
  packageId: string,
  referenceDate: string,
  source: RuleResolver,
): RuleTariffPackage {
  // For E and TVAöD the catalog can carry a table independently of the dated package.
  const family =
    packageId === annexPackageId
      ? "TVOED_VKA_E"
      : packageId === trainingPackageId
        ? "TVAOED_PFLEGE"
        : packageId === tvlPackageId
          ? "TVL_KR"
          : packageId === tvalPackageId
            ? "TVAL_PFLEGE"
            : null;
  const table = family ? selectSimpleTariffTable(source, family, referenceDate) : null;
  const existing = !table ? continued.get(previous) : undefined;
  if (existing) return existing;
  const pkg = overlaySimpleTariffPackage(previous, table, source);
  const extend = <T extends DatedPayrollValue>(rule: T): T =>
    rule.validTo === previous.validTo ? { ...rule, validTo: null } : rule;
  const { employmentWorkingTimeRules, tvlShiftAllowancePolicy, tvalShiftAllowancePolicy } =
    pkg.rules;
  const extendShiftRates = (policy: NonNullable<typeof tvlShiftAllowancePolicy>) => ({
    ...policy,
    periods: policy.periods.map(extend) as typeof policy.periods,
  });
  const estimate: RuleTariffPackage = {
    ...pkg,
    rules: {
      ...pkg.rules,
      allowanceRules: pkg.rules.allowanceRules.map((rule) =>
        recurringAllowances.has(rule.allowanceType) ? extend(rule) : rule,
      ),
      ...(employmentWorkingTimeRules
        ? {
            employmentWorkingTimeRules: employmentWorkingTimeRules.map(
              extend,
            ) as typeof employmentWorkingTimeRules,
          }
        : {}),
      ...(tvlShiftAllowancePolicy
        ? { tvlShiftAllowancePolicy: extendShiftRates(tvlShiftAllowancePolicy) }
        : {}),
      ...(tvalShiftAllowancePolicy
        ? {
            tvalShiftAllowancePolicy: {
              ...tvalShiftAllowancePolicy,
              scopes: tvalShiftAllowancePolicy.scopes.map((scope) => ({
                ...scope,
                rates: extendShiftRates(scope.rates),
              })) as typeof tvalShiftAllowancePolicy.scopes,
            },
          }
        : {}),
    },
  };
  provisionalPackages.add(estimate);
  if (!table) continued.set(previous, estimate);
  return estimate;
}

export function payrollTariffContinuation(source: RuleResolver, month: string) {
  const referenceMonths = new Set<string>();
  const byDate = new Map<string, ReturnType<RuleResolver["resolveTariff"]>>();

  function resolve(date: string, requestedId?: string): ReturnType<RuleResolver["resolveTariff"]> {
    const key = (requestedId ?? "") + "/" + date;
    const cached = byDate.get(key);
    if (cached) return cached;
    const noRegisteredTrack =
      requestedId &&
      bundledPackages.has(requestedId) &&
      !source.tariffPackageIds?.includes(requestedId);
    const exact = noRegisteredTrack
      ? {
          ok: false as const,
          error: {
            code: "RULE_PACKAGE_NOT_FOUND" as const,
            kind: "TARIFF" as const,
            packageId: requestedId,
            effectiveDate: date,
            message: `No catalog tariff track ${requestedId} covers ${date}.`,
          },
        }
      : source.resolveTariff(date, requestedId);
    if (
      exact.ok ||
      exact.error.code !== "RULE_PACKAGE_NOT_FOUND" ||
      !eligiblePackages.includes(exact.error.packageId)
    )
      return exact;

    const packageId = exact.error.packageId;
    const bundled = bundledPackages.get(packageId) ?? [];
    const currentBundled = bundled.find((item) => coversPayrollDate(item, date));
    const remotePrevious = source.previousTariff?.(date, packageId);
    if (
      currentBundled &&
      (!remotePrevious || currentBundled.validFrom > remotePrevious.validFrom)
    ) {
      const result = { ok: true as const, value: currentBundled };
      byDate.set(key, result);
      return result;
    }
    const bundledPrevious = latestExpiredPayrollValue(bundled, date);
    const previous =
      remotePrevious && (!bundledPrevious || remotePrevious.validTo! >= bundledPrevious.validTo!)
        ? remotePrevious
        : bundledPrevious;
    const referenceDate = previous?.validTo;
    if (!previous || !referenceDate || date <= referenceDate) return exact;
    if (previous === remotePrevious) {
      const checked = source.resolveTariff(referenceDate, requestedId);
      if (!checked.ok && checked.error.code === "RULE_PACKAGE_AMBIGUOUS") return exact;
    }

    const result = {
      ok: true as const,
      value: continuePackage(previous, packageId, referenceDate, source),
      provisionalReferenceDate: referenceDate,
    };
    byDate.set(key, result);
    return result;
  }

  const resolver: RuleResolver = {
    ...source,
    tariffPackageIds: [...new Set([...(source.tariffPackageIds ?? []), ...eligiblePackages])],
    resolveTariff(date, packageId) {
      const result = resolve(date, packageId);
      if (result.ok && result.provisionalReferenceDate && date >= month + "-01")
        observe(date, result.provisionalReferenceDate);
      return result;
    },
  };
  function observe(date: string, referenceDate: string) {
    if (date >= month + "-01") referenceMonths.add(referenceDate.slice(0, 7));
  }
  observePayrollTariffContinuation(resolver, observe);
  return { resolver, resolve, referenceMonths };
}
