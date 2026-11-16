import { requireOptionalNativeModule } from "expo";
import { EngineClient } from "./client";
import { NativeSourceBackend } from "./native-source";
import { FinancialResourceBackend } from "./financial/backend";
import { CalendarResourceBackend } from "./calendar/backend";
import { EngineTransportError, type EngineLane, type EngineOperation } from "./protocol";
import type { FormTransportResponse } from "./forms/protocol";

interface NativeEngine {
  invokeFormResource?: (headerJson: string, rawBody: string) => Promise<FormTransportResponse>;
  readonly transportAbiVersion: number;
  invoke(operation: EngineOperation, json: string, lane: EngineLane | null): Promise<string>;
  invokeSource?: (headerJson: string, sourceJson: string) => Promise<string>;
  invokeCalendarRanks?: (headerJson: string, ranksJson: string) => Promise<string>;
  invokeCatalogFinalize?: (headerJson: string, ranksJson: string) => Promise<string>;
  invokeFinancialCollationFinalize?: (headerJson: string, ranksJson: string) => Promise<string>;
  invokeCalendarSource?: (headerJson: string, sourceJson: string) => Promise<string>;
  invokeCalendarWindowFinalize?: (headerJson: string, ranksJson: string) => Promise<string>;
}
let singleton: EngineClient | undefined;

/** No module means unavailable. This does not fall back to a JS calculator. */
export function getNativeEngineClient(): EngineClient | null {
  if (singleton) return singleton;
  const native = requireOptionalNativeModule<NativeEngine>("LunaEngine");
  if (!native || native.transportAbiVersion !== 1 || typeof native.invoke !== "function")
    return null;
  async function nativeCall<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof EngineTransportError) throw error;
      // Keep the fixed method name, never native messages, payloads or causes.
      throw new EngineTransportError("NATIVE_CALL_FAILED", operation);
    }
  }
  const invoke = (operation: EngineOperation, json: string, lane: EngineLane | null = null) =>
    nativeCall(operation, () => native.invoke(operation, json, lane));
  const client: EngineClient = new EngineClient({
    forms:
      typeof native.invokeFormResource === "function"
        ? async () => ({
            invoke: (header, body) =>
              nativeCall("invokeFormResource", () => native.invokeFormResource!(header, body)),
            current: () => singleton === client,
            retire: () => {
              if (singleton === client) client.close();
            },
            collectRetired: async () => {
              await invoke("collectRetired", "");
            },
          })
        : undefined,
    calendar:
      typeof native.invokeCalendarSource === "function" &&
      typeof native.invokeCalendarWindowFinalize === "function"
        ? new CalendarResourceBackend(async () => ({
            incarnation: native,
            invoke: (operation, json) => invoke(operation, json),
            source: (header, source) =>
              nativeCall("invokeCalendarSource", () =>
                native.invokeCalendarSource!(header, source),
              ),
            finalize: (header, ranks) =>
              nativeCall("invokeCalendarWindowFinalize", () =>
                native.invokeCalendarWindowFinalize!(header, ranks),
              ),
            current: () => singleton === client,
          }))
        : undefined,
    financialCollation:
      typeof native.invokeFinancialCollationFinalize === "function"
        ? new FinancialResourceBackend(async () => ({
            invoke: (operation, json) => invoke(operation, json),
            finalize: (header, ranks) =>
              nativeCall("invokeFinancialCollationFinalize", () =>
                native.invokeFinancialCollationFinalize!(header, ranks),
              ),
            current: () => singleton === client,
            retire: () => client.close(),
          }))
        : undefined,
    sources:
      typeof native.invokeSource === "function"
        ? new NativeSourceBackend(
            (operation, json) => invoke(operation, json),
            (header, source) =>
              nativeCall("invokeSource", () => native.invokeSource!(header, source)),
            typeof native.invokeCalendarRanks === "function"
              ? (header, body) =>
                  nativeCall("invokeCalendarRanks", () => native.invokeCalendarRanks!(header, body))
              : undefined,
            typeof native.invokeCatalogFinalize === "function"
              ? (header, body) =>
                  nativeCall("invokeCatalogFinalize", () =>
                    native.invokeCatalogFinalize!(header, body),
                  )
              : undefined,
          )
        : undefined,
    invoke: (operation, json, lane) => invoke(operation, json, lane ?? null),
    close: () => {
      // Do not send an unqualified delayed reset into a replacement client's
      // singleton core. The caller may await reset() before close(); otherwise
      // the next bindOwner detaches old ownership and schedules disposal.
      if (singleton === client) singleton = undefined;
    },
  });
  singleton = client;
  return client;
}
