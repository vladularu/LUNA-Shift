import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import {
  loadWorkingTimeTargetSettings,
  saveWorkingTimeTargetSettings,
} from "@/infrastructure/database/working-time-target-repository";
import { useWorkingTimeTargetSettings } from "./use-working-time-target-settings";
const mockDb = {};
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => mockDb }));
jest.mock("@/infrastructure/database/working-time-target-repository", () => ({
  loadWorkingTimeTargetSettings: jest.fn(),
  saveWorkingTimeTargetSettings: jest.fn(),
}));
const load = jest.mocked(loadWorkingTimeTargetSettings),
  save = jest.mocked(saveWorkingTimeTargetSettings);
const empty: WorkingTimeTargetSnapshot = {
  saved: null,
  context: undefined,
  planRevision: "plan",
  staleDates: [],
};
describe("target settings editor lifecycle", () => {
  beforeEach(() => {
    load.mockReset().mockResolvedValue(empty);
    save.mockReset().mockResolvedValue(empty);
  });
  it("does not access storage before application readiness", async () => {
    await renderHook(() => useWorkingTimeTargetSettings(false));
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it("passes the original optimistic snapshot and only explicitly confirmed dates", async () => {
    const hook = await renderHook(() => useWorkingTimeTargetSettings(true));
    await act(async () => hook.result.current.save(decemberTargetContext, ["2026-12-24"]));
    expect(save).toHaveBeenCalledWith(mockDb, {
      context: decemberTargetContext,
      expected: empty,
      confirmedDates: ["2026-12-24"],
    });
  });
  it("keeps failed writes visible to the form and allows retry with the original snapshot", async () => {
    const conflict = new Error("changed");
    save.mockRejectedValueOnce(conflict);
    const hook = await renderHook(() => useWorkingTimeTargetSettings(true));
    await act(async () => {
      await expect(hook.result.current.save(decemberTargetContext)).rejects.toThrow("changed");
    });
    expect(hook.result.current.busy).toBe(false);
    await act(async () => hook.result.current.save(decemberTargetContext));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(mockDb, {
      context: decemberTargetContext,
      expected: empty,
      confirmedDates: [],
    });
  });
  it("does not replace a freshly reloaded snapshot with a delayed earlier response", async () => {
    let resolve!: (value: WorkingTimeTargetSnapshot) => void;
    load
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ ...empty, planRevision: "new-plan" });
    const hook = await renderHook(() => useWorkingTimeTargetSettings(true));
    await act(async () => hook.result.current.reload());
    await act(async () => resolve(empty));
    expect(hook.result.current.snapshot?.planRevision).toBe("new-plan");
  });
});
