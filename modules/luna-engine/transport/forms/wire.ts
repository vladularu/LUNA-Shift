import { checkedUtf8Length, EngineTransportError, parseBoundedTransportReply } from "../protocol";
import { FORM_RESOURCE_LIMITS as limits, type FormTransportResponse } from "./protocol";

/** Worker-only transport projection, with no interpretation of plan JSON.
 * The main host must receive the small metadata and original plan separately. */
export function splitNativeFormReply(raw: string): FormTransportResponse {
  try {
    const frame = parseBoundedTransportReply(raw, limits.replyBytes);
    if (frame.ok && (typeof frame.state !== "string" || !frame.state || frame.state.length > 64))
      throw new Error();
    const taken = frame.ok && frame.state === "WRITE_PLAN_TAKEN";
    let planBody: string | null = null;
    const metadata: Record<string, unknown> = { ...frame };
    if (Object.hasOwn(frame, "planBody")) {
      if (!taken || typeof frame.planBody !== "string") throw new Error();
      checkedUtf8Length(frame.planBody, limits.rawBodyBytes);
      planBody = frame.planBody;
      delete metadata.planBody;
    } else if (taken) throw new Error();
    const metadataJson = JSON.stringify(metadata);
    checkedUtf8Length(metadataJson, limits.metadataBytes);
    return { metadataJson, planBody };
  } catch {
    throw new EngineTransportError("INVALID_FORM_REPLY");
  }
}
