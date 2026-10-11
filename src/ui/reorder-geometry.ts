import { moveListItem } from "@/domain/reorder";

export function rowTops(heights: readonly number[]): readonly number[] {
  let top = 0;
  return heights.map((height) => {
    const value = top;
    top += height;
    return value;
  });
}

/** Insertion slots use the centres of the rows left behind by the lifted row. */
export function reorderTarget(
  heights: readonly number[],
  from: number,
  translation: number,
): number {
  const tops = rowTops(heights);
  const centre = tops[from] + heights[from] / 2 + translation;
  const remaining = heights.filter((_, index) => index !== from);
  let top = 0;
  let target = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= remaining.length; index += 1) {
    const candidateDistance = Math.abs(centre - (top + heights[from] / 2));
    if (candidateDistance < distance) {
      target = index;
      distance = candidateDistance;
    }
    top += remaining[index] ?? 0;
  }
  return target;
}

export function reorderOffsets(
  heights: readonly number[],
  from: number,
  to: number,
): readonly number[] {
  const original = heights.map((_, index) => index);
  const order = moveListItem(original, from, to);
  const oldTops = rowTops(heights);
  const newTops = rowTops(order.map((index) => heights[index]));
  return original.map((index) => newTops[order.indexOf(index)] - oldTops[index]);
}
