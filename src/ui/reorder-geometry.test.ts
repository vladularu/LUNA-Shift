import { describe, expect, it } from "vitest";
import { reorderOffsets, reorderTarget } from "./reorder-geometry";

describe("measured reorder slots", () => {
  it("keeps every row in place until the finger crosses half the adjacent slot", () => {
    for (let index = 0; index < 4; index += 1)
      expect(reorderTarget([72, 72, 72, 72], index, 0)).toBe(index);
    expect(reorderTarget([72, 72, 72], 0, 35)).toBe(0);
    expect(reorderTarget([72, 72, 72], 0, 37)).toBe(1);
  });
  it("supports moving across multiple rows and clamps at both ends", () => {
    expect(reorderTarget([72, 72, 72, 72], 0, 220)).toBe(3);
    expect(reorderTarget([72, 72, 72, 72], 3, -1000)).toBe(0);
    expect(reorderTarget([72, 72, 72, 72], 1, 1000)).toBe(3);
  });
  it("uses actual dynamic type heights, including unequal rows", () => {
    expect(reorderTarget([60, 120, 90], 1, 0)).toBe(1);
    expect(reorderTarget([60, 120, 90], 1, 46)).toBe(2);
    expect(reorderOffsets([60, 120, 90], 1, 2)).toEqual([0, 90, -120]);
    expect(reorderOffsets([60, 120, 90], 2, 0)).toEqual([90, 90, -180]);
  });
  it("moves only the rows between the old and new slot", () => {
    expect(reorderOffsets([72, 72, 72, 72], 0, 2)).toEqual([144, -72, -72, 0]);
    expect(reorderOffsets([72, 72, 72, 72], 3, 1)).toEqual([0, 72, 72, -144]);
  });
});
