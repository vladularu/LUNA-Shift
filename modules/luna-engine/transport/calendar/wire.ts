import {
  checkedUtf8Length,
  EngineTransportError,
  parseBoundedTransportReply,
  type TransportReply,
} from "../protocol";
import { captureCalendarEntryDisplay } from "./display";
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
export const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function invalid(): never {
  throw new EngineTransportError("INVALID_CALENDAR_TRANSPORT");
}
function text(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
function keys(v: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(v).length === expected.length && expected.every((k) => Object.hasOwn(v, k));
}
function parse(raw: string, max = 8192): Record<string, unknown> {
  checkedUtf8Length(raw, max);
  try {
    const v: unknown = JSON.parse(raw);
    return record(v) ? v : invalid();
  } catch {
    return invalid();
  }
}
export interface ExpectedCalendarSource {
  readonly engine: string;
  readonly owner: string;
  readonly epoch: number;
  readonly revision: number;
  readonly kind: "ROWS" | "CLOCK";
}
export function sourceExpectation(raw: string): ExpectedCalendarSource {
  const v = parse(raw);
  if (
    !keys(v, [
      "wireSchemaVersion",
      "expectedEngineVersion",
      "calculationContractVersion",
      "ownerScope",
      "ownerEpoch",
      "sourceRevision",
      "intent",
    ]) ||
    v.wireSchemaVersion !== 1 ||
    !text(v.expectedEngineVersion, 128) ||
    v.calculationContractVersion !== "luna-engine-contract-v1" ||
    !text(v.ownerScope, 96) ||
    !integer(v.ownerEpoch, 1) ||
    !integer(v.sourceRevision) ||
    !record(v.intent)
  )
    return invalid();
  const intent = v.intent;
  if (
    (intent.kind === "ROWS" && !keys(intent, ["kind"])) ||
    (intent.kind === "CLOCK" &&
      (!keys(intent, ["kind", "observedEpochMilliseconds"]) ||
        !integer(intent.observedEpochMilliseconds, -8640000000000000, 8640000000000000))) ||
    (intent.kind !== "ROWS" && intent.kind !== "CLOCK")
  )
    return invalid();
  return {
    engine: v.expectedEngineVersion,
    owner: v.ownerScope,
    epoch: v.ownerEpoch,
    revision: v.sourceRevision,
    kind: intent.kind,
  };
}
export function reply(raw: string, engine: string, max = 8192): TransportReply {
  const v = parseBoundedTransportReply(raw, max);
  if (
    !v.ok ||
    v.wireSchemaVersion !== 1 ||
    v.engineVersion !== engine ||
    v.calculationContractVersion !== "luna-engine-contract-v1"
  )
    return invalid();
  return v;
}
export function sourceIdentity(
  v: TransportReply,
  expected: ExpectedCalendarSource,
): Record<string, unknown> {
  const i = v.identity,
    rows = expected.kind === "ROWS",
    field = rows ? "sourceDigest" : "sourceClockKey";
  if (
    v.state !== (rows ? "CALENDAR_ROWS_REGISTERED" : "CALENDAR_CLOCK_REGISTERED") ||
    !record(i) ||
    !keys(i, ["kind", "ownerScope", "ownerEpoch", "sourceRevision", field]) ||
    i.kind !== (rows ? "CALENDAR_ROWS" : "CALENDAR_CLOCK") ||
    i.ownerScope !== expected.owner ||
    i.ownerEpoch !== expected.epoch ||
    i.sourceRevision !== expected.revision ||
    !digest(i[field])
  )
    return invalid();
  if (
    rows &&
    (!record(v.availability) || !["READY", "UNAVAILABLE"].includes(v.availability.state as string))
  )
    return invalid();
  if (!rows && !record(v.clock)) return invalid();
  return Object.freeze({ ...i });
}
/** Small metadata framing preserves duplicate/escaped keys for native rejection. */
export function groupFrame(raw: string, id: number): string {
  const v = parse(raw);
  if (!keys(v, ["group"]) || !record(v.group)) return invalid();
  const frame = `{"builderId":${id},${raw.slice(raw.indexOf("{") + 1, raw.lastIndexOf("}"))}}`;
  checkedUtf8Length(frame, 8192);
  return frame;
}
export function windowFrame(
  raw: string,
  source: Record<string, unknown>,
  expected: ExpectedCalendarSource,
  navigation?: { readonly identity: Record<string, unknown>; readonly header: string },
) {
  const v = parse(raw),
    g = v.guard;
  if (
    !keys(v, [
      "wireSchemaVersion",
      "expectedEngineVersion",
      "calculationContractVersion",
      "guard",
      "spec",
      "options",
      "localeKey",
    ]) ||
    v.wireSchemaVersion !== 1 ||
    v.expectedEngineVersion !== expected.engine ||
    v.calculationContractVersion !== "luna-engine-contract-v1" ||
    !record(g) ||
    !keys(g, ["ownerScope", "ownerEpoch", "requestId", "draftRevision"]) ||
    g.ownerScope !== expected.owner ||
    g.ownerEpoch !== expected.epoch ||
    !text(g.requestId, 96) ||
    !integer(g.draftRevision) ||
    !record(v.spec) ||
    !record(v.options) ||
    !text(v.localeKey, 512)
  )
    return invalid();
  checkedUtf8Length(v.localeKey, 512);
  let presentation: Record<string, unknown> | undefined;
  if (navigation) {
    const p = parse(navigation.header);
    const entries = Object.hasOwn(p, "entries")
      ? captureCalendarEntryDisplay(p.entries)
      : undefined;
    if (
      !keys(p, [
        "observedEpochMilliseconds",
        "anchorMonth",
        "selectedDate",
        "before",
        "after",
        ...(entries ? ["entries"] : []),
      ]) ||
      !integer(p.observedEpochMilliseconds, -8640000000000000, 8640000000000000) ||
      !text(p.anchorMonth, 7) ||
      (p.selectedDate !== null && !text(p.selectedDate, 10)) ||
      !integer(p.before, 0, 127) ||
      !integer(p.after, 0, 127)
    )
      return invalid();
    presentation = { clockIdentity: navigation.identity, ...p };
  }
  const selector = { kind: "CALENDAR_ONLY", identity: source };
  const extra = navigation
    ? `"presentation":{"clockIdentity":${JSON.stringify(navigation.identity)},${navigation.header.slice(navigation.header.indexOf("{") + 1, navigation.header.lastIndexOf("}"))}},`
    : "";
  const header = `{"source":${JSON.stringify(selector)},${extra}${raw.slice(raw.indexOf("{") + 1, raw.lastIndexOf("}"))}}`;
  checkedUtf8Length(header, 8192);
  return {
    header,
    scope: {
      guard: g,
      source: selector,
      spec: v.spec,
      options: v.options,
      localeKey: v.localeKey,
      ...(presentation ? { presentation } : {}),
    },
  };
}
/** Equality only for bounded wire metadata, never source rows or domain values. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return (
    record(a) &&
    record(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
  );
}
export function pageCursor(after: number | null, limit: number) {
  if ((after !== null && !integer(after, 0, 100000)) || !integer(limit, 1, 1024)) return invalid();
}
