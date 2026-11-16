import { describe, expect, it } from "vitest";

import { indexRestIntervals, observedRestMinutes } from "@/engine/compliance-rest-intervals";

const hour = 3_600_000;

describe("indexed rest intervals", () => {
  it("does not infer rest without both adjacent work boundaries", () => {
    expect(observedRestMinutes(24 * hour, 48 * hour, indexRestIntervals([]))).toBeNull();
    expect(
      observedRestMinutes(24 * hour, 48 * hour, indexRestIntervals([{ start: 0, end: 8 * hour }])),
    ).toBeNull();
    expect(
      observedRestMinutes(
        24 * hour,
        48 * hour,
        indexRestIntervals([{ start: 48 * hour, end: 56 * hour }]),
      ),
    ).toBeNull();
  });

  it("includes exact midnight boundaries and the greatest previous end", () => {
    const intervals = [
      { start: 0, end: 24 * hour },
      { start: 8 * hour, end: 16 * hour },
      { start: 48 * hour, end: 56 * hour },
      { start: 49 * hour, end: 60 * hour },
    ];
    expect(observedRestMinutes(24 * hour, 48 * hour, indexRestIntervals(intervals))).toBe(24 * 60);
    expect(intervals[0].end).toBe(24 * hour);
  });

  it("skips intervals intersecting the day and uses earliest following work", () => {
    const intervals = [
      { start: 0, end: 8 * hour },
      { start: 20 * hour, end: 28 * hour },
      { start: 44 * hour, end: 52 * hour },
      { start: 56 * hour, end: 64 * hour },
    ];
    expect(observedRestMinutes(24 * hour, 48 * hour, indexRestIntervals(intervals))).toBe(48 * 60);
  });

  it("matches the former scan across 500 deterministic overlapping schedules", () => {
    let seed = 0x5eed2026;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let sample = 0; sample < 500; sample++) {
      const intervals = Array.from({ length: Math.floor(random() * 40) }, () => {
        const start = Math.floor(random() * 2000) * 60_000;
        return { start, end: start + (1 + Math.floor(random() * 500)) * 60_000 };
      }).sort((a, b) => a.start - b.start);
      const start = Math.floor(random() * 2000) * 60_000;
      const end = start + (23 + Math.floor(random() * 3)) * hour;
      const before = intervals.filter((item) => item.end <= start).map((item) => item.end);
      const after = intervals.find((item) => item.start >= end);
      const expected =
        before.length && after ? Math.round((after.start - Math.max(...before)) / 60_000) : null;
      expect(observedRestMinutes(start, end, indexRestIntervals(intervals))).toBe(expected);
    }
  });
});
