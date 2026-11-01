import { describe, expect, it } from "vitest";
import { redirectAppOpenIntent } from "./app-open-intent";

describe("app and widget resume intents", () => {
  it.each([
    "pflegeshift:///",
    "lunashift:///?month=2026-07",
    "/?month=2026-07",
    "pflegeshift:///widget-day?date=2026-07-08",
    "lunashift://widget-day?date=2026-07-08",
  ])("keeps the mounted navigation for %s", (path) => {
    expect(redirectAppOpenIntent({ path, initial: false })).toBeNull();
    expect(redirectAppOpenIntent({ path, initial: true })).toBe("/");
  });
  it.each([
    "pflegeshift:///sharing-invite?token=abc",
    "lunashift:///auth/callback?code=abc",
    "/salary?month=2026-07",
    "https://example.org/?month=2026-07",
    "other:///widget-day?date=2026-07-08",
    "/?code=abc",
    "malformed://[",
  ])("preserves a targeted or unrecognized link %s", (path) => {
    expect(redirectAppOpenIntent({ path, initial: false })).toBe(path);
  });
});
