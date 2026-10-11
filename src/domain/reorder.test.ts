import { describe, expect, it } from "vitest";
import { moveListItem } from "./reorder";

describe("moving list slots", () => {
  const items = Object.freeze(["early", "late", "night", "day"]);
  it("moves across multiple slots without swapping away the intervening order", () => {
    expect(moveListItem(items, 0, 3)).toEqual(["late", "night", "day", "early"]);
    expect(moveListItem(items, 3, 0)).toEqual(["day", "early", "late", "night"]);
    expect(items).toEqual(["early", "late", "night", "day"]);
  });
  it.each([
    [-1, 0],
    [0, 4],
    [0, -1],
    [4, 0],
    [1.5, 2],
    [0, NaN],
    [1, 1],
  ])("keeps the same list for an invalid or unchanged move %s → %s", (from, to) =>
    expect(moveListItem(items, from, to)).toBe(items),
  );
});
