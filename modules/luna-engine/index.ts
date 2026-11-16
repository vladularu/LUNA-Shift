export { EngineClient, type EngineReceipt } from "./transport/client";
export type { EngineUtilityReceipt } from "./transport/utility";
export {
  finalizeSnapshotCatalog,
  type CatalogFinalization,
  type CatalogRankCache,
  type NativeCatalogIds,
} from "./transport/catalog";
export type {
  FinancialCollationTicket,
  FinancialCollationReceipt,
  FinancialCollationPreparation,
  FinancialCandidatePage,
  FinancialRankPayload,
  FinancialUnavailableReason,
} from "./transport/financial/protocol";
export { EngineTransportError, type EngineBackend, type EngineLane } from "./transport/protocol";
export { getNativeEngineClient } from "./transport/native";
export { createWebEngineClient } from "./transport/web";
export type { SnapshotSourceTicket, SnapshotSourceReceipt } from "./transport/source";
export type { CalendarSourceTicket, CalendarSourceReceipt } from "./transport/calendar/source";
export type { CalendarWindowTicket, CalendarWindowPreparation } from "./transport/calendar/windows";
export type { CalendarPageView } from "./transport/calendar/protocol";
export {
  prepareCalendarWindow,
  type PreparedCalendarWindow,
  type CalendarRankCache,
} from "./transport/calendar/prepare";
export { LocaleRanker } from "./transport/locale/client";
export {
  LocaleRankerError,
  type LocaleRankTicket,
  type LocaleRankReceipt,
  type LocaleRankPort,
} from "./transport/locale/protocol";
export { createNativeLocaleRanker } from "./transport/locale/native";
export { createWebLocaleRanker } from "./transport/locale/web";
export { localeProbe as currentLocaleKey } from "./transport/locale/core";
export { prepareFinancialCollation } from "./transport/financial/prepare";
export type { PreparedFinancialCollation } from "./transport/financial/prepare";
