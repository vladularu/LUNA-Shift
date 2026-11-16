import { checkedRawSourceString, EngineTransportError, type TransportReply } from "../protocol";
import type {
  BackendCalendarReceipt,
  BackendCalendarTicket,
  BackendCalendarWindow,
  CalendarBackend,
  CalendarEndpoint,
  CalendarPageView,
} from "./protocol";
import {
  digest,
  groupFrame,
  integer,
  invalid,
  pageCursor,
  record,
  reply,
  same,
  sourceExpectation,
  sourceIdentity,
  windowFrame,
  type ExpectedCalendarSource,
} from "./wire";
import { presentationBody, presentationHeader, presentationReply } from "./presentation";
interface Source {
  readonly endpoint: CalendarEndpoint;
  readonly expected: ExpectedCalendarSource;
  readonly id: number;
  closed: boolean;
}
interface Receipt {
  readonly source: Source;
  readonly identity: Record<string, unknown>;
}
interface Window {
  readonly source: Source;
  readonly id: number;
  readonly scope: Record<string, unknown>;
  readonly digest: string;
  readonly total: number;
  phase: "OPEN" | "READY" | "CLOSED";
}
/** Private native locators are tied to a backend incarnation, never a reusable number. */
export class CalendarResourceBackend implements CalendarBackend {
  private readonly sources = new WeakMap<BackendCalendarTicket, Source>();
  private readonly receipts = new WeakMap<BackendCalendarReceipt, Receipt>();
  private readonly windows = new WeakMap<BackendCalendarWindow, Window>();
  constructor(private readonly endpoint: () => Promise<CalendarEndpoint>) {}
  async presentation(header: string, raw: string) {
    const expected = presentationHeader(header);
    presentationBody(raw);
    const endpoint = await this.endpoint();
    this.current(endpoint);
    const value = presentationReply(await endpoint.source(header, raw), expected);
    this.current(endpoint);
    return value;
  }
  async begin(header: string) {
    const expected = sourceExpectation(header),
      endpoint = await this.endpoint();
    this.current(endpoint);
    const v = reply(await endpoint.invoke("calendarBegin", header), expected.engine);
    this.current(endpoint);
    if (v.state !== "CALENDAR_BUILDING" || !integer(v.builderId, 1)) return invalid();
    const ticket = Object.freeze({}) as BackendCalendarTicket;
    this.sources.set(ticket, { endpoint, expected, id: v.builderId, closed: false });
    return ticket;
  }
  async source(ticket: BackendCalendarTicket, header: string, raw: string) {
    const s = this.openSource(ticket),
      frame = groupFrame(header, s.id);
    checkedRawSourceString(raw, 33554432);
    const v = reply(await s.endpoint.source(frame, raw), s.expected.engine);
    this.openSource(ticket);
    if (v.state !== "CALENDAR_SOURCE_ADDED" || v.builderId !== s.id) return invalid();
  }
  async seal(ticket: BackendCalendarTicket) {
    const s = this.openSource(ticket);
    const v = reply(
      await s.endpoint.invoke("calendarSeal", JSON.stringify({ builderId: s.id })),
      s.expected.engine,
    );
    this.current(s.endpoint);
    const identity = sourceIdentity(v, s.expected),
      receipt = Object.freeze({}) as BackendCalendarReceipt;
    s.closed = true;
    this.receipts.set(receipt, { source: s, identity });
    return { receipt, metadata: v };
  }
  async abort(ticket: BackendCalendarTicket) {
    const s = this.sources.get(ticket);
    if (!s) return invalid();
    if (s.closed) return;
    s.closed = true;
    if (!s.endpoint.current()) return;
    const v = reply(
      await s.endpoint.invoke("calendarAbort", JSON.stringify({ builderId: s.id })),
      s.expected.engine,
    );
    this.current(s.endpoint);
    if (v.state !== "CALENDAR_ABORTED") return invalid();
    void s.endpoint.invoke("collectRetired", "").catch(() => {});
  }
  async prepare(
    receipt: BackendCalendarReceipt,
    header: string,
    navigation?: import("./protocol").BackendCalendarNavigation,
  ) {
    const r = this.receipts.get(receipt);
    if (!r || r.source.expected.kind !== "ROWS") return invalid();
    this.current(r.source.endpoint);
    const clock = navigation ? this.receipts.get(navigation.clock) : undefined;
    if (
      navigation &&
      (!clock ||
        clock.source.expected.kind !== "CLOCK" ||
        (clock.source.endpoint.incarnation ?? clock.source.endpoint) !==
          (r.source.endpoint.incarnation ?? r.source.endpoint) ||
        clock.source.expected.owner !== r.source.expected.owner ||
        clock.source.expected.epoch !== r.source.expected.epoch ||
        clock.source.expected.engine !== r.source.expected.engine)
    )
      return invalid();
    if (clock) this.current(clock.source.endpoint);
    const frame = windowFrame(
        header,
        r.identity,
        r.source.expected,
        navigation && clock ? { identity: clock.identity, header: navigation.header } : undefined,
      ),
      v = reply(
        await r.source.endpoint.invoke("calendarWindowPrepare", frame.header),
        r.source.expected.engine,
        1048576,
      );
    this.current(r.source.endpoint);
    if (!same(v.scope, frame.scope)) return invalid();
    if (v.state === "CALENDAR_WINDOW_UNAVAILABLE") {
      if (!record(v.reason)) return invalid();
      return { metadata: v };
    }
    if (
      v.state !== "CALENDAR_WINDOW_PREPARED" ||
      !integer(v.resourceId, 1) ||
      !digest(v.candidateDigest) ||
      !integer(v.total, 0, 100000)
    )
      return invalid();
    const ticket = Object.freeze({}) as BackendCalendarWindow;
    this.windows.set(ticket, {
      source: r.source,
      id: v.resourceId,
      scope: frame.scope,
      digest: v.candidateDigest,
      total: v.total,
      phase: "OPEN",
    });
    return { ticket, metadata: v };
  }
  async candidates(ticket: BackendCalendarWindow, after: number | null, limit: number) {
    const s = this.window(ticket);
    if (s.phase !== "OPEN") return invalid();
    pageCursor(after, limit);
    const v = this.windowReply(
      s,
      await s.source.endpoint.invoke(
        "calendarWindowCandidates",
        JSON.stringify({ resourceId: s.id, candidateDigest: s.digest, after, limit }),
      ),
    );
    this.window(ticket);
    if (
      v.state !== "CALENDAR_WINDOW_CANDIDATES" ||
      !record(v.page) ||
      v.page.total !== s.total ||
      v.page.candidateDigest !== s.digest ||
      !Array.isArray(v.page.candidates) ||
      v.page.candidates.length > limit ||
      !v.page.candidates.every((x) => typeof x === "string")
    )
      return invalid();
    this.cursor(v.page, after, limit, v.page.candidates.length);
    return v;
  }
  async finalize(ticket: BackendCalendarWindow, ranks: string) {
    const s = this.window(ticket);
    if (s.phase !== "OPEN") return invalid();
    checkedRawSourceString(ranks, 33554432);
    const v = this.windowReply(
      s,
      await s.source.endpoint.finalize(
        JSON.stringify({ resourceId: s.id, candidateDigest: s.digest }),
        ranks,
      ),
    );
    this.window(ticket);
    if (v.state !== "CALENDAR_WINDOW_READY") return invalid();
    s.phase = "READY";
    return v;
  }
  async read(
    ticket: BackendCalendarWindow,
    view: CalendarPageView,
    after: number | null,
    limit: number,
  ) {
    const s = this.window(ticket);
    if (
      s.phase !== "READY" ||
      ![
        "EXPANDED",
        "VISIBLE",
        "VISIBLE_INDICES",
        "DATES",
        "MONTHS",
        "NAVIGATION",
        "ENTRY_PRESENTATIONS",
        "DATE_PREVIEWS",
      ].includes(view)
    )
      return invalid();
    pageCursor(after, limit);
    const v = this.windowReply(
      s,
      await s.source.endpoint.invoke(
        "calendarWindowRead",
        JSON.stringify({ resourceId: s.id, view, after, limit }),
      ),
    );
    this.window(ticket);
    if (
      v.state !== "CALENDAR_WINDOW_PAGE" ||
      v.view !== view ||
      !record(v.page) ||
      !Array.isArray(v.page.items) ||
      v.page.items.length > limit
    )
      return invalid();
    this.cursor(v.page, after, limit, v.page.items.length);
    return v;
  }
  async abortWindow(ticket: BackendCalendarWindow) {
    const s = this.windows.get(ticket);
    if (!s) return invalid();
    if (s.phase === "CLOSED") return;
    s.phase = "CLOSED";
    if (!s.source.endpoint.current()) return;
    const v = reply(
      await s.source.endpoint.invoke("calendarWindowAbort", JSON.stringify({ resourceId: s.id })),
      s.source.expected.engine,
    );
    this.current(s.source.endpoint);
    if (v.state !== "CALENDAR_WINDOW_ABORTED") return invalid();
    void s.source.endpoint.invoke("collectRetired", "").catch(() => {});
  }
  private cursor(p: Record<string, unknown>, after: number | null, _limit: number, count: number) {
    const start = after ?? 0,
      end = start + count;
    if (
      !integer(p.total, 0, 100000) ||
      start > p.total ||
      end > p.total ||
      (p.nextAfter === null
        ? end !== p.total
        : p.nextAfter !== end || end >= p.total || count === 0)
    )
      return invalid();
  }
  private windowReply(s: Window, raw: string): TransportReply {
    this.current(s.source.endpoint);
    const v = reply(raw, s.source.expected.engine, 1048576);
    if (v.resourceId !== s.id || !same(v.scope, s.scope)) return invalid();
    return v;
  }
  private current(endpoint: CalendarEndpoint) {
    if (!endpoint.current()) throw new EngineTransportError("STALE_CALENDAR_BACKEND");
  }
  private openSource(ticket: BackendCalendarTicket) {
    const s = this.sources.get(ticket);
    if (!s || s.closed) return invalid();
    this.current(s.endpoint);
    return s;
  }
  private window(ticket: BackendCalendarWindow) {
    const s = this.windows.get(ticket);
    if (!s || s.phase === "CLOSED") return invalid();
    this.current(s.source.endpoint);
    return s;
  }
}
