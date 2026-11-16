import { checkedUtf8Length, TRANSPORT_LIMITS } from "../transport/protocol";
import { FORM_RESOURCE_LIMITS } from "../transport/forms/protocol";
import { splitNativeFormReply } from "../transport/forms/wire";

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
};
const allowed = new Set([
  "info",
  "bindOwner",
  "advanceRevision",
  "execute",
  "utility",
  "snapshotDigests",
  "calendarCandidates",
  "admitFinance",
  "admitChecks",
  "runFinance",
  "runChecks",
  "cancelJob",
  "reset",
  "collectRetired",
  "snapshotBegin",
  "snapshotSeal",
  "snapshotAbort",
  "snapshotCalendarCandidates",
  "snapshotCatalogCandidates",
  "snapshotProfileClock",
  "financialCollationPrepare",
  "financialCollationCandidates",
  "financialCollationAbort",
  "calendarBegin",
  "calendarSeal",
  "calendarAbort",
  "calendarWindowPrepare",
  "calendarWindowCandidates",
  "calendarWindowRead",
  "calendarWindowAbort",
]);

async function initialize() {
  const url = new URL("./luna_engine.js", import.meta.url).href;
  const module = (await import(url)) as {
    default: () => Promise<unknown>;
    engineInvoke: (operation: string, payload: string) => string;
    engineInvokeSource?: (header: string, source: string) => string;
    engineInvokeCalendarRanks?: (header: string, source: string) => string;
    engineInvokeCatalogFinalize?: (header: string, source: string) => string;
    engineInvokeFinancialCollationFinalize?: (header: string, source: string) => string;
    engineInvokeCalendarSource?: (header: string, source: string) => string;
    engineInvokeCalendarWindowFinalize?: (header: string, source: string) => string;
    engineFormResource?: (header: string, source: string) => string;
  };
  await module.default();
  const info = JSON.parse(module.engineInvoke("info", "")) as Record<string, unknown>;
  if (info.ok !== true || info.abiVersion !== 1 || typeof info.engineVersion !== "string")
    throw new Error("ABI");
  scope.onmessage = ({ data }) => {
    const message = data as Record<string, unknown> | null;
    try {
      if (!message || !Number.isSafeInteger(message.id) || (message.id as number) <= 0)
        throw new Error("MESSAGE");
      if (message.kind === "FORM_RESOURCE") {
        if (
          typeof module.engineFormResource !== "function" ||
          typeof message.header !== "string" ||
          typeof message.source !== "string"
        )
          throw new Error("MESSAGE");
        checkedUtf8Length(message.header, FORM_RESOURCE_LIMITS.headerBytes);
        checkedUtf8Length(message.source, FORM_RESOURCE_LIMITS.rawBodyBytes);
      } else if (
        message.kind === "SOURCE" ||
        message.kind === "CALENDAR_RANKS" ||
        message.kind === "CATALOG_FINALIZE" ||
        message.kind === "FINANCIAL_COLLATION_FINALIZE" ||
        message.kind === "CALENDAR_SOURCE" ||
        message.kind === "CALENDAR_WINDOW_FINALIZE"
      ) {
        if (
          typeof (message.kind === "SOURCE"
            ? module.engineInvokeSource
            : message.kind === "CALENDAR_RANKS"
              ? module.engineInvokeCalendarRanks
              : message.kind === "CATALOG_FINALIZE"
                ? module.engineInvokeCatalogFinalize
                : message.kind === "CALENDAR_SOURCE"
                  ? module.engineInvokeCalendarSource
                  : message.kind === "CALENDAR_WINDOW_FINALIZE"
                    ? module.engineInvokeCalendarWindowFinalize
                    : module.engineInvokeFinancialCollationFinalize) !== "function" ||
          typeof message.header !== "string" ||
          typeof message.source !== "string"
        )
          throw new Error("MESSAGE");
        checkedUtf8Length(
          message.header,
          message.kind === "SOURCE" ? 131072 : message.kind === "CALENDAR_SOURCE" ? 8192 : 1024,
        );
        checkedUtf8Length(message.source, TRANSPORT_LIMITS.inputBytes);
      } else {
        if (
          message.kind !== "INVOKE" ||
          typeof message.operation !== "string" ||
          !allowed.has(message.operation) ||
          typeof message.payload !== "string"
        )
          throw new Error("MESSAGE");
        const maximum =
          message.operation === "utility"
            ? TRANSPORT_LIMITS.utilityInputBytes
            : ["financialCollationPrepare", "calendarBegin", "calendarWindowPrepare"].includes(
                  message.operation,
                )
              ? TRANSPORT_LIMITS.admissionBytes
              : [
                    "bindOwner",
                    "advanceRevision",
                    "cancelJob",
                    "snapshotSeal",
                    "snapshotAbort",
                    "snapshotCalendarCandidates",
                    "snapshotCatalogCandidates",
                    "snapshotProfileClock",
                    "financialCollationCandidates",
                    "financialCollationAbort",
                    "calendarSeal",
                    "calendarAbort",
                    "calendarWindowCandidates",
                    "calendarWindowRead",
                    "calendarWindowAbort",
                  ].includes(message.operation)
                ? TRANSPORT_LIMITS.controlBytes
                : message.operation === "snapshotBegin"
                  ? 131072
                  : ["info", "reset", "collectRetired", "runFinance", "runChecks"].includes(
                        message.operation,
                      )
                    ? 0
                    : TRANSPORT_LIMITS.inputBytes;
        checkedUtf8Length(message.payload, maximum);
      }
    } catch {
      scope.postMessage({ kind: "ERROR", id: message?.id, code: "INVALID_MESSAGE" });
      return;
    }
    try {
      if (message.kind === "FORM_RESOURCE") {
        const reply = splitNativeFormReply(
          module.engineFormResource!(message.header as string, message.source as string),
        );
        scope.postMessage({ kind: "FORM_REPLY", id: message.id, ...reply });
        return;
      }
      const json =
        message.kind === "SOURCE"
          ? module.engineInvokeSource!(message.header as string, message.source as string)
          : message.kind === "CALENDAR_RANKS"
            ? module.engineInvokeCalendarRanks!(message.header as string, message.source as string)
            : message.kind === "CATALOG_FINALIZE"
              ? module.engineInvokeCatalogFinalize!(
                  message.header as string,
                  message.source as string,
                )
              : message.kind === "FINANCIAL_COLLATION_FINALIZE"
                ? module.engineInvokeFinancialCollationFinalize!(
                    message.header as string,
                    message.source as string,
                  )
                : message.kind === "CALENDAR_SOURCE"
                  ? module.engineInvokeCalendarSource!(
                      message.header as string,
                      message.source as string,
                    )
                  : message.kind === "CALENDAR_WINDOW_FINALIZE"
                    ? module.engineInvokeCalendarWindowFinalize!(
                        message.header as string,
                        message.source as string,
                      )
                    : module.engineInvoke(message.operation as string, message.payload as string);
      checkedUtf8Length(
        json,
        message.kind === "CALENDAR_SOURCE"
          ? TRANSPORT_LIMITS.inputBytes
          : message.operation === "utility"
            ? TRANSPORT_LIMITS.utilityOutputBytes
            : message.operation === "runFinance" || message.operation === "runChecks"
              ? TRANSPORT_LIMITS.inputBytes
              : TRANSPORT_LIMITS.outputBytes,
      );
      scope.postMessage({ kind: "REPLY", id: message.id, json });
    } catch {
      scope.postMessage({ kind: "FATAL", code: "ENGINE_TRAP" });
      scope.close();
    }
  };
  scope.postMessage({
    kind: "READY",
    engineVersion: info.engineVersion,
    abiVersion: info.abiVersion,
    sourceAssembly:
      typeof module.engineInvokeSource === "function" &&
      (info.capabilities as Record<string, unknown>)?.snapshotAssembly === true,
    calendarPreflight: typeof module.engineInvokeCalendarRanks === "function",
    catalogPreflight:
      typeof module.engineInvokeCatalogFinalize === "function" &&
      (info.capabilities as Record<string, unknown>)?.catalogPreflight === true,
    profileClock: (info.capabilities as Record<string, unknown>)?.profileClock === true,
    financialCollation:
      typeof module.engineInvokeFinancialCollationFinalize === "function" &&
      (info.capabilities as Record<string, unknown>)?.financialCollation === true,
    calendarResources:
      typeof module.engineInvokeCalendarSource === "function" &&
      typeof module.engineInvokeCalendarWindowFinalize === "function" &&
      (info.capabilities as Record<string, unknown>)?.calendarSourceAssembly === true &&
      (info.capabilities as Record<string, unknown>)?.calendarWindowResources === true,
    formResources: typeof module.engineFormResource === "function",
  });
}
void initialize().catch(() => {
  scope.postMessage({ kind: "FATAL", code: "INIT_FAILED" });
  scope.close();
});
