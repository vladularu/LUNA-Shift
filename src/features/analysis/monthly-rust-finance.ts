import { annualRustMonthTotals, type AnnualSalarySource } from "./annual-rust-month-totals";
import { measureAnalysisInput } from "@/application/analysis-input-performance";

type MonthlyRustOperation =
  | "info"
  | "bindOwner"
  | "snapshotBegin"
  | "snapshotAbort"
  | "snapshotCalendarCandidates"
  | "snapshotCatalogCandidates"
  | "snapshotSeal"
  | "admitFinance"
  | "runFinance"
  | "admitChecks"
  | "runChecks";
type RecordValue = Record<string, unknown>;
export interface MonthlyRustTransport {
  readonly expectedEngineVersion: string;
  invoke(operation: MonthlyRustOperation, json: string): Promise<string>;
  source(header: string, body: string): Promise<string>;
  calendarRanks(header: string, body: string): Promise<string>;
  catalogFinalize(header: string, body: string): Promise<string>;
}
export interface MonthlyRustInputs {
  readonly referenceDate: string;
  readonly sources: Readonly<Record<string, unknown>>;
  readonly catalogs: unknown;
}
interface MonthlyRustFinanceRequest {
  readonly includeSalaryPreparation?: boolean;
  readonly salaryForecastMonth?: string;
  readonly month: string;
  readonly perspective: "EARNED" | "PAYOUT";
  readonly sections: {
    readonly time: boolean;
    readonly gross: boolean;
    readonly net: boolean;
    readonly checks: boolean;
  };
}
interface AnnualRustFinanceRequest {
  readonly year: number;
  readonly grossSource?: AnnualSalarySource;
  readonly includeSalaryForecast?: boolean;
  readonly perspective: "EARNED" | "PAYOUT";
  readonly sections: {
    readonly time: boolean;
    readonly gross: boolean;
    readonly net: boolean;
    readonly checks: boolean;
  };
}
export interface AnnualRustDomainReport {
  readonly period: { readonly kind: "YEAR"; readonly year: number };
  readonly sections: Readonly<Record<string, unknown>>;
  /** Original calculation DTO only; never a native display/view object. */
  readonly salaryForecast?: unknown;
}
export interface MonthlyRustDomainReport {
  readonly period: { readonly kind: "MONTH"; readonly month: string };
  readonly sections: Readonly<Record<string, unknown>>;
  readonly salaryForecast?: unknown;
}
interface MonthlyRustFinanceBridge {
  (request: MonthlyRustFinanceRequest, inputs: MonthlyRustInputs): Promise<MonthlyRustDomainReport>;
  (request: AnnualRustFinanceRequest, inputs: MonthlyRustInputs): Promise<AnnualRustDomainReport>;
}
const bridges = new WeakMap<MonthlyRustTransport, MonthlyRustFinanceBridge>();
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function createMonthlyRustFinanceBridge(
  transport: MonthlyRustTransport,
): MonthlyRustFinanceBridge {
  const existing = bridges.get(transport);
  if (existing) return existing;
  let sequence = 0;
  let tail = Promise.resolve();
  const ownerScope = `month-trial-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  async function invoke(operation: MonthlyRustOperation, value: unknown = "") {
    const text = await transport.invoke(
      operation,
      typeof value === "string" ? value : measureAnalysisInput(3, 0, () => JSON.stringify(value)),
    );
    const reply: unknown = measureAnalysisInput(4, text.length, () => JSON.parse(text));
    if (!record(reply) || reply.ok !== true) {
      const error = new Error("RUST_MONTH_TRANSPORT_FAILED");
      if (
        record(reply) &&
        typeof reply.code === "string" &&
        /^[A-Z][A-Z0-9_]{2,39}$/.test(reply.code)
      )
        error.name = "RustNative." + reply.code.replaceAll("_", ".");
      throw error;
    }
    return reply;
  }
  async function calculate(
    request: MonthlyRustFinanceRequest | AnnualRustFinanceRequest,
    inputs: MonthlyRustInputs,
  ): Promise<MonthlyRustDomainReport | AnnualRustDomainReport> {
    const info = await invoke("info");
    if (typeof info.engineVersion !== "string" || !Array.isArray(info.sourceKinds))
      throw new Error("RUST_MONTH_TRANSPORT_INVALID");
    if (info.engineVersion !== transport.expectedEngineVersion)
      throw new Error("RUST_MONTH_ENGINE_MISMATCH");
    const epoch = ++sequence;
    await invoke("bindOwner", { ownerScope, ownerEpoch: epoch });
    const header = {
      ownerScope,
      ownerEpoch: epoch,
      snapshotId: `month-${epoch}`,
      snapshotRevision: epoch,
      referenceDate: inputs.referenceDate,
      selectedPackageIds: { tariff: [], legal: [], holiday: [] },
      completeness: {
        entries: { kind: "MISSING" },
        history: { kind: "MISSING" },
        annexAEntries: { kind: "MISSING" },
        annexAPauseDetails: { kind: "MISSING" },
      },
    };
    const building = await invoke("snapshotBegin", header);
    if (!Number.isSafeInteger(building.builderId)) throw new Error("RUST_MONTH_BUILDER_INVALID");
    const builderId = building.builderId;
    const parsed = (text: string) => {
      const reply: unknown = measureAnalysisInput(4, text.length, () => JSON.parse(text));
      if (!record(reply) || reply.ok !== true) throw new Error("RUST_MONTH_SOURCE_FAILED");
      return reply;
    };
    const source = (value: unknown) => ({
      state: "READY",
      revision: epoch,
      coverage: { kind: "ALL_HISTORY" },
      payload: { schemaVersion: 1, data: { kind: value === null ? "NULL" : "VALUE" } },
    });
    let identity: unknown;
    try {
      for (const [kind, raw] of Object.entries(inputs.sources)) {
        const value =
          kind === "CALENDAR_ENTRIES" && record(raw) ? { ...raw, platformCollationRanks: {} } : raw;
        parsed(
          await transport.source(
            JSON.stringify({ builderId, target: "SOURCE", group: { kind, source: source(value) } }),
            value === null ? "" : measureAnalysisInput(3, 0, () => JSON.stringify(value)),
          ),
        );
      }
      if (!record(inputs.catalogs) || !record(inputs.catalogs.current))
        throw new Error("RUST_MONTH_CATALOG_INVALID");
      for (const kind of ["TARIFF", "LEGAL", "HOLIDAY"]) {
        const part = inputs.catalogs.current[kind.toLowerCase()];
        if (
          !record(part) ||
          part.state !== "READY" ||
          !record(part.payload) ||
          !record(part.payload.data)
        )
          throw new Error("RUST_MONTH_CATALOG_INVALID");
        const value = part.payload.data.value;
        parsed(
          await transport.source(
            JSON.stringify({
              builderId,
              target: "CATALOG",
              group: { kind, source: source(value) },
            }),
            measureAnalysisInput(3, 0, () => JSON.stringify(value)),
          ),
        );
      }
      const ranks = async (
        operation: "snapshotCalendarCandidates" | "snapshotCatalogCandidates",
      ) => {
        const values = new Set<string>();
        let after: number | null = null;
        do {
          const reply = await invoke(operation, { builderId, after, limit: 1024 });
          if (!record(reply.page) || !Array.isArray(reply.page.candidates))
            throw new Error("RUST_MONTH_RANKS_INVALID");
          for (const value of reply.page.candidates) {
            if (typeof value !== "string") throw new Error("RUST_MONTH_RANKS_INVALID");
            values.add(value);
          }
          if (values.size > 100_000) throw new Error("RUST_MONTH_RANKS_TOO_LARGE");
          const next = reply.page.nextAfter;
          if (next !== null && (!Number.isSafeInteger(next) || Number(next) <= (after ?? -1)))
            throw new Error("RUST_MONTH_RANKS_INVALID");
          after = next as number | null;
        } while (after !== null);
        return measureAnalysisInput(
          operation === "snapshotCalendarCandidates" ? 5 : 6,
          values.size,
          () => {
            const sorted = [...values].sort((a, b) => a.localeCompare(b));
            return Object.fromEntries(sorted.map((value, index) => [value, index]));
          },
        );
      };
      const calendarHeader = JSON.stringify({ builderId });
      const calendarOrder = await ranks("snapshotCalendarCandidates");
      parsed(
        await transport.calendarRanks(
          calendarHeader,
          measureAnalysisInput(3, 0, () => JSON.stringify(calendarOrder)),
        ),
      );
      const catalogHeader = JSON.stringify({ builderId });
      const catalogOrder = await ranks("snapshotCatalogCandidates");
      parsed(
        await transport.catalogFinalize(
          catalogHeader,
          measureAnalysisInput(3, 0, () => JSON.stringify(catalogOrder)),
        ),
      );
      identity = (await invoke("snapshotSeal", { builderId })).identity;
      if (!record(identity)) throw new Error("RUST_MONTH_SNAPSHOT_INVALID");
    } catch (error) {
      await invoke("snapshotAbort", { builderId }).catch(() => {});
      throw error;
    }
    const envelope = {
      wireSchemaVersion: 1,
      expectedEngineVersion: info.engineVersion,
      calculationContractVersion: info.calculationContractVersion,
    };
    let call = 0;
    type Period = MonthlyRustDomainReport["period"] | AnnualRustDomainReport["period"];
    type Sections = AnnualRustFinanceRequest["sections"];
    async function run(
      period: Period,
      sections: Sections,
      checks = false,
      extra: RecordValue = {},
    ) {
      const requestId = `month-report-${epoch}-${++call}`;
      const admission = await invoke(checks ? "admitChecks" : "admitFinance", {
        ...envelope,
        command: {
          kind: "CALCULATE",
          request: {
            guard: { snapshot: identity, requestId, requestRevision: epoch },
            periods: [period],
            sections,
            perspective: request.perspective,
            priority: "INTERACTIVE",
            ...extra,
          },
        },
      });
      if (admission.state !== "QUEUED") throw new Error("RUST_MONTH_ADMISSION_FAILED");
      const reply = await invoke(checks ? "runChecks" : "runFinance");
      const result = record(reply.result) && reply.result;
      const item =
        result && Array.isArray(result.reports) && result.reports.length === 1 && result.reports[0];
      if (
        reply.state !== "COMPLETED" ||
        !record(item) ||
        !record(item.period) ||
        !record(item.sections)
      )
        throw new Error("RUST_MONTH_CALCULATION_FAILED");
      if (
        item.period.kind !== period.kind ||
        (period.kind === "YEAR"
          ? item.period.year !== period.year
          : item.period.month !== period.month)
      )
        throw new Error("RUST_MONTH_PERIOD_MISMATCH");
      return item as RecordValue & { sections: RecordValue };
    }
    if (!("year" in request)) {
      if (
        request.sections.checks &&
        (request.sections.time || request.sections.gross || request.sections.net)
      )
        throw new Error("RUST_CHECKS_REQUEST_INVALID");
      const report =
        request.includeSalaryPreparation && !Object.values(request.sections).some(Boolean)
          ? {
              sections: Object.fromEntries(
                ["time", "gross", "net", "checks"].map((key) => [key, { state: "NOT_REQUESTED" }]),
              ),
            }
          : await run(
              { kind: "MONTH", month: request.month },
              request.sections,
              request.sections.checks,
            );
      let salaryForecast: unknown;
      if (request.includeSalaryPreparation) {
        if (request.sections.checks) throw new Error("RUST_SALARY_REQUEST_INVALID");
        const month = request.salaryForecastMonth ?? request.month;
        if (month.slice(0, 4) !== request.month.slice(0, 4))
          throw new Error("RUST_SALARY_YEAR_MISMATCH");
        const annual = await run(
          { kind: "MONTH", month },
          { time: false, gross: false, net: false, checks: false },
          false,
          { payrollPage: true },
        );
        const views = record(annual.views) && annual.views;
        const page = views && views.payrollPage;
        const value = record(page) && page.state === "READY" && record(page.value) && page.value;
        const forecast = value && value.annualEditor;
        if (record(forecast))
          salaryForecast = {
            payments: forecast.payments,
            proposal: forecast.proposal,
            automatic: forecast.automatic,
            issue: forecast.issue,
          };
      }
      return {
        period: { kind: "MONTH", month: request.month },
        sections: report.sections,
        ...(salaryForecast === undefined ? {} : { salaryForecast }),
      };
    }
    const period = { kind: "YEAR", year: request.year } as const;
    const sections: RecordValue = Object.fromEntries(
      ["time", "gross", "net", "checks"].map((key) => [key, { state: "NOT_REQUESTED" }]),
    );
    if (request.sections.time || request.sections.net) {
      const report = await run(period, {
        time: request.sections.time,
        gross: false,
        net: request.sections.net,
        checks: false,
      });
      sections.time = report.sections.time;
      sections.net = report.sections.net;
    }
    if (request.sections.gross) {
      if (!request.grossSource || request.perspective !== "EARNED")
        throw new Error("RUST_ANNUAL_GROSS_REQUEST_INVALID");
      const months: unknown[] = [];
      for (let index = 1; index <= 12; index++) {
        const month = `${request.year}-${String(index).padStart(2, "0")}`;
        const report = await run(
          { kind: "MONTH", month },
          { time: false, gross: true, net: false, checks: false },
        );
        const section = report.sections.gross;
        const value =
          record(section) && section.state === "READY" && record(section.value) && section.value;
        const legacy = value && value.legacy;
        if (
          record(legacy) &&
          legacy.state === "UNAVAILABLE" &&
          record(legacy.reason) &&
          legacy.reason.code === "FINANCIAL_RULES_UNAVAILABLE"
        ) {
          // Exactly the original earned-year behavior for an uncovered month.
          months.push({ month, available: false });
          continue;
        }
        if (!record(legacy) || legacy.state !== "READY" || !record(legacy.value))
          throw new Error("RUST_ANNUAL_MONTH_UNAVAILABLE");
        months.push(legacy.value);
      }
      sections.gross = {
        state: "READY",
        value: {
          legacy: {
            state: "READY",
            value: annualRustMonthTotals(request.year, request.grossSource, months),
          },
        },
      };
    }
    if (request.sections.checks) {
      const report = await run(
        period,
        { time: false, gross: false, net: false, checks: true },
        true,
      );
      sections.checks = report.sections.checks;
    }
    let salaryForecast: unknown;
    if (request.sections.net && request.includeSalaryForecast !== false) {
      // Existing bounded monthly payroll response already contains the original
      // mathematical annual forecast. No payroll UI frame is returned to React.
      const report = await run(
        { kind: "MONTH", month: `${request.year}-12` },
        { time: false, gross: false, net: false, checks: false },
        false,
        { payrollPage: true },
      );
      const views = record(report.views) && report.views;
      const page = views && views.payrollPage;
      const value = record(page) && page.state === "READY" && record(page.value) && page.value;
      const forecast = value && value.annualEditor;
      if (record(forecast))
        salaryForecast = {
          payments: forecast.payments,
          proposal: forecast.proposal,
          automatic: forecast.automatic,
          issue: forecast.issue,
        };
    }
    return { period, sections, ...(salaryForecast === undefined ? {} : { salaryForecast }) };
  }
  const bridge = ((
    request: MonthlyRustFinanceRequest | AnnualRustFinanceRequest,
    inputs: MonthlyRustInputs,
  ) => {
    const result = tail.then(() => calculate(request, inputs));
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }) as MonthlyRustFinanceBridge;
  bridges.set(transport, bridge);
  return bridge;
}
