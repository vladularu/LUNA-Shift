import { requireOptionalNativeModule } from "expo";
import type { MonthlyRustTransport } from "./monthly-rust-bridge";
import { MONTHLY_RUST_IOS_ENGINE_VERSION } from "./monthly-rust-engine-version";

interface NativeMonthEngine {
  readonly transportAbiVersion: number;
  readonly annualGrossSummaryEngineVersion?: string;
  invoke(operation: string, json: string, lane: "finance" | "checks" | null): Promise<string>;
  invokeSource(header: string, body: string): Promise<string>;
  invokeCalendarRanks(header: string, body: string): Promise<string>;
  invokeCatalogFinalize(header: string, body: string): Promise<string>;
}

let singleton: MonthlyRustTransport | undefined;
export function getMonthlyRustTransport(): MonthlyRustTransport | null {
  if (singleton) return singleton;
  const native = requireOptionalNativeModule<NativeMonthEngine>("LunaEngine");
  if (
    !native ||
    native.transportAbiVersion !== 1 ||
    typeof native.invoke !== "function" ||
    typeof native.invokeSource !== "function" ||
    typeof native.invokeCalendarRanks !== "function" ||
    typeof native.invokeCatalogFinalize !== "function"
  )
    return null;
  const summaryVersion = native.annualGrossSummaryEngineVersion;
  // A present but invalid version signals a broken module, not an older build.
  if (summaryVersion !== undefined && !/^luna-engine-v1:[a-f0-9]{64}$/.test(summaryVersion))
    return null;
  singleton = {
    expectedEngineVersion: summaryVersion ?? MONTHLY_RUST_IOS_ENGINE_VERSION,
    supportsAnnualGrossSummary: summaryVersion !== undefined,
    invoke: (operation, json) =>
      native.invoke(
        operation,
        json,
        operation === "admitFinance" || operation === "runFinance"
          ? "finance"
          : operation === "runChecks"
            ? "checks"
            : null,
      ),
    source: (header, body) => native.invokeSource(header, body),
    calendarRanks: (header, body) => native.invokeCalendarRanks(header, body),
    catalogFinalize: (header, body) => native.invokeCatalogFinalize(header, body),
  };
  return singleton;
}
