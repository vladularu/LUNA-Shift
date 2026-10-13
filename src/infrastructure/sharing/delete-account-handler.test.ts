import { describe, expect, it, vi } from "vitest";
import {
  createDeleteAccountHandler,
  type DeleteAccountDependencies,
} from "../../../supabase/functions/sharing-delete-account/handler";
const ID = "11111111-1111-4111-8111-111111111111";
const appleUser = {
  id: ID,
  identities: [{ provider: "apple", identity_data: { sub: "apple-subject" } }],
};
function fixture(user: unknown = appleUser) {
  const getUser = vi.fn().mockResolvedValue(user);
  const validateSession = vi.fn().mockResolvedValue(undefined);
  const revokeApple = vi.fn().mockResolvedValue("revoked");
  const deleteUser = vi.fn().mockResolvedValue(undefined);
  const deps = { getUser, validateSession, revokeApple, deleteUser } as DeleteAccountDependencies;
  return {
    getUser,
    validateSession,
    revokeApple,
    deleteUser,
    handler: createDeleteAccountHandler(deps),
  };
}
const request = (body: unknown = {}, token: string | null = "session") =>
  new Request("https://example.supabase.co/functions/v1/sharing-delete-account", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ expectedAccountId: ID, ...(body as Record<string, unknown>) }),
  });
describe("authenticated self deletion handler", () => {
  it("rejects missing/expired users and other-user parameters without administrative deletion", async () => {
    const f = fixture();
    expect((await f.handler(request({}, null))).status).toBe(401);
    expect(f.getUser).not.toHaveBeenCalled();
    const expired = fixture(null);
    expect((await expired.handler(request())).status).toBe(401);
    expect(expired.deleteUser).not.toHaveBeenCalled();
    expect((await f.handler(request({ userId: "other" }))).status).toBe(400);
    expect(f.deleteUser).not.toHaveBeenCalled();
  });
  it("verifies/revokes Apple first then deletes only authenticated caller", async () => {
    const f = fixture();
    const response = await f.handler(request({ appleAuthorizationCode: "fresh-code" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, revocationStatus: "revoked" });
    expect(f.revokeApple).toHaveBeenCalledWith("fresh-code", "apple-subject");
    expect(f.deleteUser).toHaveBeenCalledWith(ID);
    expect(f.revokeApple.mock.invocationCallOrder[0]).toBeLessThan(
      f.deleteUser.mock.invocationCallOrder[0],
    );
  });
  it("still fulfils authenticated deletion when Apple grant/code is no longer available", async () => {
    const f = fixture();
    expect(await (await f.handler(request())).json()).toEqual({
      deleted: true,
      revocationStatus: "manual_required",
    });
    expect(f.revokeApple).not.toHaveBeenCalled();
    expect(f.deleteUser).toHaveBeenCalledWith(ID);
  });
  it("provider outage reports manual revocation without trapping self deletion", async () => {
    const f = fixture();
    f.revokeApple.mockResolvedValue("manual_required");
    expect(
      await (await f.handler(request({ appleAuthorizationCode: "fresh-code" }))).json(),
    ).toEqual({ deleted: true, revocationStatus: "manual_required" });
    expect(f.deleteUser).toHaveBeenCalledWith(ID);
  });
  it("signed subject mismatch rejects both revocation and deletion", async () => {
    const f = fixture();
    f.revokeApple.mockRejectedValue(new Error("SHARE_APPLE_IDENTITY_MISMATCH"));
    const response = await f.handler(request({ appleAuthorizationCode: "another-code" }));
    expect(response.status).toBe(403);
    expect(f.deleteUser).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("another-code");
  });
  it("generic user deletes without Apple and method/body/oversize validation is strict", async () => {
    const f = fixture({
      id: ID,
      identities: [{ provider: "google", identity_data: { sub: "google" } }],
    });
    expect(await (await f.handler(request())).json()).toEqual({
      deleted: true,
      revocationStatus: "not_applicable",
    });
    expect(f.revokeApple).not.toHaveBeenCalled();
    expect(
      (await f.handler(new Request("https://example.invalid", { method: "GET" }))).status,
    ).toBe(405);
    expect((await f.handler(request({ appleAuthorizationCode: "x".repeat(4097) }))).status).toBe(
      400,
    );
  });
  it("server and admin failures expose only stable sanitized codes", async () => {
    const f = fixture();
    f.deleteUser.mockRejectedValue(new Error("service-role secret Bearer token"));
    const response = await f.handler(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});

it("revoked current session is denied even if getUser accepts the unexpired JWT", async () => {
  const f = fixture();
  f.validateSession.mockRejectedValue(new Error("SHARE_UNAUTHENTICATED"));
  expect((await f.handler(request({ appleAuthorizationCode: "code" }))).status).toBe(401);
  expect(f.revokeApple).not.toHaveBeenCalled();
  expect(f.deleteUser).not.toHaveBeenCalled();
});
it("session revoked during Apple exchange is denied before administrative deletion", async () => {
  const f = fixture();
  f.validateSession.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
  expect((await f.handler(request({ appleAuthorizationCode: "code" }))).status).toBe(401);
  expect(f.revokeApple).toHaveBeenCalledTimes(1);
  expect(f.deleteUser).not.toHaveBeenCalled();
});

it("outage success reports unconfirmed instead of claiming Apple revocation", async () => {
  const f = fixture();
  f.revokeApple.mockResolvedValue("unconfirmed");
  expect(await (await f.handler(request({ appleAuthorizationCode: "code" }))).json()).toEqual({
    deleted: true,
    revocationStatus: "unconfirmed",
  });
  expect(f.deleteUser).toHaveBeenCalledWith(ID);
});
it("invalid live user and malformed identity never permit deletion of a supplied different person", async () => {
  for (const user of [
    { id: "not-uuid" },
    { id: ID, identities: [{ provider: "apple", identity_data: {} }] },
  ]) {
    const f = fixture(user);
    expect(
      (await f.handler(request({ appleAuthorizationCode: "code" }))).status,
    ).toBeGreaterThanOrEqual(400);
    expect(f.deleteUser).not.toHaveBeenCalled();
  }
});

it("account switch from confirmed A to authenticated B rejects before any revocation or admin deletion", async () => {
  const other = "22222222-2222-4222-8222-222222222222";
  const f = fixture({
    id: other,
    identities: [{ provider: "apple", identity_data: { sub: "other-subject" } }],
  });
  const response = await f.handler(
    request({ expectedAccountId: ID, appleAuthorizationCode: "code-for-A" }),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: "SHARE_ACCOUNT_MISMATCH" });
  expect(f.validateSession).not.toHaveBeenCalled();
  expect(f.revokeApple).not.toHaveBeenCalled();
  expect(f.deleteUser).not.toHaveBeenCalled();
});
it("missing or malformed expected account ID never deletes authenticated caller", async () => {
  const f = fixture();
  for (const body of [{}, { expectedAccountId: "local-id" }, { expectedAccountId: null }]) {
    const req = new Request("https://example.invalid", {
      method: "POST",
      headers: { authorization: "Bearer session", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await f.handler(req)).status).toBe(400);
  }
  expect(f.getUser).not.toHaveBeenCalled();
  expect(f.revokeApple).not.toHaveBeenCalled();
  expect(f.deleteUser).not.toHaveBeenCalled();
});
