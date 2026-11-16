import { checkedUtf8Length, EngineTransportError, jobId, parseTransportReply } from "./protocol";

export function sourceFrame(headerJson: string, builderId: number): string {
  checkedUtf8Length(headerJson, 128 * 1024);
  if (!jobId(builderId)) throw new EngineTransportError("INVALID_SOURCE_HEADER");
  let group: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(headerJson);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    group = value as Record<string, unknown>;
    if (
      Object.keys(group).some((key) => key !== "target" && key !== "group") ||
      (group.target !== "SOURCE" && group.target !== "CATALOG") ||
      !group.group ||
      typeof group.group !== "object" ||
      Array.isArray(group.group)
    )
      throw new Error();
  } catch {
    throw new EngineTransportError("INVALID_SOURCE_HEADER");
  }
  // Preserve original metadata too: parse/stringify would erase duplicate or
  // escaped duplicate keys before Rust's strict bounded parser can reject them.
  const frame = `{"builderId":${builderId},${headerJson.slice(headerJson.indexOf("{") + 1, headerJson.lastIndexOf("}"))}}`;
  checkedUtf8Length(frame, 128 * 1024);
  return frame;
}
export function sourceBuilderId(json: string): number {
  const reply = parseTransportReply(json);
  if (!reply.ok || reply.state !== "BUILDING" || !jobId(reply.builderId))
    throw new EngineTransportError("SOURCE_BEGIN_REJECTED");
  return reply.builderId;
}
