import { describe, expect, it, vi } from "vitest";
import { createStartupPresentation } from "./startup-presentation";

describe("cold-start presentation barrier", () => {
  it("holds background work until the complete first view and releases it only once", async () => {
    const startup = createStartupPresentation();
    startup.begin();
    const run = vi.fn();
    startup.after(run);
    const waiting = startup.wait();
    expect(startup.isReady()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    startup.complete();
    await waiting;
    startup.complete();
    expect(run).toHaveBeenCalledTimes(1);
    expect(startup.isReady()).toBe(true);
  });

  it("cancels stale work from an unmounted provider", () => {
    const startup = createStartupPresentation();
    startup.begin();
    const run = vi.fn();
    startup.after(run)();
    startup.complete();
    expect(run).not.toHaveBeenCalled();
  });

  it("allows later navigation and independent consumers without a startup hold", async () => {
    const startup = createStartupPresentation();
    const run = vi.fn();
    startup.after(run);
    await startup.wait();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
