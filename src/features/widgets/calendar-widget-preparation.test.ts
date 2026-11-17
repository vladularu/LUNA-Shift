import { describe, expect, it, vi } from "vitest";
import { prepareWidgetWork } from "./calendar-widget-preparation";

describe("cooperative widget preparation", () => {
  it("lets other work run between short slices and excludes waiting from measured CPU time", async () => {
    let time = 0;
    let turns = 0;
    const slices: number[] = [];
    function* work() {
      for (let index = 0; index < 10; index += 1) {
        time += 3;
        yield;
      }
      return "complete";
    }
    const result = await prepareWidgetWork(work(), {
      isCurrent: () => true,
      clock: () => time,
      pause: async () => {
        time += 100;
        turns += 1;
      },
      onSlice: (duration) => slices.push(duration),
    });
    expect(result).toBe("complete");
    expect(turns).toBeGreaterThan(1);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(30);
    expect(Math.max(...slices)).toBeLessThanOrEqual(6);
  });

  it("closes a superseded preparation before another slice can publish old data", async () => {
    let time = 0;
    let turns = 0;
    let steps = 0;
    let closed = false;
    function* work() {
      try {
        while (steps < 20) {
          steps += 1;
          time += 3;
          yield;
        }
        return "stale";
      } finally {
        closed = true;
      }
    }
    const result = await prepareWidgetWork(work(), {
      isCurrent: () => turns < 2,
      clock: () => time,
      pause: async () => {
        turns += 1;
      },
    });
    expect(result).toBeNull();
    expect(steps).toBe(2);
    expect(closed).toBe(true);
  });

  it("finishes a background flush without waiting for foreground idle callbacks", async () => {
    const pause = vi.fn(async () => {});
    function* work() {
      for (let i = 0; i < 100; i += 1) yield;
      return "background";
    }
    expect(
      await prepareWidgetWork(work(), {
        isCurrent: () => true,
        foreground: () => false,
        pause,
      }),
    ).toBe("background");
    expect(pause).not.toHaveBeenCalled();
  });

  it("reports an indivisible long step rather than claiming a hard slice-time guarantee", async () => {
    let time = 0;
    const slices: number[] = [];
    function* work() {
      time += 42;
      yield;
      return "done";
    }
    expect(
      await prepareWidgetWork(work(), {
        isCurrent: () => true,
        pause: async () => {},
        clock: () => time,
        onSlice: (duration) => slices.push(duration),
      }),
    ).toBe("done");
    expect(Math.max(...slices)).toBe(42);
  });

  it("propagates preparation failures while closing the generator", async () => {
    let closed = false;
    function* work(): Generator<void, string> {
      try {
        yield;
        throw new Error("prepare failed");
      } finally {
        closed = true;
      }
    }
    await expect(
      prepareWidgetWork(work(), { isCurrent: () => true, pause: async () => {} }),
    ).rejects.toThrow("prepare failed");
    expect(closed).toBe(true);
  });
});
