import { needsCalendarSalaryInYear } from "./calendar-salary-projection";
import { prepareAutomaticNetPaySteps } from "@/features/salary/automatic-net-pay-preparation";
import type { SQLiteDatabase } from "expo-sqlite";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import {
  analysisSalaryKey,
  type AnalysisSalaryRequest,
  type PreparedAnalysisSalary,
} from "./analysis-salary";
import { createStoredMonthlyRustSalaryPreparation } from "./monthly-rust-salary-preparation";
import { createAnalysisResultCache, isCurrentAnalysisMonth } from "./analysis-result-cache";
import type { AnalysisWorkYield } from "./analysis-work-queue";
import {
  createMonthlyRustFinanceBridge,
  type MonthlyRustDomainReport,
  type MonthlyRustTransport,
} from "./monthly-rust-finance";
import { createStoredMonthlyRustInputReader } from "./monthly-rust-source";
import { isMonthlyNetForecast } from "./persistent-salary-value";

export type MonthlyRustNetCalculator = ((
  request: AnalysisSalaryRequest,
) => Promise<AutomaticNetPayForecast>) & {
  readonly cacheIdentity: string;
  readonly prepare?: (request: AnalysisSalaryRequest) => Promise<PreparedAnalysisSalary>;
};
const completed = createAnalysisResultCache<AutomaticNetPayForecast>();
const settingsJson = (value: unknown) =>
  JSON.stringify(value, (_key, part) =>
    part !== null && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(
          Object.keys(part)
            .sort()
            .map((key) => [key, part[key]]),
        )
      : part,
  );

export function monthlyRustNetRequest(
  request: AnalysisSalaryRequest,
  calculator: MonthlyRustNetCalculator | null | undefined,
): AnalysisSalaryRequest {
  return calculator ? { ...request, netCalculationIdentity: calculator.cacheIdentity } : request;
}

export function readMonthlyRustNetForecast(
  request: AnalysisSalaryRequest,
  calculator: MonthlyRustNetCalculator,
) {
  const input = monthlyRustNetRequest(request, calculator);
  return completed.read(
    input.context.resolver,
    analysisSalaryKey(input),
    isCurrentAnalysisMonth(input.month, input.profile.timeZone),
  );
}

/** Raw financial data only. No native views or formatted display values. */
export function monthlyRustNetResult(
  request: AnalysisSalaryRequest,
  report: MonthlyRustDomainReport,
): AutomaticNetPayForecast {
  if (report.period.kind !== "MONTH" || report.period.month !== request.month)
    throw new Error("RUST_NET_PERIOD_MISMATCH");
  const section = report.sections.net;
  if (
    !section ||
    typeof section !== "object" ||
    !("state" in section) ||
    section.state !== "READY" ||
    !("value" in section) ||
    !isMonthlyNetForecast(section.value, request)
  )
    throw new Error("RUST_NET_OUTPUT_INVALID");
  if (section.value.sourceMonth !== request.settings?.month)
    throw new Error("RUST_NET_SETTINGS_MISMATCH");
  return section.value;
}

export function createStoredMonthlyRustNetCalculator(
  db: SQLiteDatabase,
  transport: MonthlyRustTransport,
  diagnosis: RuleCatalogRuntimeDiagnosis,
): MonthlyRustNetCalculator {
  const read = createStoredMonthlyRustInputReader(db, diagnosis);
  const finance = createMonthlyRustFinanceBridge(transport);
  const calculator: MonthlyRustNetCalculator = Object.assign(
    async (request: AnalysisSalaryRequest) => {
      const input = monthlyRustNetRequest(request, calculator);
      if (!input.settings) throw new Error("RUST_NET_SETTINGS_MISSING");
      const key = analysisSalaryKey(input);
      const cached = completed.read(
        input.context.resolver,
        key,
        isCurrentAnalysisMonth(input.month, input.profile.timeZone),
      );
      if (cached) return cached;
      const captured = await read({ entries: input.context.entries, profile: input.profile });
      const sources = { ...captured.sources };
      const timeline = input.payment?.sourceSettings;
      if (timeline)
        sources.NET_PAY_SETTINGS_TIMELINE = timeline.map((saved) => ({
          month: saved.settings.month,
          settings_json: JSON.stringify(saved.settings),
          revision: saved.revision,
          created_at: saved.createdAt,
          updated_at: saved.updatedAt,
        }));
      // Only original saved/requested domain records cross this boundary.
      // Calculated gross, projection and tax values are never sent from TS.
      if (input.payment)
        sources.SALARY_PAYMENT_PREFERENCES = { value: JSON.stringify(input.payment.preferences) };
      const rows = sources.NET_PAY_SETTINGS_TIMELINE;
      if (
        !Array.isArray(rows) ||
        !rows.some(
          (row) =>
            row.month === input.settings?.month &&
            settingsJson(JSON.parse(row.settings_json)) === settingsJson(input.settings),
        )
      )
        throw new Error("RUST_NET_SETTINGS_SUPERSEDED");
      const result = monthlyRustNetResult(
        input,
        await finance(
          {
            month: input.month,
            perspective: input.payment?.perspective ?? "EARNED",
            sections: { time: false, gross: false, net: true, checks: false },
          },
          { ...captured, sources },
        ),
      );
      if (result.result.status === "available")
        completed.write(
          input.context.resolver,
          key,
          result,
          isCurrentAnalysisMonth(input.month, input.profile.timeZone),
        );
      return result;
    },
    {
      cacheIdentity:
        transport.expectedEngineVersion +
        (process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION === "1"
          ? ":salary-preparation-v1"
          : ":monthly-net-v1"),
      ...(process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION === "1"
        ? { prepare: createStoredMonthlyRustSalaryPreparation(db, transport, diagnosis) }
        : {}),
    },
  );
  return calculator;
}

export function* monthlyRustNetSteps(
  request: AnalysisSalaryRequest,
  calculator: MonthlyRustNetCalculator,
): Generator<AnalysisWorkYield, AutomaticNetPayForecast, void> {
  if (
    request.settings &&
    needsCalendarSalaryInYear(
      Number(request.month.slice(0, 4)),
      request.context.entries,
      request.profile,
    )
  )
    return yield* prepareAutomaticNetPaySteps(
      request.month,
      request.settings,
      request.profile,
      request.context,
      request.payment,
    );
  let result: AutomaticNetPayForecast | undefined;
  yield calculator(request).then((value) => {
    result = value;
  });
  if (!result) throw new Error("RUST_NET_OUTPUT_INVALID");
  return result;
}
