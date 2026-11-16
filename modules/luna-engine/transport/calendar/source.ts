import {
  checkedRawSourceString,
  checkedUtf8Length,
  EngineTransportError,
  type TransportReply,
} from "../protocol";
import type { BackendCalendarReceipt, BackendCalendarTicket, CalendarBackend } from "./protocol";
import { sourceExpectation, type ExpectedCalendarSource } from "./wire";
import { presentationBody, presentationHeader } from "./presentation";
declare const ticketBrand: unique symbol;
declare const receiptBrand: unique symbol;
export interface CalendarSourceTicket {
  readonly [ticketBrand]: true;
}
export interface CalendarSourceReceipt {
  readonly [receiptBrand]: true;
  readonly reply: TransportReply;
}
export interface CalendarEnvironment {
  capture(): number;
  current(owner: number): boolean;
  ready(owner: number): Promise<void>;
  backend(): CalendarBackend | undefined;
}
interface Source {
  readonly owner: number;
  readonly sequence: number;
  readonly expected: ExpectedCalendarSource;
  readonly backend: CalendarBackend;
  readonly native: BackendCalendarTicket;
  readonly current?: () => boolean;
  phase: "OPEN" | "SEALING" | "CLOSED";
  tail: Promise<void>;
  groups: number;
  units: number;
  failed: boolean;
  aborted: boolean;
}
interface Receipt {
  readonly source: Source;
  readonly native: BackendCalendarReceipt;
}
export function calendarCurrent(check?: () => boolean) {
  try {
    return !check || check();
  } catch {
    return false;
  }
}
/** Owner and each source kind have independent host generations. Finance input
 * revisions are deliberately absent; native leases remain authoritative. */
export class CalendarSources {
  private readonly sequence = { ROWS: 0, CLOCK: 0 };
  private readonly active = new Map<"ROWS" | "CLOCK", Source>();
  private readonly tickets = new WeakMap<CalendarSourceTicket, Source>();
  private readonly receipts = new WeakMap<CalendarSourceReceipt, Receipt>();
  constructor(private readonly environment: CalendarEnvironment) {}
  async presentation(
    header: string,
    raw: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ) {
    presentationHeader(header);
    presentationBody(raw);
    const owner = this.environment.capture();
    const check = () => {
      if (!this.environment.current(owner) || !calendarCurrent(options.isCurrent))
        throw new EngineTransportError("STALE_CALENDAR_SOURCE");
    };
    check();
    await this.environment.ready(owner);
    check();
    const backend = this.environment.backend();
    if (!backend?.presentation) throw new EngineTransportError("CALENDAR_PRESENTATION_UNAVAILABLE");
    const value = await backend.presentation(header, raw);
    check();
    return value;
  }
  async begin(header: string, options: { readonly isCurrent?: () => boolean } = {}) {
    const expected = sourceExpectation(header),
      owner = this.environment.capture(),
      kind = expected.kind;
    if (!this.environment.current(owner) || !calendarCurrent(options.isCurrent))
      throw new EngineTransportError("STALE_CALENDAR_SOURCE");
    if (this.sequence[kind] >= Number.MAX_SAFE_INTEGER)
      throw new EngineTransportError("CALENDAR_SEQUENCE_EXHAUSTED");
    const sequence = ++this.sequence[kind],
      prior = this.active.get(kind);
    this.active.delete(kind);
    if (prior) {
      prior.phase = "CLOSED";
      void this.cleanup(prior);
    }
    const witness = { owner, sequence, expected, current: options.isCurrent };
    this.ensure(witness);
    await this.environment.ready(owner);
    this.ensure(witness);
    const backend = this.environment.backend();
    if (!backend) throw new EngineTransportError("CALENDAR_UNAVAILABLE");
    const native = await backend.begin(header);
    const source: Source = {
      ...witness,
      backend,
      native,
      phase: "OPEN",
      tail: Promise.resolve(),
      groups: 0,
      units: header.length,
      failed: false,
      aborted: false,
    };
    try {
      this.ensure(source);
    } catch (e) {
      await this.cleanup(source);
      throw e;
    }
    const ticket = Object.freeze({}) as CalendarSourceTicket;
    this.tickets.set(ticket, source);
    this.active.set(kind, source);
    return ticket;
  }
  source(ticket: CalendarSourceTicket, header: string, raw: string): Promise<void> {
    let s: Source;
    try {
      s = this.open(ticket);
      checkedUtf8Length(header, 8192);
      checkedRawSourceString(raw, 33554432);
      if (
        s.groups >= (s.expected.kind === "ROWS" ? 1 : 2) ||
        s.units + header.length + raw.length > 33554432
      )
        throw new EngineTransportError("CALENDAR_SOURCE_QUEUE_LIMIT");
      s.groups++;
      s.units += header.length + raw.length;
    } catch (e) {
      return Promise.reject(e);
    }
    const work = s.tail.then(async () => {
      this.ensure(s);
      if (s.failed || s.phase === "CLOSED")
        throw new EngineTransportError("CALENDAR_SOURCE_CLOSED");
      await s.backend.source(s.native, header, raw);
      this.ensure(s);
    });
    s.tail = work.catch(() => {
      s.failed = true;
    });
    return work;
  }
  async seal(ticket: CalendarSourceTicket): Promise<CalendarSourceReceipt> {
    const s = this.open(ticket);
    s.phase = "SEALING";
    await s.tail;
    this.ensure(s);
    if (s.failed) throw new EngineTransportError("CALENDAR_SOURCE_FAILED");
    try {
      const result = await s.backend.seal(s.native);
      this.ensure(s);
      s.phase = "CLOSED";
      this.active.delete(s.expected.kind);
      const receipt = Object.freeze({ reply: result.metadata }) as CalendarSourceReceipt;
      this.receipts.set(receipt, { source: s, native: result.receipt });
      return receipt;
    } catch (e) {
      s.phase = "CLOSED";
      await this.cleanup(s);
      throw e;
    }
  }
  async abort(ticket: CalendarSourceTicket) {
    const s = this.tickets.get(ticket);
    if (!s) throw new EngineTransportError("INVALID_CALENDAR_TICKET");
    s.phase = "CLOSED";
    await this.cleanup(s);
  }
  isCurrent(receipt: CalendarSourceReceipt, kind?: "ROWS" | "CLOCK"): boolean {
    const r = this.receipts.get(receipt);
    if (!r || (kind && r.source.expected.kind !== kind)) return false;
    try {
      this.ensure(r.source);
      return true;
    } catch {
      return false;
    }
  }
  async use<T>(
    receipt: CalendarSourceReceipt,
    operation: (backend: CalendarBackend, native: BackendCalendarReceipt) => Promise<T>,
  ): Promise<T> {
    const r = this.receipts.get(receipt);
    if (!r) throw new EngineTransportError("INVALID_CALENDAR_RECEIPT");
    this.ensure(r.source);
    const result = await operation(r.source.backend, r.native);
    this.ensure(r.source);
    return result;
  }
  invalidate() {
    for (const kind of ["ROWS", "CLOCK"] as const) {
      if (this.sequence[kind] < Number.MAX_SAFE_INTEGER) this.sequence[kind]++;
    }
    for (const s of this.active.values()) {
      s.phase = "CLOSED";
      void this.cleanup(s);
    }
    this.active.clear();
  }
  private open(ticket: CalendarSourceTicket) {
    const s = this.tickets.get(ticket);
    if (!s || s.phase !== "OPEN") throw new EngineTransportError("INVALID_CALENDAR_TICKET");
    this.ensure(s);
    return s;
  }
  private ensure(s: Pick<Source, "owner" | "sequence" | "expected" | "current">) {
    if (
      !this.environment.current(s.owner) ||
      s.sequence !== this.sequence[s.expected.kind] ||
      !calendarCurrent(s.current)
    )
      throw new EngineTransportError("STALE_CALENDAR_SOURCE");
  }
  private async cleanup(s: Source) {
    if (s.aborted) return;
    s.aborted = true;
    try {
      await s.backend.abort(s.native);
    } catch {
      /* An old incarnation must never reset a replacement core. */
    }
  }
}
