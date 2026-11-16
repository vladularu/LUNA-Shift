/** Locale facts only. No pay, time or compliance calculation belongs here. */
export const LOCALE_LIMITS = Object.freeze({
  candidates: 100_000,
  pageItems: 1024,
  pageUnits: 2_097_152,
  inputBytes: 33_554_432,
  stringBytes: 300_000,
  pending: 128,
});
export type RankerCode =
  | "LOCALE_UNAVAILABLE"
  | "LOCALE_MISMATCH"
  | "INVALID_COMMAND"
  | "LIMIT"
  | "STALE"
  | "CANCELED"
  | "CLOSED"
  | "OWNER_REQUIRED"
  | "RUNTIME_FAILURE";
export class LocaleRankerError extends Error {
  constructor(readonly code: RankerCode) {
    super(code);
    this.name = "LocaleRankerError";
  }
}
export type RankCommand =
  | { kind: "PROBE"; probe: string }
  | { kind: "BEGIN"; id: number; probe: string }
  | { kind: "APPEND"; id: number; strings: readonly string[] }
  | { kind: "FINISH"; id: number }
  | { kind: "CANCEL"; id: number }
  | { kind: "RESET" };
export type RankReply =
  { ok: true; localeKey?: string; json?: string } | { ok: false; code: RankerCode };
declare const backendTicket: unique symbol;
declare const rankTicket: unique symbol;
export interface BackendRankTicket {
  readonly [backendTicket]: true;
}
export interface LocaleRankTicket {
  readonly [rankTicket]: true;
}
export interface LocaleRankReceipt {
  readonly json: string;
  readonly localeKey: string;
}
export interface LocaleRankPort {
  bindOwner(ownerDatasetKey: string): void;
  probe(): Promise<{ readonly localeKey: string }>;
  begin(options?: { readonly isCurrent?: () => boolean }): Promise<LocaleRankTicket>;
  append(ticket: LocaleRankTicket, strings: readonly string[]): Promise<void>;
  finish(ticket: LocaleRankTicket): Promise<LocaleRankReceipt>;
  cancel(ticket: LocaleRankTicket): void;
  close(): void;
}
export interface LocaleBackend {
  probe(signature: string): Promise<string>;
  begin(signature: string): Promise<BackendRankTicket>;
  append(ticket: BackendRankTicket, strings: readonly string[]): Promise<void>;
  finish(ticket: BackendRankTicket): Promise<LocaleRankReceipt>;
  cancel(ticket: BackendRankTicket): Promise<void>;
  reset(): Promise<void>;
  onFault?(listener: () => void): () => void;
  close(): void;
}
export function requireRankReply(value: unknown): Extract<RankReply, { ok: true }> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 3)
    throw new LocaleRankerError("RUNTIME_FAILURE");
  const reply = value as Record<string, unknown>;
  if (reply.ok === true) return reply as Extract<RankReply, { ok: true }>;
  const code = reply.code;
  if (
    code === "LOCALE_UNAVAILABLE" ||
    code === "LOCALE_MISMATCH" ||
    code === "INVALID_COMMAND" ||
    code === "LIMIT" ||
    code === "STALE" ||
    code === "CANCELED" ||
    code === "CLOSED" ||
    code === "OWNER_REQUIRED"
  )
    throw new LocaleRankerError(code);
  throw new LocaleRankerError("RUNTIME_FAILURE");
}
