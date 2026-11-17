import { describe, expect, it } from "vitest";
import { createNavigationPerformance, performanceScreen } from "./navigation-performance";

const frame = {
  duration: 500,
  count: 30,
  maximum: 16.7,
  over17: 0,
  over34: 0,
  over50: 0,
  missed60: 0,
};
describe("navigation performance", () => {
  it("keeps frame windows through page changes and exposes actual rather than capped cadence", () => {
    let t = 20;
    const r = createNavigationPerformance(() => t);
    r.start(1);
    r.screen(1, 1);
    t += 500;
    r.frame(1, frame);
    r.screen(1, 2);
    t += 500;
    r.frame(1, { ...frame, count: 60 });
    expect(r.getSnapshot().fps).toBe(120);
    expect(r.report().windows.map((w) => w.screen)).toEqual([1, 2]);
    expect(r.report().changes).toEqual([
      { t: 0, from: -1, to: 1 },
      { t: 500, from: 1, to: 2 },
    ]);
    r.setVisible(false);
    r.frame(1, frame);
    expect(r.report().windows).toHaveLength(3);
  });
  it("fences queued callbacks after stop and restart while preserving a stopped report", () => {
    const r = createNavigationPerformance(() => 10);
    r.start(1);
    r.frame(1, frame);
    r.start(0);
    r.frame(1, frame);
    expect(r.report().windows).toHaveLength(1);
    r.start(2);
    r.frame(1, frame);
    r.lag(1, 50);
    expect(r.report().windows).toEqual([]);
    expect(r.getSnapshot().jsLag).toBe(0);
    r.frame(2, frame);
    r.clear();
    expect(r.report().windows).toEqual([]);
  });
  it("bounds output and rejects invalid samples or screen identifiers", () => {
    const r = createNavigationPerformance(() => 0);
    r.start(1);
    for (let i = 0; i < 1300; i++) {
      r.frame(1, frame);
      r.screen(1, i % 2);
    }
    expect(r.report().windows).toHaveLength(1200);
    expect(r.report().changes).toHaveLength(300);
    r.frame(1, { ...frame, maximum: NaN });
    r.frame(1, { ...frame, count: -1 });
    r.screen(1, 123);
    r.lag(1, Infinity);
    expect(r.report().windows).toHaveLength(1200);
    expect(r.getSnapshot().screen).toBe(1);
  });
  it("exports only allowlisted screen codes and copied windows, never parameters", () => {
    expect(performanceScreen(["(tabs)", "(analysis)", "analysis"])).toBe(2);
    expect(performanceScreen(["salary-details"])).toBe(6);
    expect(performanceScreen(["private-user-name", "secret"])).toBe(0);
    const r = createNavigationPerformance(() => 0);
    r.start(1);
    r.frame(1, frame);
    r.report().windows.length = 0;
    expect(r.report().windows).toHaveLength(1);
  });
});
