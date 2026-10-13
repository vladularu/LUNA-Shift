import { describe, expect, it } from "vitest";

import { readSharingBackendConfiguration } from "./sharing-auth-config";

const validKey = "sb_publishable_example_personal_key_12345";
describe("separate calendar-sharing auth configuration", () => {
  it("requires dedicated personal-data configuration", () => {
    expect(readSharingBackendConfiguration(undefined, undefined)).toBeNull();
    expect(readSharingBackendConfiguration("https://personal.supabase.co", undefined)).toBeNull();
    expect(readSharingBackendConfiguration(undefined, validKey)).toBeNull();
  });
  it("accepts the public personal publishable key and secure URL", () => {
    expect(readSharingBackendConfiguration("https://personal.supabase.co/", validKey)).toEqual({
      url: "https://personal.supabase.co",
      publishableKey: validKey,
      storageKey: "luna.sharing.personal.supabase.co.auth",
    });
  });
  it.each([
    "http://personal.supabase.co",
    "https://user:password@personal.supabase.co",
    "https://personal.supabase.co/path",
    "https://personal.supabase.co/?secret=key",
    "not-a-url",
  ])("fails closed for malformed or insecure server %s", (url) => {
    expect(readSharingBackendConfiguration(url, validKey)).toBeNull();
  });
  it.each([
    "sb_secret_never_in_client",
    "eyJhbGciOiJIUzI1NiJ9.service-role",
    "placeholder",
    "sb_publishable_short",
  ])("does not accept secret or placeholder key %s", (key) => {
    expect(readSharingBackendConfiguration("https://personal.supabase.co", key)).toBeNull();
  });
});
