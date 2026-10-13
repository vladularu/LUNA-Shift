import { describe, expect, it } from "vitest";
import { createSharingInviteUrl } from "./calendar-sharing-invite-url";
describe("sharing invitation URL", () => {
  const token = "a".repeat(64);
  it("uses separate app-variant schemes without exposing identity data", () => {
    expect(createSharingInviteUrl(token, undefined, "internal")).toBe(
      `lunashift-internal://sharing-invite?token=${token}`,
    );
    expect(createSharingInviteUrl(token, undefined, "design")).toContain("lunashift-design://");
    expect(createSharingInviteUrl(token, undefined, "production")).toContain("lunashift://");
  });
  it("only accepts a deliberate HTTPS invitation base without userinfo, prior query or fragment", () => {
    expect(
      createSharingInviteUrl(token, "https://calendar.example.org/sharing-invite", "internal"),
    ).toBe(`https://calendar.example.org/sharing-invite?token=${token}`);
    for (const url of [
      "http://calendar.example.org/sharing-invite",
      "https://u:p@calendar.example.org/sharing-invite",
      "https://calendar.example.org/sharing-invite?leak=true",
      "https://calendar.example.org/sharing-invite#fragment",
      "https://localhost/sharing-invite",
      "https://127.0.0.1/sharing-invite",
    ])
      expect(() => createSharingInviteUrl(token, url, "internal")).toThrow();
  });
  it("rejects malformed tokens before generating any link", () => {
    expect(() => createSharingInviteUrl("bad", undefined, "internal")).toThrow();
  });
});
