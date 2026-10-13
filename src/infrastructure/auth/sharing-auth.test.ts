import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  createClient: vi.fn(),
  available: vi.fn(),
  credentialState: vi.fn(),
  appleSignIn: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithIdToken: vi.fn(),
  updateUser: vi.fn(),
  getSession: vi.fn(),
  random: vi.fn(),
  digest: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  refreshListener: vi.fn(),
  sessionListener: vi.fn(),
  secureGet: vi.fn(),
  secureSet: vi.fn(),
  secureDelete: vi.fn(),
  browser: vi.fn(),
  scheme: "lunashift-internal" as string | string[],
  platform: "ios",
  extra: { appVariant: "internal" },
}));
vi.mock("react-native-url-polyfill/auto", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: native.createClient }));
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return { scheme: native.scheme, extra: native.extra };
    },
  },
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return native.platform;
    },
  },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (status: string) => void) => {
      native.refreshListener.mockImplementation(listener);
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("expo-apple-authentication", () => ({
  isAvailableAsync: native.available,
  getCredentialStateAsync: native.credentialState,
  AppleAuthenticationCredentialState: { REVOKED: 0, AUTHORIZED: 1, NOT_FOUND: 2, TRANSFERRED: 3 },
  signInAsync: native.appleSignIn,
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: native.random,
  digestStringAsync: native.digest,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: native.secureGet,
  setItemAsync: native.secureSet,
  deleteItemAsync: native.secureDelete,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
}));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: native.browser }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("EXPO_PUBLIC_SHARING_SUPABASE_URL", "https://personal.supabase.co");
  vi.stubEnv(
    "EXPO_PUBLIC_SHARING_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_example_personal_key_12345",
  );
  native.platform = "ios";
  native.scheme = "lunashift-internal";
  native.extra = { appVariant: "internal" };
  native.secureGet.mockResolvedValue(null);
  native.secureSet.mockResolvedValue(undefined);
  native.secureDelete.mockResolvedValue(undefined);
  native.available.mockResolvedValue(true);
  native.credentialState.mockResolvedValue(1);
  native.random.mockReturnValue("random");
  native.digest.mockResolvedValue("0".repeat(64));
  native.getUser.mockResolvedValue({
    data: {
      user: {
        id: "same",
        identities: [{ provider: "apple", identity_data: { sub: "apple-sub" } }],
      },
    },
    error: null,
  });
  native.appleSignIn.mockImplementation(async (options) => ({
    identityToken: "jwt",
    authorizationCode: "fresh-code",
    state: options.state,
    user: "apple-sub",
    fullName: null,
  }));
  native.getSession.mockResolvedValue({ data: { session: null }, error: null });
  native.createClient.mockReturnValue({
    auth: {
      signInWithOAuth: native.signInWithOAuth,
      exchangeCodeForSession: native.exchangeCodeForSession,
      signOut: native.signOut,
      getUser: native.getUser,
      getSession: native.getSession,
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        native.sessionListener.mockImplementation(listener);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signInWithIdToken: native.signInWithIdToken,
      updateUser: native.updateUser,
      startAutoRefresh: native.start,
      stopAutoRefresh: native.stop,
    },
  });
});

describe("native sharing authentication adapter", () => {
  it("configures one persistent PKCE client with chunked Keychain storage", async () => {
    const { getSharingSupabaseClient } = await import("./sharing-auth");
    expect(getSharingSupabaseClient()).toBe(getSharingSupabaseClient());
    expect(native.createClient).toHaveBeenCalledTimes(1);
    const options = native.createClient.mock.calls[0][2];
    expect(options.auth).toMatchObject({
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "luna.sharing.personal.supabase.co.auth",
    });
    expect(options.auth.storage).toMatchObject({
      getItem: expect.any(Function),
      setItem: expect.any(Function),
      removeItem: expect.any(Function),
    });
    expect(native.start).toHaveBeenCalledTimes(1);
    native.refreshListener("background");
    expect(native.stop).toHaveBeenCalledTimes(1);
  });

  it("does not initialize a backend when public sharing configuration is missing", async () => {
    vi.stubEnv("EXPO_PUBLIC_SHARING_SUPABASE_URL", "");
    const { createSharingAuthPort, getSharingSupabaseClient } = await import("./sharing-auth");
    expect(getSharingSupabaseClient()).toBeNull();
    expect(createSharingAuthPort().isConfigured).toBe(false);
    expect(native.createClient).not.toHaveBeenCalled();
  });

  it("does not pretend native secure sessions are available on web", async () => {
    native.platform = "web";
    const { createSharingAuthPort } = await import("./sharing-auth");
    expect(createSharingAuthPort().isConfigured).toBe(false);
    expect(native.createClient).not.toHaveBeenCalled();
  });

  it("requires matching variant scheme so a callback cannot switch app environments", async () => {
    native.scheme = "lunashift-design";
    const { createSharingAuthPort } = await import("./sharing-auth");
    expect(createSharingAuthPort().isConfigured).toBe(false);
  });

  it("uses fresh Apple authorization code only for the same authenticated identity", async () => {
    const { requestAppleDeletionAuthorizationCode } = await import("./sharing-auth");
    expect(await requestAppleDeletionAuthorizationCode()).toBe("fresh-code");
    expect(native.appleSignIn).toHaveBeenCalledWith({
      nonce: "0".repeat(64),
      state: "random",
      requestedScopes: [0, 1],
    });
    expect(native.signInWithIdToken).not.toHaveBeenCalled();
    expect(native.secureSet).not.toHaveBeenCalled();
  });

  it("does not revoke a different Apple account selected during reauthentication", async () => {
    native.appleSignIn.mockResolvedValue({
      identityToken: "jwt",
      authorizationCode: "fresh-code",
      state: "random",
      user: "other-apple-sub",
      fullName: null,
    });
    const { requestAppleDeletionAuthorizationCode } = await import("./sharing-auth");
    await expect(requestAppleDeletionAuthorizationCode()).rejects.toThrow("Apple-Konto");
  });

  it("allows cancellation of Apple account deletion", async () => {
    native.appleSignIn.mockRejectedValue({ code: "ERR_REQUEST_CANCELED" });
    const { requestAppleDeletionAuthorizationCode } = await import("./sharing-auth");
    expect(await requestAppleDeletionAuthorizationCode()).toBeNull();
  });
});

it("reports native Apple button availability without creating an auth client", async () => {
  const { isSharingAppleSignInAvailable } = await import("./sharing-auth");
  expect(await isSharingAppleSignInAvailable()).toBe(true);
  expect(native.createClient).not.toHaveBeenCalled();
  native.available.mockRejectedValue(new Error("unsupported"));
  expect(await isSharingAppleSignInAvailable()).toBe(false);
});

it("wipes only the deleted sharing account name from Keychain", async () => {
  const { forgetSharingAuthProfile } = await import("./sharing-auth");
  await forgetSharingAuthProfile("account-id");
  expect(native.secureDelete).toHaveBeenCalledWith(
    "luna.sharing.apple-name.account-id.luna-v1.manifest",
    { keychainAccessible: 6 },
  );
  expect(
    native.secureDelete.mock.calls.every(([key]) =>
      key.startsWith("luna.sharing.apple-name.account-id"),
    ),
  ).toBe(true);
});

it("cannot resurrect native tokens from a late refresh after offline logout", async () => {
  native.signOut.mockRejectedValue(new Error("offline"));
  const { createSharingAuthPort } = await import("./sharing-auth");
  const port = createSharingAuthPort();
  const options = native.createClient.mock.calls[0][2];
  await port.signOut();
  native.secureSet.mockClear();
  await options.auth.storage.setItem(
    "luna.sharing.personal.supabase.co.auth",
    "late refresh token",
  );
  expect(native.secureSet).not.toHaveBeenCalled();
});

it("runs browser Google on the expected alias, cleans verifier and allows login after logout", async () => {
  native.scheme = ["pflegeshift-internal", "lunashift-internal"];
  native.signOut.mockResolvedValue({ error: null });
  native.signInWithOAuth.mockResolvedValue({
    data: { url: "https://personal.supabase.co/auth/v1/authorize?provider=google" },
    error: null,
  });
  native.exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: "user-id", user_metadata: { full_name: "Luna" } } },
    error: null,
  });
  native.browser.mockResolvedValue({
    type: "success",
    url: "lunashift-internal://auth/callback?luna_state=random&code=google-code",
  });
  const { createSharingAuthPort } = await import("./sharing-auth");
  const port = createSharingAuthPort();
  await port.signOut();
  expect(await port.signInGoogle()).toEqual({ id: "user-id", displayName: "Luna" });
  expect(native.browser).toHaveBeenCalledWith(
    "https://personal.supabase.co/auth/v1/authorize?provider=google",
    "lunashift-internal://auth/callback",
  );
  expect(native.secureDelete).toHaveBeenCalledWith(
    "luna.sharing.personal.supabase.co.auth-code-verifier.luna-v1.manifest",
    { keychainAccessible: 6 },
  );
  const options = native.createClient.mock.calls[0][2];
  await options.auth.storage.setItem("luna.sharing.personal.supabase.co.auth", "new session");
  expect(native.secureSet).toHaveBeenCalled();
});

it("uses native Apple scope/nonce and stores the first provided name securely", async () => {
  native.signInWithIdToken.mockResolvedValue({
    data: { user: { id: "user-id", user_metadata: {} } },
    error: null,
  });
  native.updateUser.mockResolvedValue({
    data: { user: { id: "user-id", user_metadata: { full_name: "First Name" } } },
    error: null,
  });
  native.appleSignIn.mockImplementation(async (options) => ({
    identityToken: "jwt",
    authorizationCode: "fresh-code",
    state: options.state,
    user: "apple-sub",
    fullName: { givenName: "First", familyName: "Name" },
  }));
  const { createSharingAuthPort } = await import("./sharing-auth");
  expect(await createSharingAuthPort().signInApple()).toEqual({
    id: "user-id",
    displayName: "First Name",
  });
  expect(native.signInWithIdToken).toHaveBeenCalledWith({
    provider: "apple",
    token: "jwt",
    nonce: "random",
  });
  expect(native.secureSet).toHaveBeenCalledWith(
    "luna.sharing.apple-name.user-id.luna-v1.a.chunk.0",
    "First Name",
    { keychainAccessible: 6 },
  );
});

describe("Apple account deletion preparation", () => {
  it("returns a transient authorized code for the same server-verified Apple account", async () => {
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    expect(await prepareAppleAccountDeletion()).toEqual({
      status: "authorized",
      authorizationCode: "fresh-code",
    });
    expect(native.credentialState).toHaveBeenCalledWith("apple-sub");
    expect(native.signInWithIdToken).not.toHaveBeenCalled();
    expect(native.secureSet).not.toHaveBeenCalled();
  });

  it("keeps user cancellation distinct from unavailable or revoked authorization", async () => {
    native.appleSignIn.mockRejectedValue({ code: "ERR_REQUEST_CANCELED" });
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    expect(await prepareAppleAccountDeletion()).toEqual({ status: "cancelled" });
  });

  it.each([0, 2])(
    "allows explicit manual revocation path for existing credential state %s",
    async (state) => {
      native.credentialState.mockResolvedValue(state);
      const { prepareAppleAccountDeletion } = await import("./sharing-auth");
      expect(await prepareAppleAccountDeletion()).toEqual({ status: "manualRevocationRequired" });
      expect(native.appleSignIn).not.toHaveBeenCalled();
    },
  );

  it("allows the manual path when Apple is unavailable after verifying the current account", async () => {
    native.available.mockResolvedValue(false);
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    expect(await prepareAppleAccountDeletion()).toEqual({ status: "manualRevocationRequired" });
    expect(native.getUser).toHaveBeenCalledTimes(1);
  });

  it("allows the manual path when native availability cannot be determined", async () => {
    native.available.mockRejectedValue(new Error("native unavailable"));
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    expect(await prepareAppleAccountDeletion()).toEqual({ status: "manualRevocationRequired" });
  });

  it("fails closed when the server cannot verify the current Apple identity", async () => {
    native.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("not authenticated"),
    });
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    await expect(prepareAppleAccountDeletion()).rejects.toThrow("Apple-Konto");
    expect(native.appleSignIn).not.toHaveBeenCalled();
  });

  it("never treats another selected Apple identity as a manual-revocation fallback", async () => {
    native.appleSignIn.mockResolvedValue({
      identityToken: "jwt",
      authorizationCode: "code",
      state: "random",
      user: "other-apple-sub",
      fullName: null,
    });
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    await expect(prepareAppleAccountDeletion()).rejects.toThrow("dasselbe Apple-Konto");
  });

  it("never treats a native state mismatch as a manual-revocation fallback", async () => {
    native.appleSignIn.mockResolvedValue({
      identityToken: "jwt",
      authorizationCode: "code",
      state: "other-state",
      user: "apple-sub",
      fullName: null,
    });
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    await expect(prepareAppleAccountDeletion()).rejects.toThrow("dasselbe Apple-Konto");
  });

  it("does not equate a transferred credential with revoked or unavailable", async () => {
    native.credentialState.mockResolvedValue(3);
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    await expect(prepareAppleAccountDeletion()).rejects.toThrow("bestätigt");
    expect(native.appleSignIn).not.toHaveBeenCalled();
  });

  it("still attempts reauthentication when the status lookup is unavailable", async () => {
    native.credentialState.mockRejectedValue(new Error("status endpoint unavailable"));
    const { prepareAppleAccountDeletion } = await import("./sharing-auth");
    expect(await prepareAppleAccountDeletion()).toEqual({
      status: "authorized",
      authorizationCode: "fresh-code",
    });
  });
});

it("offers explicit manual revocation after a native provider outage", async () => {
  native.appleSignIn.mockRejectedValue({ code: "ERR_REQUEST_FAILED" });
  const { prepareAppleAccountDeletion } = await import("./sharing-auth");
  expect(await prepareAppleAccountDeletion()).toEqual({ status: "manualRevocationRequired" });
});

it("does not classify malformed native response errors as a provider outage", async () => {
  native.appleSignIn.mockRejectedValue({ code: "ERR_INVALID_RESPONSE" });
  const { prepareAppleAccountDeletion } = await import("./sharing-auth");
  await expect(prepareAppleAccountDeletion()).rejects.toThrow("nicht bestätigt");
});

it("does not confuse explicit manual fallback with cancellation in the compatibility helper", async () => {
  native.credentialState.mockResolvedValue(0);
  const { requestAppleDeletionAuthorizationCode } = await import("./sharing-auth");
  await expect(requestAppleDeletionAuthorizationCode()).rejects.toThrow("manuellem Widerruf");
});

it("requires manual revocation when same-account reauthentication returns no code", async () => {
  native.appleSignIn.mockResolvedValue({
    identityToken: "jwt",
    authorizationCode: null,
    state: "random",
    user: "apple-sub",
    fullName: null,
  });
  const { prepareAppleAccountDeletion } = await import("./sharing-auth");
  expect(await prepareAppleAccountDeletion()).toEqual({ status: "manualRevocationRequired" });
});

it("denies an identity mismatch even when no authorization code is returned", async () => {
  native.appleSignIn.mockResolvedValue({
    identityToken: "jwt",
    authorizationCode: null,
    state: "random",
    user: "other",
    fullName: null,
  });
  const { prepareAppleAccountDeletion } = await import("./sharing-auth");
  await expect(prepareAppleAccountDeletion()).rejects.toThrow("dasselbe Apple-Konto");
});

it("clears Keychain before remote logout completes so a process reload cannot restore the account", async () => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  const request = vi.fn(async () => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", request);
  try {
    native.secureGet.mockImplementation(async (key) => values.get(key) ?? null);
    native.secureSet.mockImplementation(async (key, value) => {
      values.set(key, value);
    });
    native.secureDelete.mockImplementation(async (key) => {
      values.delete(key);
    });
    const { createSharingAuthPort } = await import("./sharing-auth");
    const port = createSharingAuthPort();
    const options = native.createClient.mock.calls[0][2];
    await options.auth.storage.setItem(
      "luna.sharing.personal.supabase.co.auth",
      "existing session",
    );
    expect(values.size).toBeGreaterThan(0);
    native.sessionListener("SIGNED_IN", { access_token: "captured-old-jwt", user: { id: "old" } });
    const signingOut = port.signOut();
    for (let index = 0; index < 30; index++) await Promise.resolve();
    expect(values.size).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, requestOptions] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://personal.supabase.co/auth/v1/logout?scope=local");
    expect(requestOptions.headers).toMatchObject({ Authorization: "Bearer captured-old-jwt" });
    expect(requestOptions.redirect).toBe("error");
    await vi.advanceTimersByTimeAsync(8000);
    await signingOut;
    expect((requestOptions.signal as AbortSignal).aborted).toBe(true);
    expect(native.signOut).not.toHaveBeenCalled();
    vi.resetModules();
    const reloaded = await import("./sharing-auth");
    reloaded.getSharingSupabaseClient();
    const reloadedOptions = native.createClient.mock.calls.at(-1)![2];
    expect(
      await reloadedOptions.auth.storage.getItem("luna.sharing.personal.supabase.co.auth"),
    ).toBeNull();
    expect(values.size).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
