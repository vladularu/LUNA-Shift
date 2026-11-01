import { describe, expect, it } from "vitest";
import { appResumeHref, createAppResumeStore, parseAppResumeState } from "./app-resume-state";

describe("cold app resume", () => {
  it("survives a terminated process with the analysis month, period and scroll position", async () => {
    let disk: string | null = null;
    const storage = {
      read: async () => disk,
      write: async (value: string | null) => {
        disk = value;
      },
    };
    const firstProcess = createAppResumeStore(storage);
    await firstProcess.load();
    const href = appResumeHref("/analysis", { month: "2026-11", period: "YEAR" })!;
    await firstProcess.record(href);
    firstProcess.scroll(href, 640);
    await firstProcess.flush(); // inactive/background checkpoint before force-quit
    const secondProcess = createAppResumeStore(storage);
    expect(await secondProcess.load()).toEqual({ version: 1, href, scrollY: 640 });
    await secondProcess.record(href);
    expect(secondProcess.current()?.scrollY).toBe(640);
    await secondProcess.record("/templates");
    expect(secondProcess.current()?.scrollY).toBe(0);
    await secondProcess.clear();
    expect(await createAppResumeStore(storage).load()).toBeNull();
  });
  it("serializes writes so an older route cannot replace the last view", async () => {
    let finish: (() => void) | undefined;
    let disk: string | null = null;
    const store = createAppResumeStore({
      read: async () => null,
      write: async (value) => {
        if (!finish)
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        disk = value;
      },
    });
    await store.load();
    const first = store.record("/templates");
    await Promise.resolve();
    const second = store.record("/more");
    finish!();
    await Promise.all([first, second]);
    expect(parseAppResumeState(disk)?.href).toBe("/more");
  });
  it.each(["/shift-editor", "/auth/callback", "/sharing-invite", "/onboarding", "//evil.example"])(
    "does not store transient or external destination %s",
    (path) => {
      expect(appResumeHref(path, { token: "secret", code: "secret" })).toBeNull();
    },
  );
  it("persists only validated display parameters", () => {
    expect(appResumeHref("/analysis", { month: "2026-13", period: "BAD", token: "secret" })).toBe(
      "/analysis",
    );
    expect(
      parseAppResumeState(JSON.stringify({ version: 1, href: "/analysis?token=secret" })),
    ).toBeNull();
    expect(parseAppResumeState('{"version":9,"href":"/analysis"}')).toBeNull();
    expect(parseAppResumeState("broken")).toBeNull();
  });
  it("falls back safely when native storage cannot be read or written", async () => {
    const store = createAppResumeStore({
      read: async () => {
        throw Error("locked");
      },
      write: async () => {
        throw Error("full");
      },
    });
    expect(await store.load()).toBeNull();
    await expect(store.record("/analysis")).resolves.toBeUndefined();
  });
});
