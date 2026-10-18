import { describe, expect, it, vi } from "vitest";
import {
  createSharingAuthController,
  type SharingAuthClient,
  type SharingAuthRuntime,
} from "./sharing-auth-core";

const user = {
  id: "email-user",
  email: "luna@example.test",
  email_confirmed_at: "2026-10-17T12:00:00Z",
  user_metadata: { full_name: "Luna" },
};
function setup() {
  const result = () => ({ data: { user }, error: null });
  const actions = {
    signInWithPassword: vi.fn<NonNullable<SharingAuthClient["auth"]["signInWithPassword"]>>(
      async () => result(),
    ),
    signUp: vi.fn<NonNullable<SharingAuthClient["auth"]["signUp"]>>(async () => ({
      data: { user, session: null },
      error: null,
    })),
    verifyOtp: vi.fn<NonNullable<SharingAuthClient["auth"]["verifyOtp"]>>(async () => result()),
    resetPasswordForEmail: vi.fn<NonNullable<SharingAuthClient["auth"]["resetPasswordForEmail"]>>(
      async () => ({ error: null }),
    ),
    updateUser: vi.fn<SharingAuthClient["auth"]["updateUser"]>(async () => result()),
  };
  const client: SharingAuthClient = {
    auth: {
      ...actions,
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithIdToken: async () => result(),
      signInWithOAuth: async () => ({ data: { url: null }, error: null }),
      exchangeCodeForSession: async () => result(),
      signOut: async () => ({ error: null }),
    },
  };
  const runtime: SharingAuthRuntime = {
    platform: "ios",
    appleAvailable: async () => false,
    appleSignIn: async () => {
      throw new Error("unused");
    },
    random: () => "random",
    sha256: async () => "hash",
    openBrowser: async () => ({ type: "cancel" }),
    nameStorage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
    clearSessionStorage: async () => undefined,
  };
  const port = createSharingAuthController(
    client,
    "https://example.supabase.co",
    "lunashift://auth/callback",
    runtime,
  );
  return { actions, port };
}

describe("email accounts share the existing LUNA auth lifecycle", () => {
  it("normalizes the address but never trims the password", async () => {
    const { port, actions } = setup();
    await expect(
      port.signInEmail?.(" Luna@Example.Test ", "  long password  "),
    ).resolves.toMatchObject({ id: user.id, email: user.email });
    expect(actions.signInWithPassword).toHaveBeenCalledWith({
      email: user.email,
      password: "  long password  ",
    });
  });
  it("keeps registration without a verified session out of the signed-in state", async () => {
    const { port } = setup();
    const listener = vi.fn();
    port.subscribe(listener);
    expect(await port.registerEmail?.(user.email, "new password 123")).toBe(
      "verification_required",
    );
    expect(listener).not.toHaveBeenCalled();
  });
  it("does not present an unconfirmed account as a completed email login", async () => {
    const { port, actions } = setup();
    actions.signInWithPassword.mockResolvedValueOnce({
      data: { user: { ...user, email_confirmed_at: undefined } },
      error: null,
    });
    await expect(port.signInEmail?.(user.email, "new password 123")).rejects.toThrow(
      "nicht bestätigt",
    );
  });
  it("verifies signup codes with the signup flow", async () => {
    const { port, actions } = setup();
    await port.verifyEmail?.(user.email, "123456");
    expect(actions.verifyOtp).toHaveBeenCalledWith({
      email: user.email,
      token: "123456",
      type: "signup",
    });
  });
  it("recovery requires a verified email code before changing the password", async () => {
    const { port, actions } = setup();
    actions.verifyOtp.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("secret backend content"),
    });
    await expect(port.resetPassword?.(user.email, "123456", "new password 123")).rejects.toThrow(
      "Wiederherstellungscode",
    );
    expect(actions.updateUser).not.toHaveBeenCalled();
  });
  it("changes the password only for the account confirmed by the recovery code", async () => {
    const { port, actions } = setup();
    await port.resetPassword?.(user.email, "123456", "new password 123");
    expect(actions.verifyOtp).toHaveBeenCalledWith({
      email: user.email,
      token: "123456",
      type: "recovery",
    });
    expect(actions.updateUser).toHaveBeenCalledWith({ password: "new password 123" });
  });
  it("does not reopen an account from a login response that arrives after logout", async () => {
    const { port, actions } = setup();
    let finish!: (
      value: Awaited<ReturnType<NonNullable<SharingAuthClient["auth"]["signInWithPassword"]>>>,
    ) => void;
    actions.signInWithPassword.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const listener = vi.fn();
    port.subscribe(listener);
    const work = port.signInEmail?.(user.email, "new password 123");
    await port.signOut();
    finish({ data: { user }, error: null });
    expect(await work).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
  });
  it("rejects invalid input before making a provider request and hides provider errors", async () => {
    const { port, actions } = setup();
    await expect(port.registerEmail?.("invalid", "new password 123")).rejects.toThrow("E-Mail");
    expect(actions.signUp).not.toHaveBeenCalled();
    await expect(port.registerEmail?.(user.email, "short")).rejects.toThrow("12 Zeichen");
    actions.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("raw credential"),
    });
    await expect(port.signInEmail?.(user.email, "new password 123")).rejects.toThrow(
      "Prüfe E-Mail",
    );
  });
  it("respects the provider's UTF-8 password limit without truncating passwords", async () => {
    const { port, actions } = setup();
    for (const password of ["a".repeat(73), "ä".repeat(37), "😀".repeat(19)]) {
      await expect(port.registerEmail?.(user.email, password)).rejects.toThrow("zu lang");
    }
    expect(actions.signUp).not.toHaveBeenCalled();
    for (const password of ["a".repeat(72), "ä".repeat(36), "😀".repeat(18)]) {
      await port.registerEmail?.(user.email, password);
      expect(actions.signUp).toHaveBeenLastCalledWith({ email: user.email, password });
    }
  });
  it("requires twelve characters for new passwords while preserving access to existing accounts", async () => {
    const { port, actions } = setup();
    await expect(port.registerEmail?.(user.email, "😀".repeat(6))).rejects.toThrow("12 Zeichen");
    await expect(port.signInEmail?.(user.email, "old123")).resolves.toMatchObject({ id: user.id });
    expect(actions.signInWithPassword).toHaveBeenCalledWith({
      email: user.email,
      password: "old123",
    });
  });
});
