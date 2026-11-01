import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import configureApp from "../../app.config";
import { buildCalendarWidgetTimeline } from "@/features/widgets/calendar-widget-data";
import { redirectAppOpenIntent } from "./app-open-intent";

import { appResumeStore } from "./app-resume-storage";
vi.mock("./app-resume-storage", () => ({ appResumeStore: { load: vi.fn() } }));

describe("app and widget resume intents", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appResumeStore.load).mockResolvedValue(null);
  });
  it.each(["internal", "production"])(
    "handles links actually produced by the %s widget configuration",
    async (variant) => {
      vi.stubEnv("APP_VARIANT", variant);
      vi.stubEnv("LUNA_DESIGN_SANDBOX", "0");
      const { scheme } = configureApp({
        config: { name: "LUNA Shift", slug: "pflegeshift" },
        projectRoot: process.cwd(),
        staticConfigPath: null,
        packageJsonPath: "package.json",
      });
      const schemes = typeof scheme === "string" ? [scheme] : scheme!;
      vi.mocked(appResumeStore.load).mockResolvedValue({
        version: 1,
        href: "/analysis?month=2026-08&period=MONTH",
        scrollY: 640,
      });
      for (const appScheme of schemes) {
        const timeline = buildCalendarWidgetTimeline({
          entries: [],
          now: new Date("2026-11-01T12:00:00Z"),
          timeZone: "Europe/Berlin",
          scheme: appScheme,
          hasProfile: true,
        });
        const link = timeline[0].props.url;
        expect(redirectAppOpenIntent({ path: link, initial: false })).toBeNull();
        expect(await redirectAppOpenIntent({ path: link, initial: true })).toBe("/");
        expect(
          await redirectAppOpenIntent({
            path: `${appScheme}:///widget-day?date=2026-11-01`,
            initial: true,
          }),
        ).toBe("/");
        expect(
          redirectAppOpenIntent({ path: `${appScheme}:///auth/callback?code=abc`, initial: false }),
        ).toBe(`${appScheme}:///auth/callback?code=abc`);
      }
      expect(appResumeStore.load).not.toHaveBeenCalled();
    },
  );
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
    expect(redirectAppOpenIntent({ path, initial: true })).toBe(path);
  });
});

it.each(["pflegeshift:///", "lunashift:///?month=2026-07", "/widget-day?date=2026-07-08"])(
  "opens the calendar after a cold launch from %s despite a saved analysis view",
  async (path) => {
    vi.mocked(appResumeStore.load).mockResolvedValue({
      version: 1,
      href: "/analysis?month=2026-11&period=YEAR",
      scrollY: 640,
    });
    expect(await redirectAppOpenIntent({ path, initial: true })).toBe("/");
    expect(redirectAppOpenIntent({ path, initial: false })).toBeNull();
    expect(appResumeStore.load).not.toHaveBeenCalled();
  },
);
