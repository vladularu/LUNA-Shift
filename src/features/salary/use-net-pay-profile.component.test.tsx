import * as MockReact from "react";
import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import {
  loadApplicableNetPaySettings,
  saveContinuousNetPaySettings,
} from "@/infrastructure/database/net-pay-profile-repository";
import { useNetPayProfile } from "./use-net-pay-profile";
const mockDb = {};
let mockFocused = true;
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    MockReact.useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]),
}));
jest.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadApplicableNetPaySettings: jest.fn(),
  saveContinuousNetPaySettings: jest.fn(),
}));
const load = jest.mocked(loadApplicableNetPaySettings),
  save = jest.mocked(saveContinuousNetPaySettings);
function snapshot(month = "2026-06", revision = 1) {
  const saved: SavedMonthlyNetPaySettings = {
    settings: automatedSettings(month),
    revision,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };
  return { saved, timeline: [saved] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
describe("effective-dated net profile lifecycle", () => {
  beforeEach(() => {
    mockFocused = true;
    load.mockReset().mockResolvedValue(snapshot());
    save.mockReset().mockResolvedValue(snapshot().saved);
  });
  it("does not read before application readiness", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", false));
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.saved).toBeNull();
  });
  it("discards a delayed response for the previous visible month", async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot("2026-08"));
    const hook = await renderHook(({ month }: { month: string }) => useNetPayProfile(month, true), {
      initialProps: { month: "2026-07" },
    });
    await hook.rerender({ month: "2026-08" });
    await act(async () => pending.resolve(snapshot()));
    expect(hook.result.current.saved!.settings.month).toBe("2026-08");
  });
  it("guards the entire inherited timeline and reloads after a successful write", async () => {
    const previous = snapshot();
    load.mockResolvedValueOnce(previous).mockResolvedValueOnce(snapshot("2026-07", 2));
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    await act(async () => hook.result.current.save(automatedSettings()));
    expect(save).toHaveBeenCalledWith(mockDb, {
      settings: automatedSettings(),
      expectedTimeline: previous.timeline,
    });
    expect(hook.result.current.saved!.revision).toBe(2);
  });
  it("retains the old inherited profile on a write conflict", async () => {
    save.mockRejectedValue(new Error("zwischenzeitlich geändert"));
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    await act(async () => {
      await expect(hook.result.current.save(automatedSettings())).rejects.toThrow(
        "zwischenzeitlich",
      );
    });
    expect(hook.result.current.saved!.settings.month).toBe("2026-06");
    expect(hook.result.current.busy).toBe(false);
  });
  it("keeps the forecast available throughout a focus refresh and applies restored settings", async () => {
    const renderedStatuses: string[] = [];
    const hook = await renderHook(() => {
      const profile = useNetPayProfile("2026-07", true);
      renderedStatuses.push(profile.status);
      return profile;
    });
    const previous = hook.result.current.saved;
    mockFocused = false;
    await hook.rerender(undefined);
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    renderedStatuses.length = 0;
    mockFocused = true;
    await hook.rerender(undefined);
    expect(load).toHaveBeenCalledTimes(2);
    expect(renderedStatuses.length).toBeGreaterThan(0);
    expect(renderedStatuses.every((status) => status === "ready")).toBe(true);
    expect(hook.result.current.saved).toBe(previous);
    const restored = snapshot("2026-06", 3);
    const restoredSaved: SavedMonthlyNetPaySettings = {
      ...restored.saved,
      settings: {
        ...restored.saved.settings,
        profile: { ...restored.saved.settings.profile, taxClass: 3 },
      },
    };
    await act(async () => pending.resolve({ saved: restoredSaved, timeline: [restoredSaved] }));
    expect(hook.result.current.saved!.revision).toBe(3);
    expect(hook.result.current.saved!.settings.profile.taxClass).toBe(3);
    expect(renderedStatuses.every((status) => status === "ready")).toBe(true);
  });
  it("keeps same-month settings visible during an explicit reload", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    const previous = hook.result.current.saved;
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    await act(async () => hook.result.current.reload());
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.saved).toBe(previous);
    await act(async () => pending.resolve(snapshot("2026-07", 2)));
    expect(hook.result.current.saved!.revision).toBe(2);
  });
  it("hides the previous month's forecast until the new month has loaded", async () => {
    const hook = await renderHook(({ month }: { month: string }) => useNetPayProfile(month, true), {
      initialProps: { month: "2026-07" },
    });
    expect(hook.result.current.status).toBe("ready");
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    await hook.rerender({ month: "2026-08" });
    expect(hook.result.current.status).toBe("loading");
    expect(hook.result.current.saved).toBeNull();
    expect(hook.result.current.timeline).toEqual([]);
    await act(async () => pending.resolve(snapshot("2026-08")));
    expect(hook.result.current.saved!.settings.month).toBe("2026-08");
  });
  it("keeps a successful save when an older background read finishes later", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    const previousTimeline = hook.result.current.timeline;
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot("2026-07", 2));
    await act(async () => hook.result.current.reload());
    await act(async () => hook.result.current.save(automatedSettings()));
    expect(save).toHaveBeenCalledWith(mockDb, {
      settings: automatedSettings(),
      expectedTimeline: previousTimeline,
    });
    expect(hook.result.current.saved!.revision).toBe(2);
    await act(async () => pending.resolve(snapshot("2026-06", 1)));
    expect(hook.result.current.saved!.revision).toBe(2);
    expect(hook.result.current.saved!.settings.month).toBe("2026-07");
  });
  it("clears the retained forecast when a background refresh fails", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    mockFocused = false;
    await hook.rerender(undefined);
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    mockFocused = true;
    await hook.rerender(undefined);
    expect(hook.result.current.status).toBe("ready");
    await act(async () => pending.reject(new Error("Database unavailable")));
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.saved).toBeNull();
    expect(hook.result.current.error).toBe("Die Netto-Angaben konnten nicht geladen werden.");
  });
  it("ignores a delayed refresh after another return has already loaded newer settings", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    mockFocused = false;
    await hook.rerender(undefined);
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    mockFocused = true;
    await hook.rerender(undefined);
    mockFocused = false;
    await hook.rerender(undefined);
    load.mockResolvedValueOnce(snapshot("2026-06", 3));
    mockFocused = true;
    await hook.rerender(undefined);
    await act(async () => pending.resolve(snapshot("2026-06", 2)));
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.saved!.revision).toBe(3);
  });
});
