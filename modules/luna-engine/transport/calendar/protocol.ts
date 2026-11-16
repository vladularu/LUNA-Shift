import type { TransportReply } from "../protocol";

export type CalendarOperation =
  | "calendarBegin"
  | "calendarSeal"
  | "calendarAbort"
  | "calendarWindowPrepare"
  | "calendarWindowCandidates"
  | "calendarWindowRead"
  | "calendarWindowAbort"
  | "collectRetired";
declare const sourceTicket: unique symbol;
declare const sourceReceipt: unique symbol;
declare const windowTicket: unique symbol;
export interface BackendCalendarTicket {
  readonly [sourceTicket]: true;
}
export interface BackendCalendarReceipt {
  readonly [sourceReceipt]: true;
}
export interface BackendCalendarWindow {
  readonly [windowTicket]: true;
}
export type CalendarPageView =
  | "EXPANDED"
  | "VISIBLE"
  | "VISIBLE_INDICES"
  | "DATES"
  | "MONTHS"
  | "NAVIGATION"
  | "ENTRY_PRESENTATIONS"
  | "DATE_PREVIEWS";
export interface BackendCalendarNavigation {
  readonly clock: BackendCalendarReceipt;
  readonly header: string;
}
export interface CalendarEndpoint {
  /** Private stable native-core incarnation; never serialized as a locator. */
  readonly incarnation?: object;
  invoke(operation: CalendarOperation, json: string): Promise<string>;
  source(header: string, raw: string): Promise<string>;
  finalize(header: string, ranks: string): Promise<string>;
  current(): boolean;
}
export interface CalendarBackend {
  presentation?(header: string, raw: string): Promise<TransportReply>;
  begin(header: string): Promise<BackendCalendarTicket>;
  source(ticket: BackendCalendarTicket, groupHeader: string, raw: string): Promise<void>;
  seal(
    ticket: BackendCalendarTicket,
  ): Promise<{ receipt: BackendCalendarReceipt; metadata: TransportReply }>;
  abort(ticket: BackendCalendarTicket): Promise<void>;
  prepare(
    receipt: BackendCalendarReceipt,
    header: string,
    navigation?: BackendCalendarNavigation,
  ): Promise<{ ticket?: BackendCalendarWindow; metadata: TransportReply }>;
  candidates(
    ticket: BackendCalendarWindow,
    after: number | null,
    limit: number,
  ): Promise<TransportReply>;
  finalize(ticket: BackendCalendarWindow, ranks: string): Promise<TransportReply>;
  read(
    ticket: BackendCalendarWindow,
    view: CalendarPageView,
    after: number | null,
    limit: number,
  ): Promise<TransportReply>;
  abortWindow(ticket: BackendCalendarWindow): Promise<void>;
}
