import {
  checkedRawSourceString,
  checkedUtf8Length,
  EngineTransportError,
  parseBoundedTransportReply,
} from "../protocol";
import { FORM_RESOURCE_LIMITS as limits, type FormTransportResponse } from "./protocol";
export const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const integer = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
export const fail = (code = "INVALID_FORM_REQUEST"): never => {
  throw new EngineTransportError(code);
};
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export interface FormHeader {
  readonly wireSchemaVersion: 1;
  readonly expectedEngineVersion: string;
  readonly calculationContractVersion: "luna-engine-contract-v1";
  readonly guard: {
    readonly ownerScope: string;
    readonly ownerEpoch: number;
    readonly requestId: string;
    readonly draftRevision: number;
  };
  readonly command: Record<string, unknown> & { readonly kind: string };
}
const kinds = new Set([
  "BEGIN_PROFILE",
  "BEGIN_DAY_DETAILS",
  "DAY_DETAILS_SOURCE",
  "DAY_DETAILS_CATALOG",
  "PREPARE_DAY_DETAILS",
  "DAY_DETAILS_CANDIDATES",
  "DAY_DETAILS_CALENDAR_RANKS",
  "OPEN_DAY_DETAILS",
  "DAY_DETAILS_ROWS",
  "BEGIN_DAY_EDITOR",
  "DAY_SOURCE",
  "OPEN_DAY_EDITOR",
  "DAY_EVENT",
  "BEGIN_PAYROLL",
  "SOURCE",
  "OPEN_PROFILE",
  "PROFILE_EVENT",
  "PAYROLL_EVENT",
  "WRITE_CONTEXT",
  "TAKE_WRITE",
  "ACK_WRITE",
  "ABORT_WRITE",
  "CLOSE_BUILDER",
  "CLOSE_RESOURCE",
]);
/** Only the small header is parsed here. Native alone interprets source/event
 * schemas and forms. Private locator fields are never accepted from callers. */
export function readFormHeader(json: string): FormHeader {
  checkedUtf8Length(json, limits.headerBytes);
  try {
    const v: unknown = JSON.parse(json);
    if (!object(v) || Object.keys(v).length !== 5 || !object(v.guard) || !object(v.command))
      return fail();
    const g = v.guard,
      c = v.command;
    if (
      v.wireSchemaVersion !== 1 ||
      !text(v.expectedEngineVersion, 128) ||
      !/^luna-engine-v1:[a-f0-9]{64}$/.test(v.expectedEngineVersion) ||
      v.calculationContractVersion !== "luna-engine-contract-v1" ||
      Object.keys(g).length !== 4 ||
      !text(g.ownerScope, 96) ||
      !integer(g.ownerEpoch, 1) ||
      !text(g.requestId, 96) ||
      !integer(g.draftRevision) ||
      typeof c.kind !== "string" ||
      !kinds.has(c.kind) ||
      ["builderId", "resourceId", "resourceRevision", "writeId"].some((k) => Object.hasOwn(c, k))
    )
      return fail();
    return v as unknown as FormHeader;
  } catch {
    return fail();
  }
}
export function sameFormScope(a: FormHeader, b: FormHeader): boolean {
  return (
    a.wireSchemaVersion === b.wireSchemaVersion &&
    a.expectedEngineVersion === b.expectedEngineVersion &&
    a.calculationContractVersion === b.calculationContractVersion &&
    a.guard.ownerScope === b.guard.ownerScope &&
    a.guard.ownerEpoch === b.guard.ownerEpoch &&
    a.guard.requestId === b.guard.requestId
  );
}
export function checkFormMetadata(
  response: FormTransportResponse,
  header: FormHeader,
): Record<string, unknown> {
  if (response.planBody !== null) checkedRawSourceString(response.planBody, limits.rawBodyBytes);
  const r = parseBoundedTransportReply(response.metadataJson, limits.metadataBytes);
  if (!r.ok) return fail("FORM_RESOURCE_REJECTED");
  if (
    !object(r.guard) ||
    Object.keys(r.guard).length !== 4 ||
    Object.entries(header.guard).some(
      ([k, v]) => r.guard && (r.guard as Record<string, unknown>)[k] !== v,
    ) ||
    r.wireSchemaVersion !== header.wireSchemaVersion ||
    r.engineVersion !== header.expectedEngineVersion ||
    r.calculationContractVersion !== header.calculationContractVersion ||
    !text(r.state, 64)
  )
    return fail("INVALID_FORM_REPLY");
  if ((r.state === "WRITE_PLAN_TAKEN") !== (typeof response.planBody === "string"))
    return fail("INVALID_FORM_REPLY");
  return r;
}
