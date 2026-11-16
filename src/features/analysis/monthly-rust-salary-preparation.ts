import type { SQLiteDatabase } from "expo-sqlite";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import { employmentProfileAt } from "@/domain/employment-history";
import { collectAnnualSalaryPayments } from "@/domain/net-pay-profile";
import { selectMonthlyAnalysisEntries } from "./analysis-data";
import type { AnalysisSalaryRequest, PreparedAnalysisSalary } from "./analysis-salary";
import {
  isAnnualSalaryForecast,
  isSalaryPaymentProjection,
  persistentSalaryValue,
} from "./persistent-salary-value";
import { monthlyRustNetResult } from "./monthly-rust-net";
import { createStoredMonthlyRustInputReader } from "./monthly-rust-source";
import {
  createMonthlyRustFinanceBridge,
  type MonthlyRustDomainReport,
  type MonthlyRustTransport,
} from "./monthly-rust-finance";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, part) =>
    record(part)
      ? Object.fromEntries(
          Object.keys(part)
            .sort()
            .map((key) => [key, part[key]]),
        )
      : part,
  );
const needsNet = (request: AnalysisSalaryRequest) =>
  request.settings?.version === 2 && request.payment?.perspective !== "EARNED";

/** Original DTOs only. Attach existing loaded row metadata; never recalculate pay. */
export function monthlyRustSalaryPreparationResult(
  request: AnalysisSalaryRequest,
  report: MonthlyRustDomainReport,
): PreparedAnalysisSalary {
  if (report.period.kind !== "MONTH" || report.period.month !== request.month)
    throw new Error("RUST_SALARY_PERIOD_MISMATCH");
  const blocked = request.context.testMonths?.includes(request.month) === true;
  const annual = report.salaryForecast;
  const neutral =
    blocked &&
    record(annual) &&
    Array.isArray(annual.payments) &&
    annual.payments.length === 0 &&
    annual.proposal === null &&
    annual.automatic === false &&
    annual.issue === null;
  if (!isAnnualSalaryForecast(annual) && !neutral) throw new Error("RUST_SALARY_ANNUAL_INVALID");
  let projection: unknown;
  if (request.payment) {
    const section = report.sections.gross;
    const value =
      record(section) && section.state === "READY" && record(section.value) && section.value;
    const legacy = value && value.legacy;
    const raw = record(legacy) && legacy.state === "READY" && record(legacy.value) && legacy.value;
    if (!raw || !Array.isArray(raw.sources)) throw new Error("RUST_SALARY_PROJECTION_INVALID");
    const tests = new Set(request.context.testMonths ?? []);
    const entries = request.context.entries.filter((entry) => !tests.has(entry.date.slice(0, 7)));
    projection = {
      ...raw,
      sources: raw.sources.map((source) => {
        if (!record(source) || typeof source.month !== "string")
          throw new Error("RUST_SALARY_SOURCE_INVALID");
        return {
          ...source,
          profile: employmentProfileAt(request.profile, source.month + "-01"),
          shifts: selectMonthlyAnalysisEntries(entries, source.month).monthShifts,
        };
      }),
    };
    if (!isSalaryPaymentProjection(projection, request))
      throw new Error("RUST_SALARY_PROJECTION_INVALID");
  }
  const result = {
    annual,
    forecast: needsNet(request) ? monthlyRustNetResult(request, report) : null,
    ...(projection === undefined ? {} : { projection }),
  };
  // All-test-month neutral annual UI state is deliberately not persistable.
  if (!persistentSalaryValue(result, request) && !neutral)
    throw new Error("RUST_SALARY_OUTPUT_INVALID");
  return result as PreparedAnalysisSalary;
}

export function createStoredMonthlyRustSalaryPreparation(
  db: SQLiteDatabase,
  transport: MonthlyRustTransport,
  diagnosis: RuleCatalogRuntimeDiagnosis,
) {
  const read = createStoredMonthlyRustInputReader(db, diagnosis),
    finance = createMonthlyRustFinanceBridge(transport);
  return async (request: AnalysisSalaryRequest): Promise<PreparedAnalysisSalary> => {
    if (request.payment?.perspective === "EARNED")
      throw new Error("RUST_SALARY_PERSPECTIVE_UNSUPPORTED");
    const captured = await read({ entries: request.context.entries, profile: request.profile }),
      sources = { ...captured.sources };
    const timeline = request.payment?.sourceSettings;
    if (timeline) {
      if (canonical(collectAnnualSalaryPayments(timeline)) !== canonical(request.annualPayments))
        throw new Error("RUST_SALARY_PAYMENTS_SUPERSEDED");
      sources.NET_PAY_SETTINGS_TIMELINE = timeline.map((saved) => ({
        month: saved.settings.month,
        settings_json: JSON.stringify(saved.settings),
        revision: saved.revision,
        created_at: saved.createdAt,
        updated_at: saved.updatedAt,
      }));
    }
    if (request.payment)
      sources.SALARY_PAYMENT_PREFERENCES = { value: JSON.stringify(request.payment.preferences) };
    if (needsNet(request)) {
      const rows = sources.NET_PAY_SETTINGS_TIMELINE;
      if (
        !Array.isArray(rows) ||
        !rows.some(
          (row) =>
            row.month === request.settings?.month &&
            canonical(JSON.parse(row.settings_json)) === canonical(request.settings),
        )
      )
        throw new Error("RUST_NET_SETTINGS_SUPERSEDED");
    }
    const tests = new Set(request.context.testMonths ?? []);
    const salaryForecastMonth = tests.has(request.month)
      ? Array.from(
          { length: 12 },
          (_, index) => request.month.slice(0, 4) + "-" + String(index + 1).padStart(2, "0"),
        ).find((month) => !tests.has(month))
      : request.month;
    return monthlyRustSalaryPreparationResult(
      request,
      await finance(
        {
          month: request.month,
          perspective: request.payment?.perspective ?? "EARNED",
          includeSalaryPreparation: true,
          salaryForecastMonth,
          sections: {
            time: false,
            gross: request.payment !== undefined,
            net: needsNet(request),
            checks: false,
          },
        },
        { ...captured, sources },
      ),
    );
  };
}
