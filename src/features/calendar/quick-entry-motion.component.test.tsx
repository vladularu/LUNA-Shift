import { describe, expect, it } from "@jest/globals";

import { quickEntryAnchorMotion, quickEntryTransitionDuration } from "./quick-entry-motion";
import { calculateCalendarPopupPlacement } from "./calendar-layout";
import { MOTION } from "@/theme/motion";

describe("quick-entry anchor motion", () => {
  it.each([
    { x: 0, y: 180, height: 116, popupHeight: 106 },
    { x: 310, y: 690, height: 116, popupHeight: 214 },
    { x: 130, y: 180, height: 116, popupHeight: 330 },
  ])("folds against the selected day edge for %o", ({ x, y, height, popupHeight }) => {
    const anchor = { x, y, width: 56, height };
    const popupWidth = 378;
    const placement = calculateCalendarPopupPlacement({
      anchor,
      viewportWidth: 390,
      viewportHeight: 844,
      popupWidth,
      popupHeight,
      topInset: 47,
      bottomInset: 96,
      edgeInset: 6,
    });
    const motion = quickEntryAnchorMotion(anchor, placement, popupHeight);
    const below = placement.direction === "BELOW";
    expect(placement.top + popupHeight / 2 + motion.pivotY + motion.translateY).toBe(
      y + (below ? height : 0),
    );
    expect(motion.pivotY).toBe(((below ? -1 : 1) * popupHeight) / 2);
    expect(motion.translateY < 0).toBe(below);
  });

  it("returns to the same day edge even when the viewport clamps an upper popup", () => {
    const anchor = { x: 20, y: 120, width: 55, height: 160 };
    const placement = { left: 6, top: 70, direction: "ABOVE" as const };
    const motion = quickEntryAnchorMotion(anchor, placement, 214);
    expect(placement.top + 107 + motion.pivotY + motion.translateY).toBe(anchor.y);
  });

  it("keeps small fallback anchors finite and shares the planner timings", () => {
    const motion = quickEntryAnchorMotion(
      { x: 5, y: 8, width: 1, height: 1 },
      { left: 6, top: 20, direction: "BELOW" },
      106,
    );
    expect(Object.values(motion).every(Number.isFinite)).toBe(true);
    expect(quickEntryTransitionDuration(true, false)).toBe(320);
    expect(quickEntryTransitionDuration(false, false)).toBe(240);
    expect(quickEntryTransitionDuration(true, true)).toBe(MOTION.duration.instant);
    expect(quickEntryTransitionDuration(false, true)).toBe(MOTION.duration.instant);
  });
});
