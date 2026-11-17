import { describe, expect, it } from "vitest";
import { quickEntryCenteredOffset, quickEntryStripLayout } from "./quick-entry-strip-layout";
import { QUICK_PLANNER_METRICS } from "./quick-planner-appearance";
import { TEXT_MAX_SCALE } from "@/theme/typography";

describe("five-place sizing with individual-service scrolling", () => {
  it.each([304, 360, 374, 414])(
    "keeps five full places and a whole time column at %s points",
    (width) => {
      const idle = quickEntryStripLayout({
        viewportWidth: width,
        actionCount: 13,
        activeIndex: -1,
        fontScale: 1,
      });
      const selected = quickEntryStripLayout({
        viewportWidth: width,
        actionCount: 13,
        activeIndex: 7,
        fontScale: 1,
      });
      expect(idle.slotWidth * 5).toBeCloseTo(width, 8);
      expect(selected.slotWidth).toBe(idle.slotWidth);
      expect(selected.detailWidth).toBe(selected.slotWidth);
      expect(selected.contentWidth).toBe(idle.contentWidth);
      expect(selected.snapToOffsets).toHaveLength(10);
      expect(selected.snapToOffsets[1]).toBe(selected.slotWidth);
      // Opening still occupies one extra place without making five-item pages.
      expect(selected.slotWidth * 4 + selected.detailWidth).toBeCloseTo(width, 8);
    },
  );

  it.each([0, 1, 4, 5, 6, 9, 10, 11, 13, 15])(
    "reserves stable native bounds without blank end stops for %s templates",
    (count) => {
      const idle = quickEntryStripLayout({
        viewportWidth: 410,
        actionCount: count,
        activeIndex: -1,
        fontScale: 1,
      });
      const selected = quickEntryStripLayout({
        viewportWidth: 410,
        actionCount: count,
        activeIndex: count - 1,
        fontScale: 1,
      });
      expect(selected.contentWidth).toBe(idle.contentWidth);
      expect(idle.snapToOffsets).toHaveLength(Math.max(0, count - 5) + 1);
      expect(selected.snapToOffsets).toHaveLength(Math.max(0, count + (count > 0 ? 1 : 0) - 5) + 1);
      for (const x of selected.snapToOffsets) {
        expect(x / selected.slotWidth).toBeCloseTo(Math.round(x / selected.slotWidth), 8);
        expect(x + 410).toBeLessThanOrEqual(selected.contentWidth);
      }
      expect(idle.snapToOffsets.at(-1)).toBe(idle.maximumOffset);
      expect(selected.snapToOffsets.at(-1)).toBe(selected.maximumOffset);
    },
  );

  it("reserves whole additional columns for larger system text", () => {
    const layout = quickEntryStripLayout({
      viewportWidth: 304,
      actionCount: 8,
      activeIndex: 2,
      fontScale: 2,
    });
    expect(layout.detailWidth).toBeGreaterThanOrEqual(
      QUICK_PLANNER_METRICS.activeDetailWidth * Math.min(2, TEXT_MAX_SCALE),
    );
    expect(layout.detailWidth / layout.slotWidth).toBe(
      Math.round(layout.detailWidth / layout.slotWidth),
    );
    expect(layout.slotWidth * 5).toBe(304);
  });

  it("keeps fallback measurements finite and ignores a missing active template", () => {
    const layout = quickEntryStripLayout({
      viewportWidth: Number.NaN,
      actionCount: 5,
      activeIndex: 99,
      fontScale: Number.NaN,
    });
    expect(layout.viewportWidth).toBe(320);
    expect(layout.snapToOffsets).toEqual([0]);
    expect([layout.slotWidth, layout.detailWidth, layout.contentWidth].every(Number.isFinite)).toBe(
      true,
    );
  });
});

describe("centering the reference service and time pair", () => {
  it.each([
    { index: 4, expanded: true, target: 205 },
    { index: 4, expanded: false, target: 164 },
    { index: 7, expanded: true, target: 451 },
    { index: 7, expanded: false, target: 410 },
    { index: 9, expanded: true, target: 615 },
    { index: 9, expanded: false, target: 574 },
  ])("centers service $index with expanded=$expanded", ({ index, expanded, target }) => {
    const layout = quickEntryStripLayout({
      viewportWidth: 410,
      actionCount: 13,
      activeIndex: expanded ? index : -1,
      fontScale: 1,
    });
    const offset = quickEntryCenteredOffset({ layout, activeIndex: index, expanded });
    expect(offset).toBe(target);
    expect(index * 82 + (expanded ? 82 : 41) - offset!).toBe(205);
  });

  it.each([
    { index: 0, expanded: true, target: 0 },
    { index: 12, expanded: true, target: 738 },
    { index: 12, expanded: false, target: 656 },
  ])(
    "clamps service $index expanded=$expanded to the actual list",
    ({ index, expanded, target }) => {
      const layout = quickEntryStripLayout({
        viewportWidth: 410,
        actionCount: 13,
        activeIndex: expanded ? index : -1,
        fontScale: 1,
      });
      expect(quickEntryCenteredOffset({ layout, activeIndex: index, expanded })).toBe(target);
    },
  );

  it("centers the complete pair for larger system text", () => {
    const layout = quickEntryStripLayout({
      viewportWidth: 304,
      actionCount: 13,
      activeIndex: 4,
      fontScale: 2,
    });
    const offset = quickEntryCenteredOffset({ layout, activeIndex: 4, expanded: true });
    expect(
      4 * layout.slotWidth + (layout.slotWidth + layout.detailWidth) / 2 - offset!,
    ).toBeCloseTo(152, 8);
    expect(quickEntryCenteredOffset({ layout, activeIndex: -1, expanded: false })).toBeNull();
  });
});
