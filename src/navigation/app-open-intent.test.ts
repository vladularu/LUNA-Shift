import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectAppOpenIntent } from "./app-open-intent";

import { appResumeStore } from "./app-resume-storage";
vi.mock("./app-resume-storage", () => ({ appResumeStore: { load: vi.fn() } }));

describe("app and widget resume intents", () => {
  beforeEach(() => {
    vi.mocked(appResumeStore.load).mockResolvedValue(null);
  });
  it.each([
    "pflegeshift:///",
    "lunashift:///?month=2026-07",
    "/?month=2026-07",
    "pflegeshift:///widget-day?date=2026-07-08",
    "lunashift://widget-day?date=2026-07-08",
  ])("keeps the mounted navigation for %s", async (path) => {
    expect(redirectAppOpenIntent({ path, initial: false })).toBeNull();
    expect(await redirectAppOpenIntent({ path, initial: true })).toBe("/");
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

it.each(["pflegeshift:///", "lunashift:///?month=2026-07", "/widget-day?date=2026-07-08"])(
  "restores the same last view after a cold launch from %s",
  async (path) => {
    vi.mocked(appResumeStore.load).mockResolvedValue({
      version: 1,
      href: "/analysis?month=2026-11&period=YEAR",
      scrollY: 640,
    });
    expect(await redirectAppOpenIntent({ path, initial: true })).toBe(
      "/analysis?month=2026-11&period=YEAR",
    );
    expect(redirectAppOpenIntent({ path, initial: false })).toBeNull();
  },
);
