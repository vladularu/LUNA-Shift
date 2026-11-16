import {
  checkedUtf8Length,
  EngineTransportError,
  parseBoundedTransportReply,
  type TransportReply,
} from "../protocol";
import { FINANCIAL_COLLATION_LIMITS as limits, type FinancialUnavailableReason } from "./protocol";
export interface ExpectedFinancialScope {
  readonly schema: number;
  readonly engine: string;
  readonly contract: string;
  readonly scope: Record<string, unknown>;
  readonly channel: string;
  readonly revision: number;
}
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const integer = (v: unknown, min: number) => Number.isSafeInteger(v) && (v as number) >= min;
export const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
function exactKeys(v: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}
function rejected(): never {
  throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REQUEST");
}
function hasControl(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}
/** Only bounded request/identity metadata is interpreted on the host. */
export function expectedFinancialScope(json: string): ExpectedFinancialScope {
  checkedUtf8Length(json, limits.prepareBytes);
  try {
    const v: unknown = JSON.parse(json);
    if (
      !record(v) ||
      !exactKeys(v, [
        "wireSchemaVersion",
        "expectedEngineVersion",
        "calculationContractVersion",
        "guard",
        "intent",
        "localeKey",
      ])
    )
      return rejected();
    const g = v.guard,
      i = v.intent;
    if (
      v.wireSchemaVersion !== 1 ||
      !text(v.expectedEngineVersion, 128) ||
      v.calculationContractVersion !== "luna-engine-contract-v1" ||
      !text(v.localeKey, 512) ||
      hasControl(v.localeKey) ||
      !record(g) ||
      !exactKeys(g, ["ownerScope", "ownerEpoch", "requestId", "draftRevision", "snapshot"]) ||
      !text(g.ownerScope, 96) ||
      !integer(g.ownerEpoch, 1) ||
      !text(g.requestId, 96) ||
      !integer(g.draftRevision, 0) ||
      !record(g.snapshot) ||
      !record(i) ||
      !exactKeys(i, ["month", "perspective", "filter", "includeSpecialDutyPay"])
    )
      return rejected();
    const s = g.snapshot;
    if (
      !exactKeys(s, [
        "ownerScope",
        "ownerEpoch",
        "snapshotId",
        "snapshotRevision",
        "inputDigest",
        "catalogDigest",
      ]) ||
      s.ownerScope !== g.ownerScope ||
      s.ownerEpoch !== g.ownerEpoch ||
      !text(s.snapshotId, 96) ||
      !integer(s.snapshotRevision, 0) ||
      !digest(s.inputDigest) ||
      !digest(s.catalogDigest) ||
      typeof i.month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month) ||
      !["EARNED", "PAYOUT"].includes(i.perspective as string) ||
      (i.filter !== null && !(typeof i.filter === "string" && i.filter.length <= 128)) ||
      typeof i.includeSpecialDutyPay !== "boolean"
    )
      return rejected();
    checkedUtf8Length(v.localeKey, 512);
    if (typeof i.filter === "string") checkedUtf8Length(i.filter, 128);
    return {
      schema: 1,
      engine: v.expectedEngineVersion,
      contract: v.calculationContractVersion,
      scope: { guard: g, intent: i, localeKey: v.localeKey },
      channel: g.requestId,
      revision: g.draftRevision as number,
    };
  } catch (error) {
    if (error instanceof EngineTransportError) throw error;
    return rejected();
  }
}
function same(actual: unknown, expected: Record<string, unknown>): boolean {
  return (
    record(actual) &&
    exactKeys(actual, Object.keys(expected)) &&
    Object.keys(expected).every((key) =>
      record(expected[key]) ? same(actual[key], expected[key]) : actual[key] === expected[key],
    )
  );
}
export function checkFinancialMetadata(
  value: TransportReply,
  expected: ExpectedFinancialScope,
): void {
  if (
    !value.ok ||
    value.wireSchemaVersion !== expected.schema ||
    value.engineVersion !== expected.engine ||
    value.calculationContractVersion !== expected.contract ||
    !same(value.scope, expected.scope)
  )
    throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
}
export function parseFinancialReply(raw: string, expected: ExpectedFinancialScope): TransportReply {
  const value = parseBoundedTransportReply(raw, limits.pageBytes);
  checkFinancialMetadata(value, expected);
  return value;
}
export function financialReason(value: unknown): FinancialUnavailableReason {
  if (
    !record(value) ||
    !text(value.code, 96) ||
    Object.keys(value).some((k) => !["code", "source", "catalog"].includes(k)) ||
    ("source" in value && !text(value.source, 96)) ||
    ("catalog" in value && !text(value.catalog, 96))
  )
    throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
  return value as unknown as FinancialUnavailableReason;
}
export function preparedMetadata(value: TransportReply): {
  candidateDigest: string;
  total: number;
  cachedVerifiedRanks: boolean;
} {
  if (
    value.state !== "FINANCIAL_COLLATION_PREPARED" ||
    !digest(value.candidateDigest) ||
    !integer(value.total, 0) ||
    (value.total as number) > limits.candidates ||
    typeof value.cachedVerifiedRanks !== "boolean"
  )
    throw new EngineTransportError("INVALID_FINANCIAL_COLLATION_REPLY");
  return {
    candidateDigest: value.candidateDigest,
    total: value.total as number,
    cachedVerifiedRanks: value.cachedVerifiedRanks,
  };
}
