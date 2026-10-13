import { describe, expect, it, vi } from "vitest";
import {
  createAppleRevoker,
  createAppleClientSecret,
} from "../../../supabase/functions/sharing-delete-account/apple";
const bytesToBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const NOW = 1791806400;
async function fixtures() {
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const p8 = await crypto.subtle.exportKey("pkcs8", signing.privateKey);
  const config = {
    teamId: "ABCDEFGHIJ",
    keyId: "KEY1234567",
    clientId: "com.pflegeshift.app.internal",
    privateKey: `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(new Uint8Array(p8))}\n-----END PRIVATE KEY-----`,
  };
  const appleKeys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", appleKeys.publicKey);
  async function token(payload: Record<string, unknown> = {}) {
    const data = `${b64({ alg: "RS256", kid: "apple-key" })}.${b64({ iss: "https://appleid.apple.com", aud: config.clientId, sub: "apple-subject", iat: NOW, exp: NOW + 600, ...payload })}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      appleKeys.privateKey,
      new TextEncoder().encode(data),
    );
    return `${data}.${Buffer.from(signature).toString("base64url")}`;
  }
  return { config, signing, jwk: { ...jwk, kid: "apple-key", alg: "RS256" }, token };
}
describe("Apple deletion token exchange and cryptographic verification", () => {
  it("generates short-lived ES256 client secret with exact team/key/audience/client", async () => {
    const f = await fixtures();
    const secret = await createAppleClientSecret(f.config, NOW, crypto);
    const [header, payload, signature] = secret.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: f.config.keyId,
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: f.config.teamId,
      iat: NOW,
      exp: NOW + 300,
      aud: "https://appleid.apple.com",
      sub: f.config.clientId,
    });
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        f.signing.publicKey,
        Buffer.from(signature, "base64url"),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
  });
  it("verifies Apple signature and current subject before revoking refresh token", async () => {
    const f = await fixtures();
    const idToken = await f.token();
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).endsWith("/token"))
        return Response.json({ id_token: idToken, refresh_token: "transient-refresh" });
      if (String(url).endsWith("/keys")) return Response.json({ keys: [f.jwk] });
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("token")).toBe("transient-refresh");
      expect(body.get("token_type_hint")).toBe("refresh_token");
      return new Response(null, { status: 200 });
    });
    const revoke = createAppleRevoker(f.config, {
      fetch: fetcher as typeof fetch,
      now: () => NOW,
      crypto,
      wait: async () => {},
    });
    expect(await revoke("fresh-code", "apple-subject")).toBe("revoked");
    expect(calls).toEqual([
      "https://appleid.apple.com/auth/token",
      "https://appleid.apple.com/auth/keys",
      "https://appleid.apple.com/auth/revoke",
    ]);
  });
  it.each([
    { sub: "another-person" },
    { aud: "another-client" },
    { iss: "https://evil.invalid" },
    { exp: NOW - 1 },
    { iat: NOW + 120 },
  ])("denies mismatched or expired signed identity before revoke: %j", async (payload) => {
    const f = await fixtures();
    const idToken = await f.token(payload);
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/token")
        ? Response.json({ id_token: idToken, refresh_token: "refresh" })
        : Response.json({ keys: [f.jwk] }),
    );
    const revoke = createAppleRevoker(f.config, {
      fetch: fetcher as typeof fetch,
      now: () => NOW,
      crypto,
      wait: async () => {},
    });
    await expect(revoke("code", "apple-subject")).rejects.toThrow("SHARE_APPLE_IDENTITY_MISMATCH");
    expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith("/revoke"))).toBe(true);
  });
  it("bad cryptographic signature is never an outage fallback", async () => {
    const f = await fixtures();
    const idToken = (await f.token()).split(".");
    idToken[2] = "a".repeat(idToken[2].length);
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/token")
        ? Response.json({ id_token: idToken.join("."), access_token: "access" })
        : Response.json({ keys: [f.jwk] }),
    );
    await expect(
      createAppleRevoker(f.config, {
        fetch: fetcher as typeof fetch,
        now: () => NOW,
        crypto,
        wait: async () => {},
      })("code", "apple-subject"),
    ).rejects.toThrow("SHARE_APPLE_IDENTITY_MISMATCH");
  });
  it("invalid grant means unavailable credentials, not confirmed revocation", async () => {
    const f = await fixtures();
    const fetcher = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    expect(
      await createAppleRevoker(f.config, {
        fetch: fetcher as typeof fetch,
        now: () => NOW,
        crypto,
        wait: async () => {},
      })("expired-code", "apple-subject"),
    ).toBe("manual_required");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("provider outages retry within request then return unconfirmed without storing tokens", async () => {
    const f = await fixtures();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    expect(
      await createAppleRevoker(f.config, {
        fetch: fetcher as typeof fetch,
        now: () => NOW,
        crypto,
        wait: async () => {},
      })("code", "apple-subject"),
    ).toBe("unconfirmed");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
