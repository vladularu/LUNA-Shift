import type { AuthStorage } from "./sharing-auth-storage";

export type SharingAuthUser = { id: string; displayName: string };
export type SharingAuthPort = {
  isConfigured: boolean;
  getSession(): Promise<SharingAuthUser | null>;
  subscribe(listener: (user: SharingAuthUser | null) => void): () => void;
  signInApple(): Promise<SharingAuthUser | null>;
  signInGoogle(): Promise<SharingAuthUser | null>;
  signOut(): Promise<void>;
};
type ProviderUser = { id: string; user_metadata?: Record<string, unknown> };
type AuthResult = { data: { user: ProviderUser | null }; error: unknown };
export type SharingAuthClient = {
  auth: {
    getSession(): Promise<{ data: { session: { user: ProviderUser } | null }; error: unknown }>;
    onAuthStateChange(listener: (event: string, session: { user: ProviderUser } | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
    signInWithIdToken(credentials: {
      provider: "apple";
      token: string;
      nonce: string;
    }): Promise<AuthResult>;
    updateUser(attributes: { data: { full_name: string } }): Promise<AuthResult>;
    signInWithOAuth(credentials: {
      provider: "google";
      options: { skipBrowserRedirect: true; redirectTo: string };
    }): Promise<{ data: { url: string | null }; error: unknown }>;
    exchangeCodeForSession(code: string): Promise<AuthResult>;
    signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
  };
};
export type AppleCredential = {
  identityToken: string | null;
  state: string | null;
  authorizationCode: string | null;
  fullName: {
    givenName: string | null;
    familyName: string | null;
    middleName?: string | null;
  } | null;
};
export type SharingAuthRuntime = {
  platform: string;
  appleAvailable(): Promise<boolean>;
  appleSignIn(options: { nonce: string; state: string }): Promise<AppleCredential>;
  random(): string;
  sha256(value: string): Promise<string>;
  openBrowser(url: string, callback: string): Promise<{ type: string; url?: string }>;
  nameStorage: AuthStorage;
  clearSessionStorage?(): Promise<void>;
  signOutRemote?(): Promise<void>;
  clearOAuthState?(): Promise<void>;
  allowSessionWrites?(): void;
};

export function getSharingCallbackUrl(variant: string): string {
  const scheme =
    variant === "internal"
      ? "lunashift-internal"
      : variant === "design"
        ? "lunashift-design"
        : "lunashift";
  return `${scheme}://auth/callback`;
}
function cleanName(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value
        .trim()
        .replace(/[\r\n\t]/g, " ")
        .slice(0, 80)
    : null;
}
function cancellation(error: unknown): boolean {
  return (
    !!error && typeof error === "object" && "code" in error && error.code === "ERR_REQUEST_CANCELED"
  );
}
function invalidResponse(): Error {
  return new Error(
    "Die Antwort der Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut.",
  );
}

/** Local logout never waits indefinitely for a remote response. No remote acknowledgement is inferred. */
async function boundedLogout<T>(request: Promise<T>): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<T>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("Remote logout timeout")), 8000);
      }),
    ]);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}
export function createSharingAuthController(
  client: SharingAuthClient | null,
  backendUrl: string,
  callbackUrl: string,
  runtime: SharingAuthRuntime,
): SharingAuthPort {
  const names = new Map<string, string>();
  const listeners = new Set<(user: SharingAuthUser | null) => void>();
  let subscription: { unsubscribe(): void } | null = null;
  let busy = false;
  let signedOut = false;
  let authGeneration = 0;
  let logoutWork: Promise<void> | null = null;
  const nameKey = (id: string) => `luna.sharing.apple-name.${id}`;
  function mapped(user: ProviderUser | null): SharingAuthUser | null {
    if (!user || signedOut) return null;
    return {
      id: user.id,
      displayName:
        cleanName(user.user_metadata?.full_name) ??
        cleanName(user.user_metadata?.name) ??
        names.get(user.id) ??
        "LUNA Nutzer",
    };
  }
  function configured(): SharingAuthClient {
    if (!client)
      throw new Error(
        "Kalender teilen ist noch nicht eingerichtet. Deine lokalen Daten bleiben erhalten.",
      );
    return client;
  }
  async function signIn(action: (generation: number) => Promise<SharingAuthUser | null>) {
    configured();
    if (busy || logoutWork) throw new Error("Eine Anmeldung läuft bereits.");
    busy = true;
    runtime.allowSessionWrites?.();
    const generation = authGeneration;
    try {
      return await action(generation);
    } finally {
      busy = false;
    }
  }
  return {
    isConfigured: client !== null,
    getSession: async () => {
      if (!client || signedOut) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error("Die Anmeldung konnte nicht wiederhergestellt werden.");
      if (data.session) {
        const name = cleanName(await runtime.nameStorage.getItem(nameKey(data.session.user.id)));
        if (name) {
          names.set(data.session.user.id, name);
          if (!cleanName(data.session.user.user_metadata?.full_name)) {
            const update = await client.auth.updateUser({ data: { full_name: name } });
            if (!update.error && update.data.user) return mapped(update.data.user);
          }
        }
      }
      return mapped(data.session?.user ?? null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      if (client && !subscription)
        subscription = client.auth.onAuthStateChange((event, session) => {
          // Only an explicitly completed provider login can reopen a locally signed-out account.
          if (event === "SIGNED_OUT") signedOut = true;
          const user = mapped(session?.user ?? null);
          for (const notify of listeners) notify(user);
        }).data.subscription;
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscription?.unsubscribe();
          subscription = null;
        }
      };
    },
    signInApple: () =>
      signIn(async (generation) => {
        if (runtime.platform !== "ios" || !(await runtime.appleAvailable()))
          throw new Error("Apple-Anmeldung ist auf diesem Gerät nicht verfügbar.");
        const nonce = runtime.random();
        const state = runtime.random();
        let credential: AppleCredential;
        try {
          credential = await runtime.appleSignIn({ nonce: await runtime.sha256(nonce), state });
        } catch (error) {
          if (cancellation(error)) return null;
          throw new Error("Apple-Anmeldung ist derzeit nicht möglich.");
        }
        if (!credential.identityToken || credential.state !== state) throw invalidResponse();
        if (generation !== authGeneration) return null;
        const { data, error } = await configured().auth.signInWithIdToken({
          provider: "apple",
          token: credential.identityToken,
          nonce,
        });
        if (error || !data.user) throw new Error("Apple-Anmeldung konnte nicht bestätigt werden.");
        if (generation !== authGeneration) return null;
        signedOut = false;
        const name = cleanName(
          [
            credential.fullName?.givenName,
            credential.fullName?.middleName,
            credential.fullName?.familyName,
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (name) {
          names.set(data.user.id, name);
          await runtime.nameStorage.setItem(nameKey(data.user.id), name);
          const updated = await configured().auth.updateUser({ data: { full_name: name } });
          // Apple returns names only once. Keep the secure copy if metadata upload must be retried.
          if (!updated.error && updated.data.user) return mapped(updated.data.user);
        }
        return mapped(data.user);
      }),
    signInGoogle: () =>
      signIn(async (generation) => {
        if (runtime.platform === "web")
          throw new Error("Bitte verwende die LUNA App für die Google-Anmeldung.");
        const state = runtime.random();
        try {
          const redirectTo = `${callbackUrl}?luna_state=${encodeURIComponent(state)}`;
          const { data, error } = await configured().auth.signInWithOAuth({
            provider: "google",
            options: { skipBrowserRedirect: true, redirectTo },
          });
          if (error || !data.url) throw new Error("Google-Anmeldung ist derzeit nicht möglich.");
          const authorize = new URL(data.url);
          const backend = new URL(backendUrl);
          if (
            authorize.origin !== backend.origin ||
            authorize.pathname !== "/auth/v1/authorize" ||
            authorize.username ||
            authorize.password ||
            authorize.searchParams.get("provider") !== "google"
          )
            throw invalidResponse();
          const result = await runtime.openBrowser(data.url, callbackUrl);
          if (result.type === "cancel" || result.type === "dismiss") return null;
          if (result.type !== "success" || !result.url) throw invalidResponse();
          const callback = new URL(result.url);
          const expected = new URL(callbackUrl);
          if (
            callback.protocol !== expected.protocol ||
            callback.hostname !== expected.hostname ||
            callback.pathname !== expected.pathname ||
            callback.port !== expected.port ||
            callback.username ||
            callback.password ||
            callback.hash ||
            callback.searchParams.getAll("luna_state").length !== 1 ||
            callback.searchParams.get("luna_state") !== state ||
            callback.searchParams.has("error") ||
            callback.searchParams.has("access_token") ||
            callback.searchParams.has("refresh_token") ||
            callback.searchParams.getAll("code").length !== 1
          )
            throw invalidResponse();
          const code = callback.searchParams.get("code");
          if (!code || code.length > 4096) throw invalidResponse();
          if (generation !== authGeneration) return null;
          const exchange = await configured().auth.exchangeCodeForSession(code);
          if (exchange.error || !exchange.data.user)
            throw new Error("Google-Anmeldung konnte nicht bestätigt werden.");
          if (generation !== authGeneration) return null;
          signedOut = false;
          return mapped(exchange.data.user);
        } finally {
          await runtime.clearOAuthState?.();
        }
      }),
    signOut: () => {
      if (logoutWork) return logoutWork;
      authGeneration++;
      signedOut = true;
      // Start durable cleanup synchronously; no remote request may precede it.
      const cleanup = runtime.clearSessionStorage?.();
      names.clear();
      for (const notify of listeners) notify(null);
      logoutWork = (async () => {
        if (runtime.clearSessionStorage) {
          await cleanup;
          if (runtime.signOutRemote)
            await boundedLogout(runtime.signOutRemote()).catch(() => undefined);
          return;
        }
        if (client) {
          try {
            const result = await boundedLogout(client.auth.signOut({ scope: "local" }));
            if (result.error) throw result.error;
          } catch {
            signedOut = false;
            throw new Error("Abmelden ist derzeit nicht möglich.");
          }
        }
      })().finally(() => {
        logoutWork = null;
      });
      return logoutWork;
    },
  };
}
