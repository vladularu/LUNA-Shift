import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStartupPresentation,
  hideStartupSplash,
  STARTUP_SPLASH_FADE_MS,
} from "./startup-presentation";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it.each([false, true])(
    "defers native appearance until the splash fade ends (hide rejects: %s)",
    async (reject) => {
      vi.useFakeTimers();
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        frames.push(callback),
      );
      const startup = createStartupPresentation();
      startup.begin();
      const apply = vi.fn();
      startup.afterSplash(apply);
      startup.complete();
      const hide = vi.fn(() =>
        reject ? Promise.reject(new Error("no splash")) : Promise.resolve(),
      );
      await hideStartupSplash(hide, startup);
      vi.advanceTimersByTime(STARTUP_SPLASH_FADE_MS - 1);
      expect(apply).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(apply).not.toHaveBeenCalled();
      frames.forEach((callback) => callback(STARTUP_SPLASH_FADE_MS));
      expect(apply).toHaveBeenCalledTimes(1);
      startup.finishSplash();
      expect(apply).toHaveBeenCalledTimes(1);
      const later = vi.fn();
      startup.afterSplash(later);
      expect(later).toHaveBeenCalledTimes(1);
    },
  );

  it("does not apply a stale native appearance from an unmounted provider", () => {
    const startup = createStartupPresentation();
    startup.begin();
    const apply = vi.fn();
    startup.afterSplash(apply)();
    startup.complete();
    startup.finishSplash();
    expect(apply).not.toHaveBeenCalled();
  });
});
