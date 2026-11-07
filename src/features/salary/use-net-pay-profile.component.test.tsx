import * as MockReact from "react";
import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import {
  loadNetPayProfileTimeline,
  saveContinuousNetPaySettings,
  resetAnnualSalaryPayments,
} from "@/infrastructure/database/net-pay-profile-repository";
import { useNetPayProfile } from "./use-net-pay-profile";
import { netPayProfilesChanged } from "@/infrastructure/database/net-pay-profile-events";
import { analysisSalaryInputStore } from "@/features/analysis/analysis-salary-input-store";
let mockDb = {};
let mockFocused = true;
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    MockReact.useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]),
}));
jest.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadNetPayProfileTimeline: jest.fn(),
  saveContinuousNetPaySettings: jest.fn(),
  resetAnnualSalaryPayments: jest.fn(),
}));
const load = jest.mocked(loadNetPayProfileTimeline),
  save = jest.mocked(saveContinuousNetPaySettings),
  resetAnnual = jest.mocked(resetAnnualSalaryPayments);
function snapshot(month = "2026-06", revision = 1) {
  const saved: SavedMonthlyNetPaySettings = {
    settings: automatedSettings(month),
    revision,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  };
  return [saved];
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
    mockDb = {};
    resetAnnual.mockReset().mockImplementation(async () => {
      netPayProfilesChanged(mockDb as Parameters<typeof netPayProfilesChanged>[0]);
    });
    load.mockReset().mockResolvedValue(snapshot());
    save.mockReset().mockImplementation(async () => {
      netPayProfilesChanged(mockDb as Parameters<typeof netPayProfilesChanged>[0]);
      return snapshot()[0];
    });
  });
  it("preserves the editor and its conflict basis while readers receive external changes", async () => {
    const editor = await renderHook(() =>
      useNetPayProfile("2026-07", true, { preserveDraft: true }),
    );
    const reader = await renderHook(() => useNetPayProfile("2026-07", true));
    const original = editor.result.current.timeline;
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    await act(async () =>
      netPayProfilesChanged(mockDb as Parameters<typeof netPayProfilesChanged>[0]),
    );
    expect(editor.result.current.status).toBe("ready");
    expect(editor.result.current.timeline).toBe(original);
    expect(reader.result.current.status).toBe("loading");
    await act(async () => pending.resolve(snapshot("2026-06", 2)));
    expect(reader.result.current.saved!.revision).toBe(2);
    expect(editor.result.current.timeline).toBe(original);
    save.mockRejectedValueOnce(new Error("zwischenzeitlich geändert"));
    await act(async () => {
      await expect(editor.result.current.save(automatedSettings())).rejects.toThrow(
        "zwischenzeitlich",
      );
    });
    expect(save).toHaveBeenCalledWith(mockDb, {
      settings: automatedSettings(),
      expectedTimeline: original,
    });
    expect(editor.result.current.timeline).toBe(original);
    load.mockResolvedValueOnce(snapshot("2026-06", 2));
    await act(async () => editor.result.current.reload());
    expect(editor.result.current.saved!.revision).toBe(2);
  });

  it("keeps the editor mounted during its own committed save until the refreshed data arrives", async () => {
    const editor = await renderHook(() =>
      useNetPayProfile("2026-07", true, { preserveDraft: true }),
    );
    const previous = editor.result.current.saved;
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    let writing!: Promise<void>;
    await act(async () => {
      writing = editor.result.current.save(automatedSettings());
    });
    expect(editor.result.current.status).toBe("ready");
    expect(editor.result.current.saved).toBe(previous);
    expect(editor.result.current.busy).toBe(true);
    await act(async () => {
      pending.resolve(snapshot("2026-07", 2));
      await writing;
    });
    expect(editor.result.current.saved!.revision).toBe(2);
    expect(editor.result.current.busy).toBe(false);
  });

  it("does not release a newer month editor when an older reload finishes", async () => {
    load.mockResolvedValueOnce([...snapshot(), ...snapshot("2026-08", 2)]);
    const editor = await renderHook(
      ({ month }: { month: string }) => useNetPayProfile(month, true, { preserveDraft: true }),
      { initialProps: { month: "2026-07" } },
    );
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    await act(async () => editor.result.current.reload());
    await editor.rerender({ month: "2026-08" });
    const originalAugust = editor.result.current.saved;
    await act(async () => pending.resolve([...snapshot(), ...snapshot("2026-08", 3)]));
    expect(editor.result.current.month).toBe("2026-08");
    expect(editor.result.current.saved).toBe(originalAugust);
    expect(editor.result.current.saved!.revision).toBe(2);
  });

  it("releases a retained editor after an explicit failed reload", async () => {
    const editor = await renderHook(() =>
      useNetPayProfile("2026-07", true, { preserveDraft: true }),
    );
    load.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => editor.result.current.reload());
    expect(editor.result.current.status).toBe("error");
    expect(editor.result.current.saved).toBeNull();
  });

  it("does not read before application readiness", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", false));
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.saved).toBeNull();
  });

  it("projects the current month from one shared pending timeline after navigation", async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    const hook = await renderHook(({ month }: { month: string }) => useNetPayProfile(month, true), {
      initialProps: { month: "2026-07" },
    });
    await hook.rerender({ month: "2026-08" });
    await act(async () => pending.resolve([...snapshot(), ...snapshot("2026-08")]));
    expect(hook.result.current.month).toBe("2026-08");
    expect(hook.result.current.saved!.settings.month).toBe("2026-08");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("guards the entire inherited timeline and reloads after a successful write", async () => {
    const previous = snapshot();
    load.mockResolvedValueOnce(previous).mockResolvedValueOnce(snapshot("2026-07", 2));
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    await act(async () => hook.result.current.save(automatedSettings()));
    expect(save).toHaveBeenCalledWith(mockDb, {
      settings: automatedSettings(),
      expectedTimeline: previous,
    });
    expect(hook.result.current.saved!.revision).toBe(2);
  });
  it("reloads the first profile anchored in January for the visible July", async () => {
    load.mockResolvedValueOnce([]).mockResolvedValueOnce(snapshot("2026-01"));
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    await act(async () => hook.result.current.save(automatedSettings()));
    expect(save).toHaveBeenCalledWith(mockDb, {
      settings: automatedSettings(),
      expectedTimeline: [],
    });
    expect(hook.result.current.month).toBe("2026-07");
    expect(hook.result.current.saved!.settings.month).toBe("2026-01");
  });
  it("writes a chosen effective month while retaining the stale-editor guard", async () => {
    const previous = snapshot();
    load.mockResolvedValueOnce(previous).mockResolvedValueOnce(snapshot("2026-01", 2));
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    await act(async () => hook.result.current.save(automatedSettings(), "2026-01"));
    expect(save).toHaveBeenCalledWith(mockDb, {
      settings: { ...automatedSettings(), month: "2026-01" },
      expectedTimeline: previous,
    });
    await act(async () => {
      await expect(
        hook.result.current.save(automatedSettings("2026-08"), "2026-01"),
      ).rejects.toThrow("erneut laden");
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it.each(["2026-13", "2027-01", "invalid"])(
    "rejects an invalid effective month %s",
    async (month) => {
      const hook = await renderHook(() => useNetPayProfile("2026-07", true));
      await act(async () => {
        await expect(hook.result.current.save(automatedSettings(), month)).rejects.toThrow();
      });
      expect(save).not.toHaveBeenCalled();
      expect(hook.result.current.busy).toBe(false);
    },
  );
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

  it("reuses ready settings on another page and repeated focus changes without another read", async () => {
    const first = await renderHook(() => useNetPayProfile("2026-07", true));
    const statuses: string[] = [];
    const second = await renderHook(() => {
      const profile = useNetPayProfile("2026-07", true);
      statuses.push(profile.status);
      return profile;
    });
    expect(statuses).toEqual(["ready"]);
    expect(second.result.current.saved).toBe(first.result.current.saved);
    mockFocused = false;
    await second.rerender(undefined);
    mockFocused = true;
    await second.rerender(undefined);
    expect(statuses.every((value) => value === "ready")).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("receives committed external changes without requiring navigation", async () => {
    const first = await renderHook(() => useNetPayProfile("2026-07", true));
    const second = await renderHook(() => useNetPayProfile("2026-11", true));
    const updated = snapshot("2026-01", 3);
    load.mockResolvedValueOnce(updated);
    await act(async () =>
      netPayProfilesChanged(mockDb as Parameters<typeof netPayProfilesChanged>[0]),
    );
    expect(first.result.current.saved!.revision).toBe(3);
    expect(second.result.current.saved!.revision).toBe(3);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("shares a pending read and keeps it alive for another page after unmount", async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    const first = await renderHook(() => useNetPayProfile("2026-07", true));
    const second = await renderHook(() => useNetPayProfile("2026-08", true));
    await first.unmount();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(snapshot()));
    expect(second.result.current.status).toBe("ready");
    expect(second.result.current.saved!.settings.month).toBe("2026-06");
  });
  it("isolates settings belonging to different database connections", async () => {
    const first = await renderHook(() => useNetPayProfile("2026-07", true));
    await first.unmount();
    mockDb = {};
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    const second = await renderHook(() => useNetPayProfile("2026-07", true));
    expect(second.result.current.status).toBe("loading");
    expect(second.result.current.saved).toBeNull();
    await act(async () => pending.resolve(snapshot("2026-01", 5)));
    expect(second.result.current.saved!.revision).toBe(5);
  });
  it("uses the timeline already prepared by the monthly overview", async () => {
    await analysisSalaryInputStore(
      mockDb as Parameters<typeof analysisSalaryInputStore>[0],
    ).ensure();
    const statuses: string[] = [];
    const hook = await renderHook(() => {
      const profile = useNetPayProfile("2026-07", true);
      statuses.push(profile.status);
      return profile;
    });
    expect(statuses).toEqual(["ready"]);
    expect(hook.result.current.saved!.settings.month).toBe("2026-06");
    expect(load).toHaveBeenCalledTimes(1);
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

  it("selects each month's actual dated profile from the warm complete timeline", async () => {
    load.mockResolvedValueOnce([...snapshot(), ...snapshot("2026-08", 2)]);
    const hook = await renderHook(({ month }: { month: string }) => useNetPayProfile(month, true), {
      initialProps: { month: "2026-07" },
    });
    expect(hook.result.current.saved!.settings.month).toBe("2026-06");
    await hook.rerender({ month: "2026-08" });
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.saved!.settings.month).toBe("2026-08");
    await hook.rerender({ month: "2026-05" });
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.saved).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
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

  it("clears retained settings after a failed explicit reload and allows retry", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    await act(async () => hook.result.current.reload());
    expect(hook.result.current.status).toBe("ready");
    await act(async () => pending.reject(new Error("Database unavailable")));
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.saved).toBeNull();
    expect(hook.result.current.error).toBe("Die Netto-Angaben konnten nicht geladen werden.");
    await act(async () => hook.result.current.reload());
    expect(hook.result.current.status).toBe("ready");
  });

  it("ignores a delayed read when a newer committed timeline has already loaded", async () => {
    const hook = await renderHook(() => useNetPayProfile("2026-07", true));
    const pending = deferred<ReturnType<typeof snapshot>>();
    load.mockReturnValueOnce(pending.promise);
    await act(async () => hook.result.current.reload());
    load.mockResolvedValueOnce(snapshot("2026-06", 3));
    await act(async () =>
      netPayProfilesChanged(mockDb as Parameters<typeof netPayProfilesChanged>[0]),
    );
    await act(async () => pending.resolve(snapshot("2026-06", 2)));
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.saved!.revision).toBe(3);
  });

  it("uses the complete snapshot when resetting the visible cash year and reloads the result", async () => {
    const before = snapshot();
    load.mockResolvedValueOnce(before).mockResolvedValueOnce(snapshot("2026-06", 2));
    const hook = await renderHook(() => useNetPayProfile("2026-11", true));
    await act(async () => hook.result.current.resetAnnualPayments());
    expect(resetAnnual).toHaveBeenCalledWith(mockDb, {
      year: 2026,
      expectedTimeline: before,
    });
    expect(hook.result.current.saved!.revision).toBe(2);
    expect(hook.result.current.busy).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
  it("retains own payment data on reset failure and permits retry", async () => {
    resetAnnual.mockRejectedValueOnce(new Error("conflict"));
    const hook = await renderHook(() => useNetPayProfile("2026-11", true));
    const before = hook.result.current.saved;
    await act(async () => {
      await expect(hook.result.current.resetAnnualPayments()).rejects.toThrow("conflict");
    });
    expect(hook.result.current.saved).toBe(before);
    expect(hook.result.current.busy).toBe(false);
    await act(async () => hook.result.current.resetAnnualPayments());
    expect(resetAnnual).toHaveBeenCalledTimes(2);
  });
  it("prevents a second reset during an in-flight mutation", async () => {
    const pending = deferred<void>();
    resetAnnual.mockImplementationOnce(async () => {
      await pending.promise;
      netPayProfilesChanged(mockDb as Parameters<typeof netPayProfilesChanged>[0]);
    });
    const hook = await renderHook(() => useNetPayProfile("2026-11", true));
    let writing!: Promise<void>;
    await act(async () => {
      writing = hook.result.current.resetAnnualPayments();
    });
    await act(async () => {
      await expect(hook.result.current.resetAnnualPayments()).rejects.toThrow("erneut laden");
    });
    await act(async () => {
      pending.resolve();
      await writing;
    });
    expect(resetAnnual).toHaveBeenCalledTimes(1);
    expect(hook.result.current.busy).toBe(false);
  });
});
