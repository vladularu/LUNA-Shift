import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { horizontalBackGestureOptions } from "./horizontal-back-gesture";

const layout = readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8");

describe("horizontal card back gestures", () => {
  it("preserves native back while reserving report surfaces for chronological paging", () => {
    const cards = Array.from(layout.matchAll(/<Stack\.Screen\b([\s\S]*?)\/>/g))
      .map((match) => match[1])
      .filter((screen) => screen.includes('presentation: "card"'));
    expect(cards.length).toBe(21);
    for (const card of cards) {
      const name = /name="([^"]+)"/.exec(card)?.[1];
      expect(name).toBeDefined();
      if (name === "quick-add") continue;
      expect(horizontalBackGestureOptions(name!), name).toMatchObject({
        gestureEnabled: true,
        fullScreenGestureEnabled: name !== "salary" && name !== "salary-details",
      });
    }
    expect(layout).toContain("...horizontalBackGestureOptions(route.name)");
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
    "shift-selection",
    "location-picker",
    "onboarding",
    "dev-tools",
  ])("preserves the existing gestures of %s", (route) => {
    expect(horizontalBackGestureOptions(route)).toBeUndefined();
  });

  it.each(["check-profile", "check-settings", "private-cloud", "widget-day", "calendar-prototype"])(
    "also enables the back gesture for the automatically registered card %s",
    (route) => {
      expect(horizontalBackGestureOptions(route)).toEqual({
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      });
    },
  );
});
