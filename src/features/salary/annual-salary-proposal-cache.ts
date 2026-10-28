import type { UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import type { AnnualSalaryProposal } from "./annual-salary-proposal";
import { salaryEntryDependencies, type SalaryMonthContext } from "./salary-month-input";

/** Share completed reference-month calculations after the existing eligibility checks. */
export function createAnnualSalaryProposalCache() {
  const catalogs = new WeakMap<RuleResolver, Map<string, AnnualSalaryProposal>>();
  const keyFor = (year: number, profile: UserProfile, context: SalaryMonthContext) => {
    try {
      return JSON.stringify([
        year,
        profile,
        salaryEntryDependencies(year, profile, context),
        context.tariffDecisions,
        context.workPatternSettings,
      ]);
    } catch {
      return null;
    }
  };
  const read = (year: number, profile: UserProfile, context: SalaryMonthContext) => {
    // Content keys also detect fresh SQL objects and edits without a revision change.
    const key = keyFor(year, profile, context);
    if (key === null) return null;
    const cache = catalogs.get(context.resolver);
    const existing = cache?.get(key);
    if (existing) {
      cache!.delete(key);
      cache!.set(key, existing);
      return existing;
    }
    return null;
  };
  const write = (
    year: number,
    profile: UserProfile,
    context: SalaryMonthContext,
    result: AnnualSalaryProposal | null,
  ) => {
    // Incomplete data and transient rule failures must remain immediately retryable.
    if (result === null) return null;
    const key = keyFor(year, profile, context);
    if (key === null) return result;
    const cache = catalogs.get(context.resolver);
    const snapshot = Object.freeze({
      ...result,
      referenceMonths: Object.freeze([...result.referenceMonths]),
    });
    const next = cache ?? new Map<string, AnnualSalaryProposal>();
    next.set(key, snapshot);
    if (next.size > 12) next.delete(next.keys().next().value!);
    if (!cache) catalogs.set(context.resolver, next);
    return snapshot;
  };
  return Object.assign(
    (
      year: number,
      profile: UserProfile,
      context: SalaryMonthContext,
      calculate: () => AnnualSalaryProposal | null,
    ) => read(year, profile, context) ?? write(year, profile, context, calculate()),
    { read, write },
  );
}
