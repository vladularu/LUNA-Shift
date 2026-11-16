import type { CalendarEntry } from "@/domain/types";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import type { SQLiteDatabase } from "expo-sqlite";
import type { AnnualAnalysisRequest } from "./annual-analysis";
import type { AnnualReport } from "./annual-report";
import type { AnnualNetPay, AnnualNetPayRequest } from "./annual-net-pay";
import { persistentAnnualValue } from "./persistent-analysis-values";
import { persistentAnnualNetPay } from "./annual-net-pay-cache";
import { isAnnualSalaryForecast } from "./persistent-salary-value";
import { createStoredMonthlyRustInputReader } from "./monthly-rust-source";
import {
  createMonthlyRustFinanceBridge,
  type AnnualRustDomainReport,
  type MonthlyRustTransport,
} from "./monthly-rust-finance";
import type { AnalysisWorkYield } from "./analysis-work-queue";

export interface AnnualRustCalculator {
  readonly cacheIdentity: string;
  report(request: AnnualAnalysisRequest): Promise<AnnualReport>;
  net(request: AnnualNetPayRequest): Promise<AnnualNetPay>;
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function ready(value: unknown): RecordValue {
  if (!record(value) || value.state !== "READY" || !record(value.value))
    throw new Error("RUST_ANNUAL_SECTION_UNAVAILABLE");
  return value.value;
}
function rows(value: RecordValue, year: number): RecordValue[] {
  if (
    value.year !== year ||
    !Array.isArray(value.months) ||
    value.months.length !== 12 ||
    !value.months.every(
      (row, index) => record(row) && row.month === `${year}-${String(index + 1).padStart(2, "0")}`,
    )
  )
    throw new Error("RUST_ANNUAL_PERIOD_MISMATCH");
  return value.months as RecordValue[];
}

/** Original DTO: native time/checks and temporary sums of native monthly finances. */
export function annualRustReportResult(year: number, report: AnnualRustDomainReport): AnnualReport {
  if (report.period.kind !== "YEAR" || report.period.year !== year)
    throw new Error("RUST_ANNUAL_PERIOD_MISMATCH");
  const time = ready(report.sections.time),
    gross = ready(ready(report.sections.gross).legacy),
    checks = ready(report.sections.checks);
  const times = rows(time, year),
    pay = rows(gross, year),
    findings = rows(checks, year);
  if (
    !Array.isArray(time.distribution) ||
    !time.distribution.every((item) => Array.isArray(item) && item.length === 2)
  )
    throw new Error("RUST_ANNUAL_OUTPUT_INVALID");
  const value = {
    ...time,
    salarySource: gross.salarySource,
    availablePayMonthCount: gross.availablePayMonthCount,
    estimatedGrossAmount: gross.estimatedGrossAmount,
    premiumAmount: gross.premiumAmount,
    overtimeAmount: gross.overtimeAmount,
    allowanceAmount: gross.allowanceAmount,
    criticalCount: checks.criticalCount,
    warningCount: checks.warningCount,
    complianceCoverageComplete: checks.complianceCoverageComplete,
    distribution: new Map(time.distribution as [string, number][]),
    months: times.map((row, index) => ({ ...row, ...pay[index], ...findings[index] })),
  };
  if (!persistentAnnualValue(value)) throw new Error("RUST_ANNUAL_OUTPUT_INVALID");
  return value;
}
export function annualRustNetResult(
  year: number,
  report: AnnualRustDomainReport,
  requireForecast = true,
): AnnualNetPay {
  if (report.period.kind !== "YEAR" || report.period.year !== year)
    throw new Error("RUST_ANNUAL_PERIOD_MISMATCH");
  const value = ready(report.sections.net);
  if (
    !persistentAnnualNetPay(value, year) ||
    (requireForecast && !isAnnualSalaryForecast(report.salaryForecast))
  )
    throw new Error("RUST_ANNUAL_NET_OUTPUT_INVALID");
  return {
    ...value,
    ...(isAnnualSalaryForecast(report.salaryForecast)
      ? { salaryForecast: report.salaryForecast }
      : {}),
  };
}
export function annualRustRequest(
  request: AnnualAnalysisRequest,
  calculator: AnnualRustCalculator | null,
): AnnualAnalysisRequest {
  return calculator ? { ...request, calculationIdentity: calculator.cacheIdentity } : request;
}
export function annualRustNetRequest(
  request: AnnualNetPayRequest,
  calculator: AnnualRustCalculator | null,
): AnnualNetPayRequest {
  return calculator ? { ...request, calculationIdentity: calculator.cacheIdentity } : request;
}
export function createStoredAnnualRustCalculator(
  db: SQLiteDatabase,
  transport: MonthlyRustTransport,
  diagnosis: RuleCatalogRuntimeDiagnosis,
  entries: readonly CalendarEntry[],
): AnnualRustCalculator {
  const read = createStoredMonthlyRustInputReader(db, diagnosis),
    finance = createMonthlyRustFinanceBridge(transport);
  return {
    cacheIdentity: transport.expectedEngineVersion + ":annual-months-v2",
    async report(request) {
      const captured = await read({ profile: request.profile, entries });
      // The existing simple annual view never requests the separate training
      // overlay. Preserve that scope, including when training rows are invalid.
      const sources = { ...captured.sources };
      delete sources.TRAINING_PROFILES;
      delete sources.TRAINING_SHIFT_DETAILS;
      return annualRustReportResult(
        request.year,
        await finance(
          {
            year: request.year,
            perspective: "EARNED",
            grossSource:
              request.profile.tariff !== null ||
              request.profile.nursingTrainingTariff != null ||
              request.profile.vkaETariff != null ||
              request.profile.tvlKrTariff != null ||
              request.profile.tvUkNursingTariff != null ||
              request.profile.tvhKrTariff != null ||
              request.profile.tvalPflegeTariff != null
                ? "TARIFF"
                : request.profile.manualMonthlyGrossCents != null
                  ? "MANUAL"
                  : "UNSET",
            sections: { time: true, gross: true, checks: true, net: false },
          },
          { ...captured, sources, referenceDate: request.referenceDate },
        ),
      );
    },
    async net(request) {
      const requireForecast = !request.context.testMonths?.some((month) =>
        month.startsWith(`${request.year}-`),
      );
      const captured = await read({ profile: request.profile, entries: request.context.entries });
      const sources = {
        ...captured.sources,
        NET_PAY_SETTINGS_TIMELINE: request.timeline.map((saved) => ({
          month: saved.settings.month,
          settings_json: JSON.stringify(saved.settings),
          revision: saved.revision,
          created_at: saved.createdAt,
          updated_at: saved.updatedAt,
        })),
        SALARY_PAYMENT_PREFERENCES: { value: JSON.stringify(request.preferences) },
      };
      return annualRustNetResult(
        request.year,
        await finance(
          {
            year: request.year,
            perspective: "PAYOUT",
            includeSalaryForecast: requireForecast,
            sections: { time: false, gross: false, checks: false, net: true },
          },
          { ...captured, sources },
        ),
        requireForecast,
      );
    },
  };
}
export function* annualRustSteps<T>(
  calculate: () => Promise<T>,
): Generator<AnalysisWorkYield, T, void> {
  let result: T | undefined;
  yield calculate().then((value) => {
    result = value;
  });
  if (result === undefined) throw new Error("RUST_ANNUAL_OUTPUT_INVALID");
  return result;
}
