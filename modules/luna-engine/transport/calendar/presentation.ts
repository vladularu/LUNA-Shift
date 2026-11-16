import { checkedUtf8Length, checkedRawSourceString, type TransportReply } from "../protocol";
import { integer, invalid, record, reply, same } from "./wire";
const commands = new Set([
  "STORED_ROWS",
  "BACKUP_BUSINESS_PREFERENCES",
  "TARGET_SETTINGS",
  "WIDGET_CLOCK",
  "WIDGET_TIMELINE",
  "WIDGET_CANDIDATES",
  "INCOMING_DAYS",
  "COMBINED_PREVIEW",
  "MONTH_PRESENTATION",
  "SHARED_ENTRY_DETAIL",
  "SHARING_CANDIDATES",
  "SHARING_PROJECT",
  "SALARY_PAYMENT_TIMING",
  "DAY_DETAILS_CANDIDATES",
  "DAY_DETAILS",
  "CATALOG_CANDIDATES",
  "HIGHLIGHTS",
  "PROFILE_REPOSITORY_WRITE",
  "PROFILE_ROLE_QUERY",
  "EXPORT_CANDIDATES",
  "CHECKS_MODELS",
]);
export function presentationHeader(raw: string) {
  checkedUtf8Length(raw, 8192);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (
    !record(input) ||
    Object.keys(input).length !== 6 ||
    input.kind !== "PRESENTATION" ||
    input.wireSchemaVersion !== 1 ||
    typeof input.expectedEngineVersion !== "string" ||
    input.calculationContractVersion !== "luna-engine-contract-v1" ||
    !record(input.guard) ||
    !record(input.command) ||
    Object.keys(input.command).length !== 1 ||
    typeof input.command.kind !== "string" ||
    !commands.has(input.command.kind)
  )
    return invalid();
  const guard = input.guard;
  if (
    Object.keys(guard).length !== 4 ||
    typeof guard.ownerScope !== "string" ||
    !guard.ownerScope ||
    guard.ownerScope.length > 96 ||
    !integer(guard.ownerEpoch, 1) ||
    typeof guard.requestId !== "string" ||
    !guard.requestId ||
    guard.requestId.length > 96 ||
    !integer(guard.draftRevision)
  )
    return invalid();
  return { engine: input.expectedEngineVersion, guard, command: input.command.kind };
}
export function presentationReply(
  raw: string,
  expected: ReturnType<typeof presentationHeader>,
): TransportReply {
  const result = reply(raw, expected.engine, 33_554_432);
  if (
    result.state !== "CALENDAR_PRESENTED" ||
    result.command !== expected.command ||
    !same(result.guard, expected.guard) ||
    !Object.hasOwn(result, "value")
  )
    return invalid();
  return result;
}
export function presentationBody(raw: string) {
  checkedRawSourceString(raw, 33_554_432);
}
