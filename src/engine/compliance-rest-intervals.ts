export interface RestIntervalIndex {
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

export function indexRestIntervals(
  intervals: readonly { readonly start: number; readonly end: number }[],
): RestIntervalIndex {
  return {
    starts: intervals.map((interval) => interval.start).sort((a, b) => a - b),
    ends: intervals.map((interval) => interval.end).sort((a, b) => a - b),
  };
}

/** Respect half-open work intervals; overlapping duties need the greatest prior end. */
export function observedRestMinutes(
  start: number,
  end: number,
  index: RestIntervalIndex,
): number | null {
  let left = 0;
  let right = index.ends.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (index.ends[middle] <= start) left = middle + 1;
    else right = middle;
  }
  if (left === 0) return null;
  const previousEnd = index.ends[left - 1];
  left = 0;
  right = index.starts.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (index.starts[middle] < end) left = middle + 1;
    else right = middle;
  }
  if (left === index.starts.length) return null;
  return Math.round((index.starts[left] - previousEnd) / 60_000);
}
