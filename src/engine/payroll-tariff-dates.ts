import type { RuleResolver } from "@/rules/rule-resolver";

export interface DatedPayrollValue {
  readonly validFrom: string;
  readonly validTo: string | null;
}

type Observe = (date: string, referenceDate: string) => void;
const observers = new WeakMap<RuleResolver, Observe>();

export function observePayrollTariffContinuation(resolver: RuleResolver, observe: Observe): void {
  observers.set(resolver, observe);
}

export function isPayrollTariffContinuation(resolver: RuleResolver): boolean {
  return observers.has(resolver);
}

export function recordPayrollTariffContinuation(
  resolver: RuleResolver,
  date: string,
  referenceDate: string,
): void {
  observers.get(resolver)?.(date, referenceDate);
}

export function coversPayrollDate(value: DatedPayrollValue, date: string): boolean {
  return value.validFrom <= date && (value.validTo === null || date <= value.validTo);
}

export function payrollPeriodsEnded(
  values: readonly DatedPayrollValue[] | undefined,
  date: string,
) {
  return (
    !!values?.length && values.every((value) => value.validTo !== null && value.validTo < date)
  );
}

export function latestExpiredPayrollValue<T extends DatedPayrollValue>(
  values: readonly T[],
  date: string,
): T | undefined {
  return values
    .filter((value) => value.validTo !== null && value.validTo < date)
    .sort((left, right) => right.validTo!.localeCompare(left.validTo!))[0];
}
