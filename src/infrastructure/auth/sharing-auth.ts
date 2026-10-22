import "react-native-url-polyfill/auto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { AppState, Platform } from "react-native";

import { readSharingBackendConfiguration } from "./sharing-auth-config";
import {
  createSharingAuthController,
  getSharingCallbackUrl,
  type SharingAuthPort,
  type SharingAuthRuntime,
} from "./sharing-auth-core";
import { bindSharingSessionRefresh } from "./sharing-auth-refresh";
import { createChunkedAuthStorage } from "./sharing-auth-storage";
import { readStoredSharingUser } from "./sharing-stored-user";

export type { SharingAuthUser, SharingAuthPort } from "./sharing-auth-core";

const secretOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const sha256 = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
const storage = createChunkedAuthStorage(
  {
    get: (key) => SecureStore.getItemAsync(key, secretOptions),
    set: (key, value) => SecureStore.setItemAsync(key, value, secretOptions),
    remove: (key) => SecureStore.deleteItemAsync(key, secretOptions),
  },
  sha256,
);

let sessionWritesAllowed = true;
let latestAccessToken: string | null = null;
let pendingLogoutToken: string | null = null;
const sessionStorage = {
  getItem: (key: string) => (sessionWritesAllowed ? storage.getItem(key) : Promise.resolve(null)),
  setItem: (key: string, value: string) =>
    sessionWritesAllowed ? storage.setItem(key, value) : Promise.resolve(),
  removeItem: (key: string) => storage.removeItem(key),
};
let client: SupabaseClient | null = null;
let authPort: SharingAuthPort | null = null;
function configuration() {
  if (Platform.OS === "web") return null;
  const backend = readSharingBackendConfiguration(
    process.env.EXPO_PUBLIC_SHARING_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SHARING_SUPABASE_PUBLISHABLE_KEY,
  );
  const variant = Constants.expoConfig?.extra?.appVariant;
  const callback = getSharingCallbackUrl(typeof variant === "string" ? variant : "production");
  const scheme = callback.split(":")[0];
  const configuredScheme = Constants.expoConfig?.scheme;
  const schemes =
    typeof configuredScheme === "string" ? [configuredScheme] : (configuredScheme ?? []);
  if (!schemes.includes(scheme)) return null;
  return backend ? { ...backend, callback } : null;
}

export function getSharingSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  const config = configuration();
  if (!config) return null;
  client = createClient(config.url, config.publishableKey, {
    auth: {
      storage: sessionStorage,
      storageKey: config.storageKey,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  client.auth.onAuthStateChange((_event, session) => {
    if (sessionWritesAllowed) latestAccessToken = session?.access_token ?? null;
  });
  bindSharingSessionRefresh(client.auth, {
    currentState: AppState.currentState,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
  });
  return client;
}

function runtime(): SharingAuthRuntime {
  return {
    platform: Platform.OS,
    random: () => Crypto.randomUUID(),
    sha256,
    appleAvailable: () => AppleAuthentication.isAvailableAsync(),
    appleSignIn: (options) =>
      AppleAuthentication.signInAsync({
        ...options,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      }),
    openBrowser: (url, callback) => WebBrowser.openAuthSessionAsync(url, callback),
    nameStorage: storage,
    readStoredUser: async () => {
      const config = configuration();
      if (!config || !sessionWritesAllowed) return null;
      const value = await sessionStorage.getItem(config.storageKey);
      return sessionWritesAllowed ? readStoredSharingUser(value) : null;
    },
    allowSessionWrites: () => {
      sessionWritesAllowed = true;
    },
    clearOAuthState: async () => {
      const config = configuration();
      if (config) await storage.removeItem(`${config.storageKey}-code-verifier`);
    },
    signOutRemote: async () => {
      const token = pendingLogoutToken;
      pendingLogoutToken = null;
      const config = configuration();
      if (!token || !config) return;
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 8000);
      try {
        // Revoke only the captured old session. SDK logout could otherwise clear a newly signed-in account.
        const response = await fetch(`${config.url}/auth/v1/logout?scope=local`, {
          method: "POST",
          redirect: "error",
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("Die Server-Abmeldung wurde nicht bestätigt.");
      } finally {
        clearTimeout(deadline);
      }
    },
    clearSessionStorage: async () => {
      pendingLogoutToken = latestAccessToken;
      latestAccessToken = null;
      sessionWritesAllowed = false;
      const config = configuration();
      if (!config) return;
      await storage.removeItem(config.storageKey);
      await storage.removeItem(`${config.storageKey}-code-verifier`);
    },
  };
}

export function createSharingAuthPort(): SharingAuthPort {
  if (!authPort) {
    const config = configuration();
    authPort = createSharingAuthController(
      getSharingSupabaseClient(),
      config?.url ?? "",
      config?.callback ?? getSharingCallbackUrl("production"),
      runtime(),
    );
  }
  return authPort;
}

export type AppleAccountDeletionPreparation =
  | { status: "authorized"; authorizationCode: string }
  | { status: "cancelled" }
  | { status: "manualRevocationRequired" };

/** Current LUNA identity is verified before offering any manual Apple-revocation fallback. */
export async function prepareAppleAccountDeletion(): Promise<AppleAccountDeletionPreparation> {
  const sharingClient = getSharingSupabaseClient();
  if (!sharingClient) throw new Error("Bitte melde dich mit deinem Apple-Konto an.");
  const current = await sharingClient.auth.getUser();
  const appleIdentity = current.data.user?.identities?.find(
    (identity) => identity.provider === "apple",
  );
  const expectedSubject: unknown = appleIdentity?.identity_data?.sub;
  if (current.error || typeof expectedSubject !== "string" || !expectedSubject)
    throw new Error("Bitte melde dich mit deinem Apple-Konto an.");
  if (!(await isSharingAppleSignInAvailable())) return { status: "manualRevocationRequired" };

  let credentialState: AppleAuthentication.AppleAuthenticationCredentialState | null = null;
  try {
    credentialState = await AppleAuthentication.getCredentialStateAsync(expectedSubject);
  } catch {
    /* A status lookup failure may still allow fresh native reauthentication. */
  }
  if (
    credentialState === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED ||
    credentialState === AppleAuthentication.AppleAuthenticationCredentialState.NOT_FOUND
  )
    return { status: "manualRevocationRequired" };
  if (
    credentialState !== null &&
    credentialState !== AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED
  )
    throw new Error("Das Apple-Konto konnte nicht bestätigt werden.");

  const nonce = Crypto.randomUUID();
  const state = Crypto.randomUUID();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      nonce: await sha256(nonce),
      state,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ERR_REQUEST_CANCELED") return { status: "cancelled" };
    if (
      typeof code === "string" &&
      [
        "ERR_REQUEST_FAILED",
        "ERR_REQUEST_NOT_HANDLED",
        "ERR_REQUEST_NOT_INTERACTIVE",
        "ERR_REQUEST_UNKNOWN",
      ].includes(code)
    )
      return { status: "manualRevocationRequired" };
    throw new Error("Apple-Anmeldung konnte nicht bestätigt werden.");
  }
  // A returned identity or state mismatch is never a recoverable provider outage.
  if (credential.user !== expectedSubject || credential.state !== state)
    throw new Error("Bitte verwende dasselbe Apple-Konto wie für LUNA.");
  if (!credential.authorizationCode) return { status: "manualRevocationRequired" };
  return { status: "authorized", authorizationCode: credential.authorizationCode };
}

/** Compatibility helper: manual fallback is explicit and cannot be confused with cancellation. */
export async function requestAppleDeletionAuthorizationCode(): Promise<string | null> {
  const result = await prepareAppleAccountDeletion();
  if (result.status === "authorized") return result.authorizationCode;
  if (result.status === "cancelled") return null;
  throw new Error(
    "Apple-Widerruf ist derzeit nicht verfügbar. Bitte bestätige die Kontolöschung mit manuellem Widerruf.",
  );
}
export async function isSharingAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Call after confirmed self-deletion, keeping the offline schedule/database intact. */
export function forgetSharingAuthProfile(userId: string): Promise<void> {
  return storage.removeItem(`luna.sharing.apple-name.${userId}`);
}
