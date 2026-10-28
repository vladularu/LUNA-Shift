import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import type { SavedMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { loadNetPayProfileTimeline } from "@/infrastructure/database/net-pay-profile-repository";
import { netPayProfilesChanged } from "@/infrastructure/database/net-pay-profile-events";
import {
  analysisSalaryInputStore,
  createAnalysisSalaryInputStore,
} from "./analysis-salary-input-store";

vi.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadNetPayProfileTimeline: vi.fn(),
}));
const load = vi.mocked(loadNetPayProfileTimeline),
  stores: ReturnType<typeof createAnalysisSalaryInputStore>[] = [];
const row = (month: string): SavedMonthlyNetPaySettings => ({
  settings: automatedSettings(month),
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const fresh = () => {
  const db = {} as SQLiteDatabase,
    store = analysisSalaryInputStore(db);
  stores.push(store);
  return { db, store };
};
beforeEach(() => {
  load.mockReset().mockResolvedValue([row("2026-01")]);
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
});
describe("shared committed salary timeline", () => {
  it("shares a single load and keeps ready values across consumers and focus changes", async () => {
    const { db, store } = fresh();
    expect(analysisSalaryInputStore(db)).toBe(store);
    const first = store.ensure(),
      second = store.ensure();
    expect(second).toBe(first);
    await first;
    const snapshot = store.getSnapshot();
    expect(snapshot.status).toBe("ready");
    await store.ensure(true);
    expect(store.getSnapshot()).toBe(snapshot);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("drops old values immediately on a committed write and reads the new timeline", async () => {
    const { db, store } = fresh();
    await store.ensure();
    load.mockResolvedValue([row("2026-09")]);
    netPayProfilesChanged(db);
    expect(store.getSnapshot().status).toBe("loading");
    expect(store.getSnapshot().timeline).toEqual([]);
    await store.ensure();
    expect(store.getSnapshot().timeline[0].settings.month).toBe("2026-09");
  });
  it("ignores an earlier read that completes after a newer committed version", async () => {
    let resolve!: (value: readonly SavedMonthlyNetPaySettings[]) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { db, store } = fresh(),
      old = store.ensure();
    netPayProfilesChanged(db);
    load.mockResolvedValueOnce([row("2026-10")]);
    await store.ensure();
    resolve([row("2026-01")]);
    await old;
    expect(store.getSnapshot().timeline[0].settings.month).toBe("2026-10");
  });
  it("isolates database instances and refreshes after foreground return", async () => {
    const first = fresh(),
      second = fresh();
    await first.store.ensure();
    expect(second.store.getSnapshot().status).toBe("loading");
    await second.store.ensure();
    first.store.refresh();
    expect(second.store.getSnapshot().status).toBe("ready");
    await first.store.ensure();
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("does not spin on a read error and permits an explicit retry", async () => {
    load.mockRejectedValueOnce(new Error("read"));
    const { store } = fresh();
    await store.ensure();
    await store.ensure();
    expect(store.getSnapshot().status).toBe("error");
    expect(load).toHaveBeenCalledTimes(1);
    await store.ensure(true);
    expect(store.getSnapshot().status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("settles conflicting loaded payments as an error and can recover on retry", async () => {
    const conflicting = [row("2026-01"), row("2026-02")].map((value, index) => ({
      ...value,
      settings: {
        ...value.settings,
        automation: {
          ...value.settings.automation!,
          annualPayments: [
            {
              revision: 1,
              payoutMonth: "2026-11",
              grossCents: 10000 * (index + 1),
              netBasis: null,
            },
          ],
        },
      },
    }));
    load.mockResolvedValueOnce(conflicting);
    const { store } = fresh();
    await expect(store.ensure()).resolves.toBeUndefined();
    expect(store.getSnapshot().status).toBe("error");
    await store.ensure(true);
    expect(store.getSnapshot().status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("never clears a newer pending load when an older failed transformation settles", async () => {
    let resolveOld!: (value: readonly SavedMonthlyNetPaySettings[]) => void;
    let resolveNew!: (value: readonly SavedMonthlyNetPaySettings[]) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveOld = done;
        }),
    );
    load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveNew = done;
        }),
    );
    const { store } = fresh(),
      old = store.ensure();
    store.refresh();
    const current = store.ensure();
    resolveOld([row("2026-01")]);
    await old;
    expect(store.ensure()).toBe(current);
    resolveNew([row("2026-02")]);
    await current;
    expect(store.getSnapshot().timeline[0].settings.month).toBe("2026-02");
  });
});
