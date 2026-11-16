import { checkedUtf8Length, EngineTransportError, type TransportReply } from "../protocol";
import type { LocaleRankPort, LocaleRankTicket } from "../locale/protocol";
import type { CalendarSourceReceipt } from "./source";
import type {
  CalendarWindowPreparation,
  CalendarWindowTicket,
  CalendarWindowPrepareOptions,
} from "./windows";
import { digest, integer, record } from "./wire";
interface Client {
  calendarWindowPrepare(
    receipt: CalendarSourceReceipt,
    header: string,
    options: CalendarWindowPrepareOptions,
  ): Promise<CalendarWindowPreparation>;
  calendarWindowCandidates(
    ticket: CalendarWindowTicket,
    after: number | null,
    limit: number,
  ): Promise<TransportReply>;
  calendarWindowFinalize(ticket: CalendarWindowTicket, ranks: string): Promise<TransportReply>;
  calendarWindowAbort(ticket: CalendarWindowTicket): Promise<void>;
}
export interface CalendarRankCache {
  get(candidateDigest: string, localeKey: string): string | undefined;
  put(candidateDigest: string, localeKey: string, originalRanks: string): void;
}
export type PreparedCalendarWindow =
  | {
      readonly state: "READY";
      readonly ticket: CalendarWindowTicket;
      readonly metadata: TransportReply;
    }
  | { readonly state: "UNAVAILABLE"; readonly metadata: TransportReply };
/** Only selected native candidates reach a dedicated platform locale worker.
 * No sorting/rank-map materialization or calendar formula runs on the UI thread. */
export async function prepareCalendarWindow(
  client: Client,
  source: CalendarSourceReceipt,
  header: string,
  ranker: () => Pick<LocaleRankPort, "begin" | "append" | "finish" | "cancel"> | undefined,
  options: {
    readonly isCurrent: () => boolean;
    readonly cache?: CalendarRankCache;
    readonly navigation?: CalendarWindowPrepareOptions["navigation"];
  },
): Promise<PreparedCalendarWindow> {
  checkedUtf8Length(header, 8192);
  const input: unknown = JSON.parse(header);
  if (!record(input) || typeof input.localeKey !== "string")
    throw new EngineTransportError("INVALID_CALENDAR_WINDOW_REQUEST");
  const locale = input.localeKey;
  const current = () => {
    let valid = false;
    try {
      valid = options.isCurrent();
    } catch {}
    if (!valid) throw new EngineTransportError("STALE_CALENDAR_WINDOW");
  };
  let ticket: CalendarWindowTicket | undefined,
    ranking: LocaleRankTicket | undefined,
    worker: ReturnType<typeof ranker>,
    complete = false;
  try {
    current();
    const prepared = await client.calendarWindowPrepare(source, header, options);
    if (prepared.state === "PREPARED") ticket = prepared.ticket;
    current();
    if (prepared.state === "UNAVAILABLE") return prepared;
    const metadata = prepared.metadata;
    if (!digest(metadata.candidateDigest) || !integer(metadata.total, 0, 100000))
      throw new EngineTransportError("INVALID_CALENDAR_WINDOW_REPLY");
    ticket = prepared.ticket;
    const cached = options.cache?.get(metadata.candidateDigest, locale);
    if (cached !== undefined) {
      const ready = await client.calendarWindowFinalize(ticket, cached);
      current();
      complete = true;
      return { state: "READY", ticket, metadata: ready };
    }
    if (metadata.total === 0) {
      // The native union is empty: no platform comparison fact is needed.
      const ready = await client.calendarWindowFinalize(ticket, "{}");
      current();
      options.cache?.put(metadata.candidateDigest, locale, "{}");
      current();
      complete = true;
      return { state: "READY", ticket, metadata: ready };
    }
    worker = ranker();
    if (!worker) throw new EngineTransportError("CALENDAR_LOCALE_UNAVAILABLE");
    ranking = await worker.begin(options);
    current();
    let after: number | null = null,
      received = 0,
      units = 0;
    do {
      const reply = await client.calendarWindowCandidates(ticket, after, 512);
      current();
      const page = reply.page;
      if (
        !record(page) ||
        page.candidateDigest !== metadata.candidateDigest ||
        page.total !== metadata.total ||
        !Array.isArray(page.candidates) ||
        page.candidates.length > 512 ||
        !page.candidates.every((v) => typeof v === "string")
      )
        throw new EngineTransportError("INVALID_CALENDAR_WINDOW_PAGE");
      const strings = page.candidates as string[];
      received += strings.length;
      for (const text of strings) units += text.length;
      if (
        received > metadata.total ||
        units > 16777216 ||
        (page.nextAfter !== null && (page.nextAfter !== received || strings.length === 0))
      )
        throw new EngineTransportError("CALENDAR_CANDIDATE_LIMIT");
      await worker.append(ranking, strings);
      current();
      after = page.nextAfter as number | null;
    } while (after !== null);
    if (received !== metadata.total) throw new EngineTransportError("INVALID_CALENDAR_WINDOW_PAGE");
    const ranks = await worker.finish(ranking);
    ranking = undefined;
    current();
    if (ranks.localeKey !== locale) throw new EngineTransportError("CALENDAR_LOCALE_MISMATCH");
    const ready = await client.calendarWindowFinalize(ticket, ranks.json);
    current();
    options.cache?.put(metadata.candidateDigest, locale, ranks.json);
    current();
    complete = true;
    return { state: "READY", ticket, metadata: ready };
  } finally {
    if (ranking) {
      try {
        worker?.cancel(ranking);
      } catch {
        /* Owner disposal already fences it. */
      }
    }
    if (ticket && !complete) await client.calendarWindowAbort(ticket).catch(() => {});
  }
}
