export type AppleRevocationStatus = "revoked" | "manual_required" | "unconfirmed";
export interface DeleteAccountDependencies {
  getUser(accessToken: string): Promise<unknown>;
  validateSession(accessToken: string): Promise<void>;
  revokeApple(code: string, expectedSubject: string): Promise<AppleRevocationStatus>;
  deleteUser(userId: string): Promise<void>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const response = (status: number, body: Record<string, unknown>) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
export function createDeleteAccountHandler(deps: DeleteAccountDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return response(405, { code: "SHARE_INVALID_ARGUMENT" });
    const auth = request.headers.get("authorization");
    const match = auth?.match(/^Bearer ([A-Za-z0-9._-]{1,8192})$/);
    if (!match) return response(401, { code: "SHARE_UNAUTHENTICATED" });
    try {
      const contentType = request.headers.get("content-type")?.split(";")[0].trim();
      if (contentType !== "application/json")
        return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      if (Number(request.headers.get("content-length") ?? 0) > 8192)
        return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 8192) return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => key !== "appleAuthorizationCode" && key !== "expectedAccountId",
        )
      )
        return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      const expectedAccountId = (body as Record<string, unknown>).expectedAccountId;
      if (typeof expectedAccountId !== "string" || !UUID.test(expectedAccountId))
        return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      const code = (body as Record<string, unknown>).appleAuthorizationCode;
      if (
        code !== undefined &&
        (typeof code !== "string" ||
          code.length < 1 ||
          code.length > 4096 ||
          /[\u0000-\u001f\u007f]/.test(code))
      )
        return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      let user: unknown;
      try {
        user = await deps.getUser(match[1]);
      } catch {
        return response(401, { code: "SHARE_UNAUTHENTICATED" });
      }
      if (
        !user ||
        typeof user !== "object" ||
        !("id" in user) ||
        typeof user.id !== "string" ||
        !UUID.test(user.id)
      )
        return response(401, { code: "SHARE_UNAUTHENTICATED" });
      // The confirmed account is an assertion only, never the privileged deletion target.
      if (user.id.toLowerCase() !== expectedAccountId.toLowerCase())
        return response(403, { code: "SHARE_ACCOUNT_MISMATCH" });
      try {
        await deps.validateSession(match[1]);
      } catch {
        return response(401, { code: "SHARE_UNAUTHENTICATED" });
      }
      const identities =
        "identities" in user && Array.isArray(user.identities) ? user.identities : [];
      const apple = identities.find(
        (identity) => identity && typeof identity === "object" && identity.provider === "apple",
      );
      let revocationStatus: "not_applicable" | AppleRevocationStatus = "not_applicable";
      if (apple) {
        revocationStatus = "manual_required";
        const subject = apple.identity_data?.sub;
        if (code !== undefined) {
          if (typeof subject !== "string" || !subject)
            return response(403, { code: "SHARE_APPLE_IDENTITY_MISMATCH" });
          try {
            revocationStatus = await deps.revokeApple(code as string, subject);
          } catch {
            return response(403, { code: "SHARE_APPLE_IDENTITY_MISMATCH" });
          }
        }
      } else if (code !== undefined) return response(400, { code: "SHARE_INVALID_ARGUMENT" });
      // Recheck the live session after a potentially slow provider exchange, before privileged deletion.
      try {
        await deps.validateSession(match[1]);
      } catch {
        return response(401, { code: "SHARE_UNAUTHENTICATED" });
      }
      try {
        await deps.deleteUser(user.id);
      } catch {
        return response(503, { code: "SHARE_DELETE_FAILED" });
      }
      return response(200, { deleted: true, revocationStatus });
    } catch {
      return response(503, { code: "SHARE_DELETE_FAILED" });
    }
  };
}
