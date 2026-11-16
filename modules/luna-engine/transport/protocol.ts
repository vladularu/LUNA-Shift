/** Transport only. Domain validation and all arithmetic belong to the Rust core. */
export type EngineLane = "finance" | "checks";
export type EngineOperation =
  | "info"
  | "bindOwner"
  | "advanceRevision"
  | "execute"
  | "utility"
  | "snapshotBegin"
  | "snapshotSeal"
  | "snapshotAbort"
  | "snapshotCalendarCandidates"
  | "snapshotCatalogCandidates"
  | "snapshotProfileClock"
  | "financialCollationPrepare"
  | "financialCollationCandidates"
  | "financialCollationAbort"
  | "calendarBegin"
  | "calendarSeal"
  | "calendarAbort"
  | "calendarWindowPrepare"
  | "calendarWindowCandidates"
  | "calendarWindowRead"
  | "calendarWindowAbort"
  | "snapshotDigests"
  | "calendarCandidates"
  | "admitFinance"
  | "admitChecks"
  | "runFinance"
  | "runChecks"
  | "cancelJob"
  | "reset"
  | "collectRetired";

export interface EngineBackend {
  readonly forms?: () => Promise<import("./forms/protocol").FormEndpoint>;
  readonly calendar?: import("./calendar/protocol").CalendarBackend;
  readonly sources?: import("./source").SourceBackend;
  readonly financialCollation?: import("./financial/protocol").FinancialCollationBackend;
  /** The backend copies/releases native buffers; no pointer crosses this API. */
  invoke(operation: EngineOperation, json: string, lane?: EngineLane): Promise<string>;
  /** Web terminates both instances synchronously before creating replacements. */
  restart?(): void;
  /** A trapped/replaced core invalidates source registrations and all receipts. */
  onFault?(listener: () => void): () => void;
  close(): void;
}

export const TRANSPORT_LIMITS = Object.freeze({
  inputBytes: 33_554_432,
  outputBytes: 4_194_304,
  controlBytes: 1_024,
  admissionBytes: 8_192,
  pending: 32,
  utilityInputBytes: 262_144,
  utilityOutputBytes: 1_048_576,
  pumpJobs: 4,
});

export class EngineTransportError extends Error {
  constructor(
    readonly code: string,
    readonly operation?: string,
  ) {
    super(code);
    this.name = "EngineTransportError";
  }
}

/** Count strict UTF-8 without allocating another full snapshot buffer. */
export function checkedUtf8Length(value: string, maximum: number): number {
  if (typeof value !== "string" || value.length > maximum)
    throw new EngineTransportError("INPUT_LIMIT");
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new EngineTransportError("INVALID_UTF8");
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new EngineTransportError("INVALID_UTF8");
    else bytes += 3;
    if (bytes > maximum) throw new EngineTransportError("INPUT_LIMIT");
  }
  return bytes;
}

const unpairedSurrogate =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Large source bodies must not run a JS loop for each character on the UI
 * thread. This is a code-unit upper bound, not a claimed UTF-8 byte count.
 * The preparation worker/backend enforces the exact byte bound before parsing. */
export function checkedRawSourceString(value: string, maximum: number): void {
  if (typeof value !== "string" || value.length > maximum)
    throw new EngineTransportError("INPUT_LIMIT");
  const prototype = String.prototype as unknown as { isWellFormed?: (this: string) => boolean };
  if (
    typeof prototype.isWellFormed === "function"
      ? !prototype.isWellFormed.call(value)
      : unpairedSurrogate.test(value)
  )
    throw new EngineTransportError("INVALID_UTF8");
}

export type TransportReply = Readonly<Record<string, unknown>> & { readonly ok: boolean };
export function parseTransportReply(json: string): TransportReply {
  return parseBoundedTransportReply(json, TRANSPORT_LIMITS.outputBytes);
}
export function parseBoundedTransportReply(
  json: string,
  maximum: number = TRANSPORT_LIMITS.outputBytes,
): TransportReply {
  try {
    checkedUtf8Length(json, maximum);
    const reply: unknown = JSON.parse(json);
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) throw new Error();
    if (typeof (reply as Record<string, unknown>).ok !== "boolean") throw new Error();
    return reply as TransportReply;
  } catch {
    // Never include original JSON, identifiers, or native diagnostic text.
    throw new EngineTransportError("INVALID_NATIVE_REPLY");
  }
}

export function jobId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
