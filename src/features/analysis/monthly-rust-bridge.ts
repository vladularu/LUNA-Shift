import {
  createMonthlyRustFinanceBridge,
  type MonthlyRustTransport,
  type MonthlyRustInputs,
} from "./monthly-rust-finance";
import type { MonthlyAnalysisCalculation, MonthlyAnalysisRequest } from "./monthly-analysis";
import type { AnalysisWorkYield } from "./analysis-work-queue";
import { selectComplianceShifts } from "./analysis-data";
import { requireResolvedPackage, RuleResolutionError } from "@/rules/rule-resolver";
import type { MonthlyPayEstimate } from "@/domain/types";
export type { MonthlyRustTransport, MonthlyRustInputs } from "./monthly-rust-finance";

export type MonthlyRustCalculator = ((
  request: MonthlyAnalysisRequest,
) => Promise<MonthlyAnalysisCalculation>) & {
  readonly cacheIdentity?: string;
};

export function monthlyRustRequest(
  request: MonthlyAnalysisRequest,
  calculator: MonthlyRustCalculator | null | undefined,
): MonthlyAnalysisRequest {
  return calculator?.cacheIdentity
    ? { ...request, calculationIdentity: calculator.cacheIdentity }
    : request;
}

type RecordValue = Record<string, unknown>;
type MonthlyRustBridge = (
  request: MonthlyAnalysisRequest,
  inputs: MonthlyRustInputs,
) => Promise<MonthlyAnalysisCalculation>;
const bridges = new WeakMap<MonthlyRustTransport, MonthlyRustBridge>();
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function ready(value: unknown): RecordValue {
  if (!record(value) || value.state !== "READY" || !record(value.value))
    throw new Error("RUST_MONTH_UNAVAILABLE");
  return value.value;
}

/** Reads domain sections only. Native views, labels and layout are never consumed. */
export function monthlyRustResult(
  request: MonthlyAnalysisRequest,
  report: unknown,
): MonthlyAnalysisCalculation {
  if (!record(report) || !record(report.period) || !record(report.sections))
    throw new Error("RUST_MONTH_OUTPUT_INVALID");
  if (report.period.kind !== "MONTH" || report.period.month !== request.month)
    throw new Error("RUST_MONTH_PERIOD_MISMATCH");
  const time = ready(report.sections.time);
  const pay = ready(ready(report.sections.gross).legacy);
  if (
    !Array.isArray(time.monthShifts) ||
    !record(time.summary) ||
    typeof time.summary.ok !== "boolean" ||
    !record(time.shiftTypeAnalysis) ||
    !Array.isArray(time.shiftTypeAnalysis.items) ||
    pay.month !== request.month ||
    typeof pay.available !== "boolean"
  )
    throw new Error("RUST_MONTH_OUTPUT_INVALID");
  let complianceShifts: MonthlyAnalysisCalculation["complianceShifts"];
  try {
    requireResolvedPackage(request.ruleResolver.resolveHoliday(request.month + "-01"));
    complianceShifts = {
      ok: true,
      value: selectComplianceShifts(request.entries, request.month, request.ruleResolver),
    };
  } catch (error) {
    if (!(error instanceof RuleResolutionError)) throw error;
    complianceShifts = { ok: false, error, failure: error.failure };
  }
  return {
    complianceShifts,
    monthShifts: time.monthShifts as MonthlyAnalysisCalculation["monthShifts"],
    summary: time.summary as unknown as MonthlyAnalysisCalculation["summary"],
    shiftTypeAnalysis:
      time.shiftTypeAnalysis as unknown as MonthlyAnalysisCalculation["shiftTypeAnalysis"],
    pay: { ok: true, value: pay as unknown as MonthlyPayEstimate },
  };
}

/** One existing async queue boundary; no polling and no TypeScript salary/time math. */
export function* monthlyRustSteps(
  request: MonthlyAnalysisRequest,
  calculate: MonthlyRustCalculator,
): Generator<AnalysisWorkYield, MonthlyAnalysisCalculation, void> {
  let result: MonthlyAnalysisCalculation | undefined;
  yield calculate(request).then((value) => {
    result = value;
  });
  if (!result) throw new Error("RUST_MONTH_OUTPUT_INVALID");
  return result;
}

/** Serializes access to the existing native engine, independently of app UI state. */
export function createMonthlyRustBridge(transport: MonthlyRustTransport): MonthlyRustBridge {
  const existing = bridges.get(transport);
  if (existing) return existing;
  const finance = createMonthlyRustFinanceBridge(transport);
  const bridge: MonthlyRustBridge = async (request, inputs) =>
    monthlyRustResult(
      request,
      await finance(
        {
          month: request.month,
          perspective: "EARNED",
          sections: { time: true, gross: true, net: false, checks: false },
        },
        inputs,
      ),
    );
  bridges.set(transport, bridge);
  return bridge;
}
