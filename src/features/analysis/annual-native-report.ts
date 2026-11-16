import type {
  CalendarEntry,
  MonthlyTariffDecision,
  TvoedWorkPatternSettings,
  UserProfile,
} from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import {
  annualInputKey,
  buildAnnualAvailableReportSteps,
  type AnnualComputationOptions,
} from "./annual-core-report";
import type { AnnualReport } from "./annual-report";
import type { AnalysisWorkYield } from "./analysis-work-queue";
import { createAnnualRestSession, prepareAnnualRestSteps } from "./annual-rest-preparation";
import { getAnnualRestTransport, type AnnualRestTransport } from "./annual-rest-transport";

/** One native rest batch after the early core paint; complete cache hits bypass this wrapper. */
export function* buildAnnualNativeReportSteps(
  year: number,
  entries: readonly CalendarEntry[],
  profile: UserProfile,
  decisions: readonly MonthlyTariffDecision[],
  workPattern: TvoedWorkPatternSettings,
  referenceDate: string,
  resolver: RuleResolver,
  options: AnnualComputationOptions = {},
  current: () => boolean = () => true,
  transport: AnnualRestTransport | null = getAnnualRestTransport(),
): Generator<AnalysisWorkYield, AnnualReport, void> {
  if (!transport || options.youthProtection)
    return yield* buildAnnualAvailableReportSteps(
      year,
      entries,
      profile,
      decisions,
      workPattern,
      referenceDate,
      resolver,
      options,
    );
  const session = createAnnualRestSession();
  let closed = false,
    coreReady = false,
    prepared = false;
  const identity = () =>
    annualInputKey([
      year,
      entries,
      profile,
      decisions,
      workPattern,
      referenceDate,
      options.youthProtection,
      options.training,
      options.remuneration,
    ]);
  const key = identity();
  const isCurrent = () => !closed && current();
  const steps = buildAnnualAvailableReportSteps(
    year,
    entries,
    profile,
    decisions,
    workPattern,
    referenceDate,
    resolver,
    {
      ...options,
      restPreparation: session.preparation,
      onCore: (value) => {
        coreReady = true;
        options.onCore?.(value);
      },
    },
  );
  try {
    while (true) {
      const step = steps.next();
      if (step.done) return step.value;
      yield step.value;
      if (coreReady && !prepared) {
        prepared = true;
        yield* prepareAnnualRestSteps(
          year,
          entries,
          profile,
          referenceDate,
          resolver,
          options,
          session,
        );
        if (!isCurrent() || identity() !== key) throw new Error("Annual calculation input changed");
        if (session.items.length > 0) {
          yield session.compute(transport, year, isCurrent);
          if (!isCurrent() || identity() !== key)
            throw new Error("Annual calculation input changed");
        }
      }
    }
  } finally {
    closed = true;
    session.dispose();
    steps.return(undefined as unknown as AnnualReport);
  }
}
