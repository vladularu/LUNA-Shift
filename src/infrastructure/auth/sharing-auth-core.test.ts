import { describe, expect, it, vi } from "vitest";

import {
  createSharingAuthController,
  getSharingCallbackUrl,
  type SharingAuthClient,
  type SharingAuthRuntime,
} from "./sharing-auth-core";

const user = { id: "user-1", user_metadata: { full_name: "Luna Nutzer" } };
function setup() {
  const authListener = vi.fn();
  const client = {
    auth: {
      getSession: vi.fn<SharingAuthClient["auth"]["getSession"]>(async () => ({
        data: { session: { user } },
        error: null,
      })),
      onAuthStateChange: vi.fn(
        (listener: (event: string, session: { user: typeof user } | null) => void) => {
          authListener.mockImplementation(listener);
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      ),
      signInWithIdToken: vi.fn<SharingAuthClient["auth"]["signInWithIdToken"]>(async () => ({
        data: { user },
        error: null,
      })),
      updateUser: vi.fn<SharingAuthClient["auth"]["updateUser"]>(async () => ({
        data: { user },
        error: null,
      })),
      signInWithOAuth: vi.fn<SharingAuthClient["auth"]["signInWithOAuth"]>(async () => ({
        data: { url: "https://personal.supabase.co/auth/v1/authorize?provider=google" },
        error: null,
      })),
      exchangeCodeForSession: vi.fn<SharingAuthClient["auth"]["exchangeCodeForSession"]>(
        async () => ({ data: { user }, error: null }),
      ),
      signOut: vi.fn<SharingAuthClient["auth"]["signOut"]>(async () => ({ error: null })),
    },
  };
  const runtime = {
    platform: "ios",
    appleAvailable: vi.fn(async () => true),
    appleSignIn: vi.fn<SharingAuthRuntime["appleSignIn"]>(async (_options) => ({
      identityToken: "apple-token",
      state: "state",
      authorizationCode: "apple-code",
      fullName: { givenName: "Luna", familyName: "Nutzer" },
    })),
    random: vi.fn().mockReturnValueOnce("nonce").mockReturnValue("state"),
    sha256: vi.fn(async (text: string) => `sha256-${text}`),
    openBrowser: vi.fn(async (_url: string, callback: string) => ({
      type: "success",
      url: `${callback}?luna_state=nonce&code=code-1`,
    })),
    nameStorage: {
      getItem: vi.fn(async (_key: string): Promise<string | null> => null),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
    },
  };
  const port = createSharingAuthController(
    client,
    "https://personal.supabase.co",
    "lunashift-internal://auth/callback",
    runtime,
  );
  return { port, client, runtime, authListener };
}

describe("sharing authentication", () => {
  it("uses a distinct callback for each app variant", () => {
    expect(getSharingCallbackUrl("internal")).toBe("lunashift-internal://auth/callback");
    expect(getSharingCallbackUrl("design")).toBe("lunashift-design://auth/callback");
    expect(getSharingCallbackUrl("production")).toBe("lunashift://auth/callback");
  });

  it("restores the existing session and emits refreshes without email as display name", async () => {
    const { port, authListener } = setup();
    expect(await port.getSession()).toEqual({ id: "user-1", displayName: "Luna Nutzer" });
    const listener = vi.fn();
    const unsubscribe = port.subscribe(listener);
    authListener("TOKEN_REFRESHED", { user: { ...user, user_metadata: {} } });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith({ id: "user-1", displayName: "LUNA Nutzer" });
    unsubscribe();
  });

  it("verifies Apple with nonce and saves its first display name", async () => {
    const { port, runtime, client } = setup();
    expect(await port.signInApple()).toEqual({ id: "user-1", displayName: "Luna Nutzer" });
    expect(runtime.appleSignIn).toHaveBeenCalledWith({ nonce: "sha256-nonce", state: "state" });
    expect(client.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "apple-token",
      nonce: "nonce",
    });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: "Luna Nutzer" } });
    expect(runtime.nameStorage.setItem).toHaveBeenCalled();
  });

  it("treats Apple cancellation as cancellation rather than fabricated login", async () => {
    const { port, runtime, client } = setup();
    runtime.appleSignIn.mockRejectedValue({ code: "ERR_REQUEST_CANCELED" });
    expect(await port.signInApple()).toBeNull();
    expect(client.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("rejects an Apple state mismatch before exchanging credentials", async () => {
    const { port, runtime, client } = setup();
    runtime.appleSignIn.mockResolvedValue({
      identityToken: "apple-token",
      authorizationCode: "apple-code",
      state: "wrong",
      fullName: null,
    });
    await expect(port.signInApple()).rejects.toThrow("Antwort");
    expect(client.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("uses PKCE and exchanges one Google callback code only after state validation", async () => {
    const { port, client } = setup();
    expect(await port.signInGoogle()).toEqual({ id: "user-1", displayName: "Luna Nutzer" });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        skipBrowserRedirect: true,
        redirectTo: "lunashift-internal://auth/callback?luna_state=nonce",
      },
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("code-1");
  });

  it.each([
    "other://auth/callback?luna_state=nonce&code=code-1",
    "lunashift-internal://evil/callback?luna_state=nonce&code=code-1",
    "lunashift-internal://auth/else?luna_state=nonce&code=code-1",
    "lunashift-internal://auth/callback?luna_state=wrong&code=code-1",
    "lunashift-internal://auth/callback?luna_state=nonce&code=one&code=two",
    "lunashift-internal://auth/callback?luna_state=nonce&code=code-1#access_token=secret",
    "lunashift-internal://auth/callback?luna_state=nonce&error=access_denied&code=code-1",
  ])("rejects unsolicited or ambiguous Google callback %s", async (url) => {
    const { port, runtime, client } = setup();
    runtime.openBrowser.mockResolvedValue({ type: "success", url });
    await expect(port.signInGoogle()).rejects.toThrow();
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("does not exchange tokens if the auth URL comes from another server", async () => {
    const { port, runtime, client } = setup();
    client.auth.signInWithOAuth.mockResolvedValue({
      data: { url: "https://evil.example/auth/v1/authorize?provider=google" },
      error: null,
    });
    await expect(port.signInGoogle()).rejects.toThrow();
    expect(runtime.openBrowser).not.toHaveBeenCalled();
  });

  it("allows Google cancellation while retaining the existing session", async () => {
    const { port, runtime, client } = setup();
    runtime.openBrowser.mockResolvedValue({ type: "cancel", url: "" });
    expect(await port.signInGoogle()).toBeNull();
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("disables auth explicitly when the separate personal backend is absent", async () => {
    const { runtime } = setup();
    const port = createSharingAuthController(null, "", "lunashift://auth/callback", runtime);
    expect(port.isConfigured).toBe(false);
    expect(await port.getSession()).toBeNull();
    await expect(port.signInGoogle()).rejects.toThrow("eingerichtet");
    await expect(port.signInApple()).rejects.toThrow("eingerichtet");
  });

  it("signs out only the sharing session and never touches the local database", async () => {
    const { port, client } = setup();
    await port.signOut();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

it("does not retry an Apple metadata upload from within the auth event callback", async () => {
  const { port, client, runtime, authListener } = setup();
  runtime.nameStorage.getItem.mockResolvedValue("First Apple Name");
  client.auth.getSession.mockResolvedValue({
    data: { session: { user: { ...user, user_metadata: {} } } },
    error: null,
  });
  client.auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error("offline") });
  expect(await port.getSession()).toEqual({ id: "user-1", displayName: "First Apple Name" });
  const listener = vi.fn();
  port.subscribe(listener);
  client.auth.updateUser.mockClear();
  authListener("TOKEN_REFRESHED", { user: { ...user, user_metadata: {} } });
  expect(listener).toHaveBeenCalledWith({ id: "user-1", displayName: "First Apple Name" });
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});

it("retains the first Apple name even if saving Supabase metadata needs a retry", async () => {
  const { port, client } = setup();
  client.auth.signInWithIdToken.mockResolvedValue({
    data: { user: { ...user, user_metadata: {} } },
    error: null,
  });
  client.auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error("offline") });
  expect(await port.signInApple()).toEqual({ id: "user-1", displayName: "Luna Nutzer" });
});

it("treats a private-relay account without provided name as a valid private login", async () => {
  const { port, runtime, client } = setup();
  runtime.appleSignIn.mockResolvedValue({
    identityToken: "apple-token",
    state: "state",
    authorizationCode: "apple-code",
    fullName: null,
  });
  client.auth.signInWithIdToken.mockResolvedValue({
    data: {
      user: { id: "relay-user", user_metadata: { email: "secret@privaterelay.appleid.com" } },
    },
    error: null,
  });
  expect(await port.signInApple()).toEqual({ id: "relay-user", displayName: "LUNA Nutzer" });
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});

it("does not allow overlapping provider requests to replace the PKCE verifier", async () => {
  const { port, runtime } = setup();
  let finish: (result: { type: string }) => void = () => undefined;
  runtime.openBrowser.mockImplementation(
    async () =>
      new Promise<{ type: string; url: string }>((resolve) => {
        finish = (result) => resolve({ ...result, url: "" });
      }),
  );
  const first = port.signInGoogle();
  await Promise.resolve();
  await Promise.resolve();
  await expect(port.signInGoogle()).rejects.toThrow("bereits");
  finish({ type: "cancel" });
  expect(await first).toBeNull();
});

it("fails with a safe error when a restored session cannot be read", async () => {
  const { port, client } = setup();
  client.auth.getSession.mockResolvedValue({
    data: { session: null },
    error: new Error("secret token"),
  });
  await expect(port.getSession()).rejects.toThrow("wiederhergestellt");
});

it("reports Apple unavailable without sending native credentials", async () => {
  const { port, runtime } = setup();
  runtime.appleAvailable.mockResolvedValue(false);
  await expect(port.signInApple()).rejects.toThrow("nicht verfügbar");
  expect(runtime.appleSignIn).not.toHaveBeenCalled();
});

it("does not reveal native Apple provider failure details", async () => {
  const { port, runtime } = setup();
  runtime.appleSignIn.mockRejectedValue(new Error("token super-secret"));
  await expect(port.signInApple()).rejects.toThrow("derzeit nicht möglich");
});

it("rejects missing Apple identity token", async () => {
  const { port, runtime } = setup();
  runtime.appleSignIn.mockResolvedValue({
    identityToken: null,
    state: "state",
    authorizationCode: "apple-code",
    fullName: null,
  });
  await expect(port.signInApple()).rejects.toThrow("Antwort");
});

it("rejects unverified Apple server response", async () => {
  const { port, client } = setup();
  client.auth.signInWithIdToken.mockResolvedValue({
    data: { user: null },
    error: new Error("token secret"),
  });
  await expect(port.signInApple()).rejects.toThrow("nicht bestätigt");
});

it("does not leak Google server failure details", async () => {
  const { port, client } = setup();
  client.auth.signInWithOAuth.mockResolvedValue({
    data: { url: null },
    error: new Error("key secret"),
  });
  await expect(port.signInGoogle()).rejects.toThrow("derzeit nicht möglich");
});

it("does not accept Google response when the PKCE exchange fails", async () => {
  const { port, client } = setup();
  client.auth.exchangeCodeForSession.mockResolvedValue({
    data: { user: null },
    error: new Error("invalid verifier"),
  });
  await expect(port.signInGoogle()).rejects.toThrow("nicht bestätigt");
});

it("cleans secure sharing session even when offline sign-out throws", async () => {
  const { runtime, client } = setup();
  const clearSessionStorage = vi.fn(async () => undefined);
  client.auth.signOut.mockRejectedValue(new Error("offline"));
  const port = createSharingAuthController(
    client,
    "https://personal.supabase.co",
    "lunashift-internal://auth/callback",
    { ...runtime, clearSessionStorage },
  );
  await port.signOut();
  expect(clearSessionStorage).toHaveBeenCalledTimes(1);
  expect(await port.getSession()).toBeNull();
});

it("cleans a cancelled Google verifier without clearing an existing session", async () => {
  const { runtime, client } = setup();
  const clearOAuthState = vi.fn(async () => undefined);
  runtime.openBrowser.mockResolvedValue({ type: "cancel", url: "" });
  const port = createSharingAuthController(
    client,
    "https://personal.supabase.co",
    "lunashift-internal://auth/callback",
    { ...runtime, clearOAuthState },
  );
  expect(await port.signInGoogle()).toBeNull();
  expect(clearOAuthState).toHaveBeenCalledTimes(1);
  expect(client.auth.signOut).not.toHaveBeenCalled();
});

it("durably clears authentication before a hanging remote logout and finishes by the deadline", async () => {
  vi.useFakeTimers();
  try {
    const { client, runtime } = setup();
    client.auth.signOut.mockImplementation(async () => new Promise(() => undefined));
    const clearSessionStorage = vi.fn(async () => undefined);
    const signOutRemote = vi.fn(async () => new Promise<void>(() => undefined));
    const port = createSharingAuthController(
      client,
      "https://personal.supabase.co",
      "lunashift-internal://auth/callback",
      { ...runtime, clearSessionStorage, signOutRemote },
    );
    const signingOut = port.signOut();
    await Promise.resolve();
    expect(clearSessionStorage).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(await port.getSession()).toBeNull();
    await vi.advanceTimersByTimeAsync(8000);
    await signingOut;
    expect(signOutRemote).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("ignores an unsolicited old signed-in event after logout", async () => {
  const { client, runtime, authListener } = setup();
  const clearSessionStorage = vi.fn(async () => undefined);
  const port = createSharingAuthController(
    client,
    "https://personal.supabase.co",
    "lunashift-internal://auth/callback",
    { ...runtime, clearSessionStorage },
  );
  const listener = vi.fn();
  port.subscribe(listener);
  await port.signOut();
  listener.mockClear();
  authListener("SIGNED_IN", { user });
  expect(listener).toHaveBeenCalledWith(null);
  expect(await port.getSession()).toBeNull();
});

it("does not exchange a delayed provider response after the user logged out", async () => {
  const { runtime, client } = setup();
  let finish: (credential: Awaited<ReturnType<SharingAuthRuntime["appleSignIn"]>>) => void = () =>
    undefined;
  runtime.appleSignIn.mockImplementation(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const clearSessionStorage = vi.fn(async () => undefined);
  const port = createSharingAuthController(
    client,
    "https://personal.supabase.co",
    "lunashift-internal://auth/callback",
    { ...runtime, clearSessionStorage },
  );
  const signingIn = port.signInApple();
  for (let index = 0; index < 4; index++) await Promise.resolve();
  await port.signOut();
  finish({
    identityToken: "late-apple-token",
    state: "state",
    authorizationCode: "code",
    fullName: null,
  });
  expect(await signingIn).toBeNull();
  expect(client.auth.signInWithIdToken).not.toHaveBeenCalled();
  expect(await port.getSession()).toBeNull();
});
