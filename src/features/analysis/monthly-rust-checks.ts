import type {
  CalendarEntry,
  MonthlyComplianceResult,
  ShiftEntry,
  UserProfile,
} from "@/domain/types";
import type { SQLiteDatabase } from "expo-sqlite";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import type { AnalysisWorkYield } from "./analysis-work-queue";
import { persistentCheckValue } from "./persistent-analysis-values";
import { createStoredMonthlyRustInputReader } from "./monthly-rust-source";
import {
  createMonthlyRustFinanceBridge,
  type MonthlyRustDomainReport,
  type MonthlyRustTransport,
} from "./monthly-rust-finance";

interface MonthlyRustChecksRequest {
  readonly month: string;
  readonly profile: UserProfile;
  readonly shifts: readonly ShiftEntry[];
  readonly referenceDate: string;
  readonly youthProtection: boolean;
}
export interface MonthlyRustChecksCalculator {
  (request: MonthlyRustChecksRequest): Promise<MonthlyComplianceResult>;
  readonly cacheIdentity: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function monthlyRustChecksResult(
  month: string,
  report: MonthlyRustDomainReport,
): MonthlyComplianceResult {
  if (report.period.kind !== "MONTH" || report.period.month !== month)
    throw new Error("RUST_CHECKS_PERIOD_MISMATCH");
  const section = report.sections.checks;
  const value = record(section) && section.state === "READY" && section.value;
  const compliance = record(value) && value.month === month && value.compliance;
  if (!record(compliance) || compliance.ok !== true) throw new Error("RUST_CHECKS_UNAVAILABLE");
  if (!persistentCheckValue(compliance.value) || compliance.value.month !== month)
    throw new Error("RUST_CHECKS_OUTPUT_INVALID");
  return compliance.value;
}

export function monthlyRustChecksKey(
  key: string,
  calculator: MonthlyRustChecksCalculator | null | undefined,
): string {
  return calculator ? JSON.stringify([key, calculator.cacheIdentity]) : key;
}

export function createStoredMonthlyRustChecksCalculator(
  db: SQLiteDatabase,
  transport: MonthlyRustTransport,
  diagnosis: RuleCatalogRuntimeDiagnosis,
  entries: readonly CalendarEntry[],
): MonthlyRustChecksCalculator {
  const read = createStoredMonthlyRustInputReader(db, diagnosis);
  const calculate = createMonthlyRustFinanceBridge(transport);
  const stored: MonthlyRustChecksCalculator = Object.assign(
    async (request: MonthlyRustChecksRequest) => {
      const inputs = await read({ profile: request.profile, entries });
      const youth = inputs.sources.YOUTH_PREFERENCE;
      if (youth !== null && (!record(youth) || !["true", "false"].includes(String(youth.value))))
        throw new Error("RUST_CHECKS_PREFERENCE_INVALID");
      if ((record(youth) && youth.value === "true") !== request.youthProtection)
        throw new Error("RUST_CHECKS_INPUT_CHANGED");
      const sources = { ...inputs.sources };
      // This is the existing simple duty check. The separate training overlay is unchanged.
      delete sources.TRAINING_PROFILES;
      delete sources.TRAINING_SHIFT_DETAILS;
      return monthlyRustChecksResult(
        request.month,
        await calculate(
          {
            month: request.month,
            perspective: "EARNED",
            sections: { time: false, gross: false, net: false, checks: true },
          },
          { ...inputs, sources, referenceDate: request.referenceDate },
        ),
      );
    },
    { cacheIdentity: transport.expectedEngineVersion + ":monthly-checks-v1" },
  );
  return stored;
}

export function* monthlyRustChecksSteps(
  request: MonthlyRustChecksRequest,
  calculator: MonthlyRustChecksCalculator,
): Generator<AnalysisWorkYield, MonthlyComplianceResult, void> {
  let result!: MonthlyComplianceResult;
  yield calculator(request).then((value) => {
    result = value;
  });
  return result;
}
