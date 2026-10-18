import type { AuthStorage } from "./sharing-auth-storage";
import { UserFacingError } from "@/domain/errors";

export type SharingAuthUser = {
  id: string;
  displayName: string;
  email?: string;
  givenName?: string;
  familyName?: string;
};
export type SharingAuthPort = {
  isConfigured: boolean;
  getSession(): Promise<SharingAuthUser | null>;
  subscribe(listener: (user: SharingAuthUser | null) => void): () => void;
  signInApple(): Promise<SharingAuthUser | null>;
  signInGoogle(): Promise<SharingAuthUser | null>;
  updateName(
    expectedAccountId: string,
    givenName: string,
    familyName: string,
  ): Promise<SharingAuthUser>;
  signInEmail?(email: string, password: string): Promise<SharingAuthUser | null>;
  registerEmail?(email: string, password: string): Promise<"signed_in" | "verification_required">;
  verifyEmail?(email: string, token: string): Promise<SharingAuthUser | null>;
  requestPasswordReset?(email: string): Promise<void>;
  resetPassword?(email: string, token: string, password: string): Promise<SharingAuthUser | null>;
  signOut(): Promise<void>;
};
type ProviderUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  user_metadata?: Record<string, unknown>;
};
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
    updateUser(
      attributes:
        | { data: { full_name: string; given_name?: string; family_name?: string } }
        | { password: string },
    ): Promise<AuthResult>;
    signInWithPassword?(credentials: { email: string; password: string }): Promise<AuthResult>;
    signUp?(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: { user: ProviderUser | null; session: unknown }; error: unknown }>;
    verifyOtp?(credentials: {
      email: string;
      token: string;
      type: "signup" | "recovery";
    }): Promise<AuthResult>;
    resetPasswordForEmail?(email: string): Promise<{ error: unknown }>;
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
  let identityVersion = 0;
  let observedAccountId: string | null | undefined;
  let logoutWork: Promise<void> | null = null;
  const nameKey = (id: string) => `luna.sharing.apple-name.${id}`;
  function mapped(user: ProviderUser | null): SharingAuthUser | null {
    if (!user || signedOut) return null;
    return {
      id: user.id,
      ...(user.email ? { email: user.email } : {}),
      ...(typeof user.user_metadata?.given_name === "string"
        ? { givenName: user.user_metadata.given_name }
        : {}),
      ...(typeof user.user_metadata?.family_name === "string"
        ? { familyName: user.user_metadata.family_name }
        : {}),
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
  async function signIn<T>(action: (generation: number) => Promise<T>) {
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
  function emailAddress(value: string) {
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new UserFacingError("Bitte gib eine gültige E-Mail-Adresse ein.");
    return email;
  }
  function passwordValue(value: string, creating = true) {
    const characters = [...value];
    if (!characters.length) throw new UserFacingError("Bitte gib dein Passwort ein.");
    if (creating && characters.length < 12)
      throw new UserFacingError("Bitte verwende mindestens 12 Zeichen für dein Passwort.");
    const byteLength = characters.reduce((length, character) => {
      const point = character.codePointAt(0) ?? 0;
      return length + (point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4);
    }, 0);
    if (byteLength > 72)
      throw new UserFacingError("Dein Passwort ist zu lang. Kürze es bitte etwas.");
    return value;
  }
  function tokenValue(value: string) {
    const token = value.trim();
    if (!/^\d{6,8}$/.test(token))
      throw new UserFacingError("Bitte gib den Bestätigungscode aus deiner E-Mail ein.");
    return token;
  }
  function acceptEmailUser(user: ProviderUser | null, email: string, generation: number) {
    if (generation !== authGeneration) return null;
    if (!user || !user.email_confirmed_at || user.email?.toLowerCase() !== email)
      throw new UserFacingError("Die E-Mail-Anmeldung konnte nicht bestätigt werden.");
    signedOut = false;
    const result = mapped(user);
    for (const notify of listeners) notify(result);
    return result;
  }
  function acceptProviderUser(user: ProviderUser, generation: number) {
    if (generation !== authGeneration) return null;
    signedOut = false;
    const result = mapped(user);
    for (const notify of listeners) notify(result);
    return result;
  }
  return {
    isConfigured: client !== null,
    updateName: async (expectedAccountId, givenName, familyName) => {
      if (busy || logoutWork || signedOut)
        throw new UserFacingError("Bitte warte, bis dein Konto bereit ist.");
      const normalize = (value: string) => value.trim().replace(/\s+/gu, " ");
      const first = normalize(givenName);
      const last = normalize(familyName);
      const full = [first, last].filter(Boolean).join(" ");
      if (!full || full.length > 80 || /[\u0000-\u001f\u007f]/u.test(full))
        throw new UserFacingError("Bitte gib einen Namen mit höchstens 80 Zeichen ein.");
      const generation = authGeneration;
      const identity = identityVersion;
      const check = () => {
        if (signedOut || generation !== authGeneration || identity !== identityVersion)
          throw new UserFacingError(
            "Dein Konto hat sich geändert. Bitte öffne die Namenseite erneut.",
          );
      };
      busy = true;
      try {
        const session = await configured().auth.getSession();
        check();
        if (session.error || session.data.session?.user.id !== expectedAccountId)
          throw new UserFacingError("Bitte melde dich erneut in deinem LUNA-Konto an.");
        observedAccountId = expectedAccountId;
        const result = await configured().auth.updateUser({
          data: { full_name: full, given_name: first, family_name: last },
        });
        check();
        if (result.error || result.data.user?.id !== expectedAccountId)
          throw new UserFacingError(
            "Dein Name konnte nicht gespeichert werden. Bitte versuche es erneut.",
          );
        names.set(expectedAccountId, full);
        await runtime.nameStorage.setItem(nameKey(expectedAccountId), full);
        check();
        const user = mapped(result.data.user);
        if (!user) throw invalidResponse();
        for (const notify of listeners) notify(user);
        return user;
      } catch (error) {
        if (error instanceof UserFacingError) throw error;
        throw new UserFacingError(
          "Dein Name konnte nicht gespeichert werden. Bitte versuche es erneut.",
        );
      } finally {
        busy = false;
      }
    },
    signInEmail: (address, password) =>
      signIn(async (generation) => {
        const email = emailAddress(address);
        const action = configured().auth.signInWithPassword;
        if (!action) throw new UserFacingError("E-Mail-Anmeldung ist noch nicht eingerichtet.");
        const result = await action.call(configured().auth, {
          email,
          password: passwordValue(password, false),
        });
        if (result.error)
          throw new UserFacingError(
            "Anmelden ist nicht möglich. Prüfe E-Mail, Passwort und deine Internetverbindung.",
          );
        return acceptEmailUser(result.data.user, email, generation);
      }),
    registerEmail: (address, password) =>
      signIn(async (generation) => {
        const email = emailAddress(address);
        const action = configured().auth.signUp;
        if (!action) throw new UserFacingError("E-Mail-Registrierung ist noch nicht eingerichtet.");
        const result = await action.call(configured().auth, {
          email,
          password: passwordValue(password),
        });
        if (result.error)
          throw new UserFacingError(
            "Die Registrierung ist gerade nicht möglich. Bitte versuche es später erneut.",
          );
        if (generation !== authGeneration) return "verification_required" as const;
        if (!result.data.session) return "verification_required" as const;
        acceptEmailUser(result.data.user, email, generation);
        return "signed_in" as const;
      }),
    verifyEmail: (address, code) =>
      signIn(async (generation) => {
        const email = emailAddress(address);
        const action = configured().auth.verifyOtp;
        if (!action) throw new UserFacingError("E-Mail-Bestätigung ist noch nicht eingerichtet.");
        const result = await action.call(configured().auth, {
          email,
          token: tokenValue(code),
          type: "signup",
        });
        if (result.error)
          throw new UserFacingError(
            "Der Code konnte nicht bestätigt werden. Bitte prüfe den Code oder registriere dich erneut.",
          );
        return acceptEmailUser(result.data.user, email, generation);
      }),
    requestPasswordReset: async (address) => {
      const action = configured().auth.resetPasswordForEmail;
      if (!action)
        throw new UserFacingError("Passwort-Wiederherstellung ist noch nicht eingerichtet.");
      const result = await action.call(configured().auth, emailAddress(address));
      if (result.error)
        throw new UserFacingError(
          "Die E-Mail konnte gerade nicht angefordert werden. Bitte versuche es später erneut.",
        );
    },
    resetPassword: (address, code, password) =>
      signIn(async (generation) => {
        const email = emailAddress(address);
        const nextPassword = passwordValue(password);
        const action = configured().auth.verifyOtp;
        if (!action)
          throw new UserFacingError("Passwort-Wiederherstellung ist noch nicht eingerichtet.");
        const verified = await action.call(configured().auth, {
          email,
          token: tokenValue(code),
          type: "recovery",
        });
        if (verified.error || !verified.data.user || generation !== authGeneration)
          throw new UserFacingError("Der Wiederherstellungscode konnte nicht bestätigt werden.");
        if (verified.data.user.email?.toLowerCase() !== email) throw invalidResponse();
        const result = await configured().auth.updateUser({ password: nextPassword });
        if (result.error || result.data.user?.id !== verified.data.user.id)
          throw new UserFacingError("Das Passwort konnte nicht geändert werden.");
        return acceptEmailUser(result.data.user, email, generation);
      }),
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
          const nextId = session?.user.id ?? null;
          if (observedAccountId !== undefined && observedAccountId !== nextId) identityVersion++;
          observedAccountId = nextId;
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
          if (!updated.error && updated.data.user?.id === data.user.id)
            return acceptProviderUser(updated.data.user, generation);
        }
        return acceptProviderUser(data.user, generation);
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
          return acceptProviderUser(exchange.data.user, generation);
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
