import type { Temporal } from "@js-temporal/polyfill";
import type { ShiftEntry } from "@/domain/types";
import type { ComplianceInterval } from "./compliance-sequences";
import type { RestIntervalIndex } from "./compliance-rest-intervals";

export interface RestObligation {
  readonly kind: "SUNDAY" | "WEEKDAY_HOLIDAY";
  readonly date: Temporal.PlainDate;
  readonly windowStart: Temporal.PlainDate;
  readonly windowEnd: Temporal.PlainDate;
  readonly related: readonly ShiftEntry[];
}
export interface ReplacementCandidate {
  readonly date: Temporal.PlainDate;
  readonly evidence: readonly ShiftEntry[];
  readonly observedRestMinutes: number | null;
}
export interface ObligationMatch {
  readonly obligation: RestObligation;
  readonly candidate: ReplacementCandidate;
}
export interface HolidayCoverage {
  readonly dates: ReadonlySet<string>;
  readonly missingYears: ReadonlySet<number>;
}
export interface PreparedRestKernel {
  readonly workDates: ReadonlyMap<string, readonly ComplianceInterval[]>;
  readonly holidayCoverage: HolidayCoverage;
  readonly obligations: readonly RestObligation[];
  readonly matches: {
    readonly matched: readonly ObligationMatch[];
    readonly unmatched: readonly RestObligation[];
  };
  readonly restIntervals: RestIntervalIndex;
}
export interface PreparedRestProvider {
  get(
    intervals: readonly ComplianceInterval[],
    month: string,
    state: string | undefined,
    region: string | undefined,
    from: string,
    through: string,
  ): PreparedRestKernel | undefined;
}
export function restContextKey(
  month: string,
  state: string | undefined,
  region: string | undefined,
  from: string,
  through: string,
) {
  return JSON.stringify([month, state, region ?? "NONE", from, through]);
}
