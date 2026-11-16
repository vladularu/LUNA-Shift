import {
  checkedRawSourceString,
  checkedUtf8Length,
  EngineTransportError,
  type TransportReply,
} from "../protocol";
import type { BackendCalendarWindow, CalendarBackend, CalendarPageView } from "./protocol";
import { CalendarSources, calendarCurrent, type CalendarSourceReceipt } from "./source";
import { record } from "./wire";
declare const windowBrand: unique symbol;
export interface CalendarWindowTicket {
  readonly [windowBrand]: true;
}
export type CalendarWindowPreparation =
  | { readonly state: "UNAVAILABLE"; readonly metadata: TransportReply }
  | {
      readonly state: "PREPARED";
      readonly ticket: CalendarWindowTicket;
      readonly metadata: TransportReply;
    };
export interface CalendarWindowPrepareOptions {
  readonly isCurrent?: () => boolean;
  readonly navigation?: { readonly receipt: CalendarSourceReceipt; readonly header: string };
}
interface Window {
  readonly source: CalendarSourceReceipt;
  readonly clock?: CalendarSourceReceipt;
  readonly backend: CalendarBackend;
  readonly native: BackendCalendarWindow;
  readonly channel: string;
  readonly serial: number;
  readonly current?: () => boolean;
  phase: "OPEN" | "READY" | "CLOSED";
  tail: Promise<void>;
  abort?: Promise<void>;
}
function publicMetadata(v: TransportReply): TransportReply {
  const { resourceId: _id, ...rest } = v;
  return rest;
}
/** Bounded host lifecycle only. Native owns recurrence, ordering and grouping. */
export class CalendarWindows {
  private serial = 0;
  private preparing = 0;
  private queued = 0;
  private rawFinalizing?: Window;
  private readonly states = new Set<Window>();
  private readonly tickets = new WeakMap<CalendarWindowTicket, Window>();
  private readonly channels = new Map<string, number>();
  constructor(private readonly sources: CalendarSources) {}
  async prepare(
    source: CalendarSourceReceipt,
    header: string,
    options: CalendarWindowPrepareOptions = {},
  ): Promise<CalendarWindowPreparation> {
    const navigation = options.navigation
      ? { receipt: options.navigation.receipt, header: options.navigation.header }
      : undefined;
    const hostCurrent = options.isCurrent;
    if (
      !this.sources.isCurrent(source, "ROWS") ||
      (navigation && !this.sources.isCurrent(navigation.receipt, "CLOCK")) ||
      !calendarCurrent(hostCurrent)
    )
      throw new EngineTransportError("STALE_CALENDAR_WINDOW");
    checkedUtf8Length(header, 8192);
    if (navigation) checkedUtf8Length(navigation.header, 8192);
    const input: unknown = JSON.parse(header);
    if (!record(input) || !record(input.guard) || typeof input.guard.requestId !== "string")
      throw new EngineTransportError("INVALID_CALENDAR_WINDOW_REQUEST");
    const channel = input.guard.requestId;
    if (this.serial >= Number.MAX_SAFE_INTEGER)
      throw new EngineTransportError("CALENDAR_SEQUENCE_EXHAUSTED");
    const serial = ++this.serial;
    for (const s of this.states) if (!this.current(s) || s.channel === channel) this.close(s);
    if (
      this.preparing >= 4 ||
      this.states.size >= 12 ||
      (this.channels.size >= 32 && !this.channels.has(channel))
    )
      throw new EngineTransportError("CALENDAR_WINDOW_QUEUE_LIMIT");
    this.channels.set(channel, serial);
    const current = () =>
      this.channels.get(channel) === serial &&
      this.sources.isCurrent(source, "ROWS") &&
      (!navigation || this.sources.isCurrent(navigation.receipt, "CLOCK")) &&
      calendarCurrent(hostCurrent);
    if (!current()) throw new EngineTransportError("STALE_CALENDAR_WINDOW");
    let created: Window | undefined;
    this.preparing++;
    try {
      return await this.sources.use(source, async (backend, native) => {
        const result = navigation
          ? await this.sources.use(navigation.receipt, (clockBackend, clock) => {
              if (clockBackend !== backend) throw new EngineTransportError("STALE_CALENDAR_WINDOW");
              return backend.prepare(native, header, { clock, header: navigation.header });
            })
          : await backend.prepare(native, header);
        if (result.ticket)
          created = {
            source,
            clock: navigation?.receipt,
            backend,
            native: result.ticket,
            channel,
            serial,
            current: hostCurrent,
            phase: "OPEN",
            tail: Promise.resolve(),
          };
        if (!current()) throw new EngineTransportError("STALE_CALENDAR_WINDOW");
        if (!created) return { state: "UNAVAILABLE", metadata: publicMetadata(result.metadata) };
        const ticket = Object.freeze({}) as CalendarWindowTicket;
        this.states.add(created);
        this.tickets.set(ticket, created);
        return { state: "PREPARED", ticket, metadata: publicMetadata(result.metadata) };
      });
    } catch (e) {
      if (created) this.close(created);
      throw e;
    } finally {
      this.preparing--;
      if (!created && this.channels.get(channel) === serial) this.channels.delete(channel);
    }
  }
  candidates(ticket: CalendarWindowTicket, after: number | null, limit: number) {
    const s = this.get(ticket);
    return this.enqueue(s, () => s.backend.candidates(s.native, after, limit));
  }
  finalize(ticket: CalendarWindowTicket, ranks: string) {
    const s = this.get(ticket);
    checkedRawSourceString(ranks, 33554432);
    if (this.rawFinalizing) throw new EngineTransportError("CALENDAR_RANK_QUEUE_FULL");
    this.rawFinalizing = s;
    return this.enqueue(s, async () => {
      if (s.phase !== "OPEN") throw new EngineTransportError("CALENDAR_WINDOW_NOT_OPEN");
      const v = await s.backend.finalize(s.native, ranks);
      this.ensure(s);
      s.phase = "READY";
      return v;
    }).finally(() => {
      if (this.rawFinalizing === s) this.rawFinalizing = undefined;
    });
  }
  read(ticket: CalendarWindowTicket, view: CalendarPageView, after: number | null, limit: number) {
    const s = this.get(ticket);
    return this.enqueue(s, () => {
      if (s.phase !== "READY") throw new EngineTransportError("CALENDAR_WINDOW_NOT_READY");
      return s.backend.read(s.native, view, after, limit);
    });
  }
  async abort(ticket: CalendarWindowTicket) {
    const s = this.tickets.get(ticket);
    if (!s) throw new EngineTransportError("INVALID_CALENDAR_WINDOW_TICKET");
    this.close(s);
    await s.abort;
  }
  isCurrent(ticket: CalendarWindowTicket) {
    const s = this.tickets.get(ticket);
    return !!s && this.current(s);
  }
  invalidate() {
    for (const s of this.states) this.close(s);
    this.channels.clear();
  }
  private enqueue(s: Window, operation: () => Promise<TransportReply>) {
    if (this.queued >= 16)
      return Promise.reject(new EngineTransportError("CALENDAR_WINDOW_QUEUE_LIMIT"));
    this.queued++;
    const work = s.tail.then(async () => {
      this.ensure(s);
      const value = await operation();
      this.ensure(s);
      return publicMetadata(value);
    });
    s.tail = work.then(
      () => {},
      () => {},
    );
    return work.finally(() => {
      this.queued--;
    });
  }
  private get(ticket: CalendarWindowTicket) {
    const s = this.tickets.get(ticket);
    if (!s) throw new EngineTransportError("INVALID_CALENDAR_WINDOW_TICKET");
    this.ensure(s);
    return s;
  }
  private current(s: Window) {
    return (
      s.phase !== "CLOSED" &&
      this.channels.get(s.channel) === s.serial &&
      this.sources.isCurrent(s.source, "ROWS") &&
      (!s.clock || this.sources.isCurrent(s.clock, "CLOCK")) &&
      calendarCurrent(s.current)
    );
  }
  private ensure(s: Window) {
    if (!this.current(s)) throw new EngineTransportError("STALE_CALENDAR_WINDOW");
  }
  private close(s: Window) {
    if (s.phase === "CLOSED") return;
    s.phase = "CLOSED";
    this.states.delete(s);
    if (this.channels.get(s.channel) === s.serial) this.channels.delete(s.channel);
    s.abort = s.backend.abortWindow(s.native).catch(() => {});
  }
}
