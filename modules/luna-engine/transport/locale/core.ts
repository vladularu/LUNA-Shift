import { LOCALE_LIMITS, type RankReply } from "./protocol";
export interface RankSession {
  id: number;
  localeKey: string;
  values: Set<string>;
  items: number;
  bytes: number;
}
export interface RankState {
  lastId: number;
  session: RankSession | null;
}
export function createRankState(): RankState {
  "worklet";
  return { lastId: 0, session: null };
}
/** This small probe may run on RN. All candidate work runs in a Worker Runtime. */
export function localeProbe(): string {
  "worklet";
  if (typeof Intl !== "object" || typeof Intl.Collator !== "function")
    throw new Error("LOCALE_UNAVAILABLE");
  const options = new Intl.Collator().resolvedOptions();
  const pairs = [
    ["", "a"],
    ["a", "A"],
    ["ä", "a"],
    ["ä", "z"],
    ["é", "e\u0301"],
    ["Å", "A\u030a"],
    ["ß", "ss"],
    ["2", "10"],
    ["a-b", "ab"],
    ["李", "猫"],
    ["🦀", "猫"],
    ["id-2", "id_2"],
    ["2026-01-01", "2026-02-01"],
  ];
  const signs = pairs.map((pair) => {
    const value = pair[0].localeCompare(pair[1]);
    return value < 0 ? -1 : value > 0 ? 1 : 0;
  });
  const signature = JSON.stringify({
    version: 1,
    locale: options.locale,
    usage: options.usage,
    sensitivity: options.sensitivity,
    ignorePunctuation: options.ignorePunctuation,
    collation: options.collation,
    numeric: options.numeric,
    caseFirst: options.caseFirst,
    signs,
  });
  if (signature.length > 4096) throw new Error("LOCALE_UNAVAILABLE");
  return signature;
}
function utf8Size(text: string, maximum: number): number {
  "worklet";
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes++;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("INVALID_COMMAND");
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error("INVALID_COMMAND");
    else bytes += 3;
    if (bytes > maximum) throw new Error("LIMIT");
  }
  return bytes;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  "worklet";
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function jsonKeyBytes(text: string): number {
  "worklet";
  let bytes = utf8Size(text, LOCALE_LIMITS.stringBytes) + 2;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit === 0x22 || unit === 0x5c) bytes++;
    else if (unit < 0x20)
      bytes += unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13 ? 1 : 5;
  }
  return bytes;
}
function id(value: unknown): value is number {
  "worklet";
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function implementation(state: RankState, input: unknown): RankReply {
  "worklet";
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("INVALID_COMMAND");
  const command = input as Record<string, unknown>;
  const kind = command.kind;
  if (kind === "RESET" && exact(command, ["kind"])) {
    state.session = null;
    return { ok: true };
  }
  if (kind === "PROBE" || kind === "BEGIN") {
    if (
      !exact(command, kind === "PROBE" ? ["kind", "probe"] : ["kind", "id", "probe"]) ||
      typeof command.probe !== "string" ||
      command.probe.length > 4096
    )
      throw new Error("INVALID_COMMAND");
    const signature = localeProbe();
    if (signature !== command.probe) throw new Error("LOCALE_MISMATCH");
    if (kind === "BEGIN") {
      if (!id(command.id) || command.id <= state.lastId) throw new Error("STALE");
      state.lastId = command.id;
      state.session = {
        id: command.id,
        localeKey: signature,
        values: new Set(),
        items: 0,
        bytes: 0,
      };
    }
    return { ok: true, localeKey: signature };
  }
  if (!id(command.id)) throw new Error("INVALID_COMMAND");
  if (kind === "CANCEL" && exact(command, ["kind", "id"])) {
    if (state.session?.id === command.id) state.session = null;
    return { ok: true };
  }
  const session = state.session;
  if (!session || session.id !== command.id) throw new Error("STALE");
  if (kind === "APPEND" && exact(command, ["kind", "id", "strings"])) {
    if (
      !Array.isArray(command.strings) ||
      command.strings.length > LOCALE_LIMITS.pageItems ||
      session.items + command.strings.length > LOCALE_LIMITS.candidates
    )
      throw new Error("LIMIT");
    let pageUnits = 0;
    for (const text of command.strings) {
      if (typeof text !== "string") throw new Error("INVALID_COMMAND");
      pageUnits += text.length;
      if (pageUnits > LOCALE_LIMITS.pageUnits || text.length > LOCALE_LIMITS.stringBytes)
        throw new Error("LIMIT");
      session.bytes += utf8Size(text, LOCALE_LIMITS.stringBytes);
      if (session.bytes > LOCALE_LIMITS.inputBytes) throw new Error("LIMIT");
      session.values.add(text);
    }
    session.items += command.strings.length;
    return { ok: true };
  }
  if (kind === "FINISH" && exact(command, ["kind", "id"])) {
    try {
      if (localeProbe() !== session.localeKey) throw new Error("LOCALE_MISMATCH");
      const ordered = Array.from(session.values).sort((left, right) => left.localeCompare(right));
      const ranks: Record<string, number> = Object.create(null);
      let rank = 0;
      let outputBytes = 2;
      for (let index = 0; index < ordered.length; index++) {
        if (index > 0 && ordered[index - 1].localeCompare(ordered[index]) !== 0) rank++;
        outputBytes +=
          jsonKeyBytes(ordered[index]) + 1 + rank.toString().length + (index > 0 ? 1 : 0);
        if (outputBytes > LOCALE_LIMITS.inputBytes) throw new Error("LIMIT");
        ranks[ordered[index]] = rank;
      }
      const json = JSON.stringify(ranks);
      utf8Size(json, LOCALE_LIMITS.inputBytes);
      return { ok: true, json, localeKey: session.localeKey };
    } finally {
      state.session = null;
    }
  }
  throw new Error("INVALID_COMMAND");
}
export function dispatchRankCommand(state: RankState, input: unknown): RankReply {
  "worklet";
  try {
    return implementation(state, input);
  } catch (error) {
    const code = error instanceof Error ? error.message : "RUNTIME_FAILURE";
    if (
      input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      (input as Record<string, unknown>).id === state.session?.id
    )
      state.session = null;
    if (
      code === "LOCALE_UNAVAILABLE" ||
      code === "LOCALE_MISMATCH" ||
      code === "INVALID_COMMAND" ||
      code === "LIMIT" ||
      code === "STALE"
    )
      return { ok: false, code };
    return { ok: false, code: "RUNTIME_FAILURE" };
  }
}
