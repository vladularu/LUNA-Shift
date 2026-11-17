import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { horizontalBackGestureOptions } from "./horizontal-back-gesture";

const layout = readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8");

describe("horizontal card back gestures", () => {
  it("enables full-screen native back on card submenus without horizontal inputs", () => {
    const cards = Array.from(layout.matchAll(/<Stack\.Screen\b([\s\S]*?)\/>/g))
      .map((match) => match[1])
      .filter((screen) => screen.includes('presentation: "card"'));
    expect(cards.length).toBe(24);
    expect(cards.some((card) => /name="salary-payment"/.test(card))).toBe(true);
    expect(cards.some((card) => /name="calendar-access"/.test(card))).toBe(true);
    for (const card of cards) {
      const name = /name="([^"]+)"/.exec(card)?.[1];
      expect(name).toBeDefined();
      if (name === "quick-add" || name === "calendar-design") continue;
      expect(horizontalBackGestureOptions(name!), name).toMatchObject({
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      });
    }
    expect(layout).toContain("...horizontalBackGestureOptions(route.name)");
  });
  it("keeps native content-pop active only at the calendar edge, away from the photo slider", () => {
    expect(horizontalBackGestureOptions("calendar-design")).toEqual({
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
      gestureResponseDistance: { start: 0, end: 32 },
    });
  });

  it.each([
    "salary",
    "salary-details",
    "worktime-details",
    "annual-details",
    "premium-details",
    "compliance-details",
  ])("keeps %s available underneath a native back gesture", (route) => {
    expect(horizontalBackGestureOptions(route)).toMatchObject({ freezeOnBlur: true });
  });

  it.each([
    "(tabs)",
    "quick-add",
    "day-editor",
    "shift-editor",
    "appointment-editor",
    "day-details",
    "info-details",
    "tariff-assessment",
    "check-issue",
    "shift-selection",
    "location-picker",
    "onboarding",
    "dev-tools",
  ])("preserves the existing gestures of %s", (route) => {
    expect(horizontalBackGestureOptions(route)).toBeUndefined();
  });

  it.each([
    "net-pay-settings",
    "salary-payment",
    "check-profile",
    "check-settings",
    "private-cloud",
    "widget-day",
    "calendar-prototype",
  ])("also enables the back gesture for the automatically registered card %s", (route) => {
    expect(horizontalBackGestureOptions(route)).toEqual({
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
    });
  });
});
