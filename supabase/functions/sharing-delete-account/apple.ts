export interface AppleDeletionConfiguration {
  readonly teamId: string;
  readonly keyId: string;
  readonly clientId: string;
  readonly privateKey: string;
}
export interface AppleDeletionRuntime {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly crypto: Crypto;
  readonly wait: (milliseconds: number) => Promise<void>;
}
const APPLE = "https://appleid.apple.com";
const encoder = new TextEncoder();
class AppleProviderUnavailable extends Error {}
const mismatch = (): never => {
  throw new Error("SHARE_APPLE_IDENTITY_MISMATCH");
};
function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 32768) return mismatch();
  try {
    const binary = atob(
      value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return mismatch();
  }
}
function json(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decode(value)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return mismatch();
    return parsed as Record<string, unknown>;
  } catch {
    return mismatch();
  }
}
function configuration(config: AppleDeletionConfiguration) {
  if (
    !/^[A-Z0-9]{10}$/.test(config.teamId) ||
    !/^[A-Z0-9]{10}$/.test(config.keyId) ||
    !/^[A-Za-z0-9.-]{3,150}$/.test(config.clientId) ||
    config.privateKey.length > 8192 ||
    !config.privateKey.includes("-----BEGIN PRIVATE KEY-----")
  )
    throw new AppleProviderUnavailable();
}
export async function createAppleClientSecret(
  config: AppleDeletionConfiguration,
  now: number,
  cryptography: Crypto,
): Promise<string> {
  configuration(config);
  const pem = config.privateKey.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  let pkcs8: Uint8Array;
  try {
    pkcs8 = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0));
  } catch {
    throw new AppleProviderUnavailable();
  }
  const key = await cryptography.subtle.importKey(
    "pkcs8",
    pkcs8 as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64url(
    encoder.encode(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" })),
  );
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        iss: config.teamId,
        iat: now,
        exp: now + 300,
        aud: APPLE,
        sub: config.clientId,
      }),
    ),
  );
  const signed = `${header}.${payload}`;
  const signature = await cryptography.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signed),
  );
  return `${signed}.${base64url(new Uint8Array(signature))}`;
}
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (Number(response.headers.get("content-length") ?? 0) > 65536)
    throw new AppleProviderUnavailable();
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 65536) throw new AppleProviderUnavailable();
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new AppleProviderUnavailable();
    return value as Record<string, unknown>;
  } catch {
    throw new AppleProviderUnavailable();
  }
}
async function request(
  runtime: AppleDeletionRuntime,
  path: "/auth/token" | "/auth/keys" | "/auth/revoke",
  body?: URLSearchParams,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await runtime.fetch(`${APPLE}${path}`, {
        method: body ? "POST" : "GET",
        headers: body
          ? { "content-type": "application/x-www-form-urlencoded" }
          : { accept: "application/json" },
        ...(body ? { body: body.toString() } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 429 && response.status < 500) return response;
    } catch {
      /* Only a bounded retry; provider errors and request secrets are never logged. */
    }
    if (attempt < 2) await runtime.wait(150 * (attempt + 1));
  }
  throw new AppleProviderUnavailable();
}
async function verifyIdentity(
  idToken: string,
  config: AppleDeletionConfiguration,
  subject: string,
  runtime: AppleDeletionRuntime,
): Promise<void> {
  if (idToken.length > 32768) return mismatch();
  const parts = idToken.split(".");
  if (parts.length !== 3) return mismatch();
  const header = json(parts[0]);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 100)
    return mismatch();
  const keysResponse = await request(runtime, "/auth/keys");
  if (!keysResponse.ok) throw new AppleProviderUnavailable();
  const jwks = await responseJson(keysResponse);
  if (!Array.isArray(jwks.keys) || jwks.keys.length > 20) return mismatch();
  const key = jwks.keys.find(
    (value) => value && typeof value === "object" && value.kid === header.kid,
  );
  if (
    !key ||
    key.kty !== "RSA" ||
    (key.alg !== undefined && key.alg !== "RS256") ||
    typeof key.n !== "string" ||
    typeof key.e !== "string"
  )
    return mismatch();
  let valid = false;
  try {
    const publicKey = await runtime.crypto.subtle.importKey(
      "jwk",
      key as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await runtime.crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decode(parts[2]) as BufferSource,
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return mismatch();
  }
  if (!valid) return mismatch();
  const claims = json(parts[1]),
    now = runtime.now();
  if (
    claims.iss !== APPLE ||
    claims.aud !== config.clientId ||
    claims.sub !== subject ||
    typeof claims.exp !== "number" ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= now ||
    typeof claims.iat !== "number" ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat > now + 30 ||
    (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now + 30))
  )
    return mismatch();
}
export function createAppleRevoker(
  config: AppleDeletionConfiguration,
  runtime: AppleDeletionRuntime,
) {
  return async (
    code: string,
    expectedSubject: string,
  ): Promise<"revoked" | "manual_required" | "unconfirmed"> => {
    try {
      const secret = await createAppleClientSecret(config, runtime.now(), runtime.crypto);
      const tokenResponse = await request(
        runtime,
        "/auth/token",
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: secret,
          code,
          grant_type: "authorization_code",
        }),
      );
      const tokens = await responseJson(tokenResponse);
      if (!tokenResponse.ok)
        return tokens.error === "invalid_grant" ? "manual_required" : "unconfirmed";
      if (typeof tokens.id_token !== "string") return mismatch();
      await verifyIdentity(tokens.id_token, config, expectedSubject, runtime);
      const token =
        typeof tokens.refresh_token === "string"
          ? tokens.refresh_token
          : typeof tokens.access_token === "string"
            ? tokens.access_token
            : null;
      if (!token || token.length > 8192) return "manual_required";
      const revoked = await request(
        runtime,
        "/auth/revoke",
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: secret,
          token,
          token_type_hint:
            typeof tokens.refresh_token === "string" ? "refresh_token" : "access_token",
        }),
      );
      if (revoked.status === 200) return "revoked";
      return "unconfirmed";
    } catch (error) {
      if (error instanceof Error && error.message === "SHARE_APPLE_IDENTITY_MISMATCH") throw error;
      return "unconfirmed";
    }
  };
}
