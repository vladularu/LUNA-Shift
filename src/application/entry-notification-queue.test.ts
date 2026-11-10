import { it, expect, vi } from "vitest";
import {
  createEntryNotificationQueue,
  createEntryNotificationReconciler,
} from "./entry-notification-queue";
import type { PflegeShiftNotificationPort } from "./pflegeshift-ports";
import type { CalendarEntry } from "@/domain/types";
it("finishes in-flight scheduling before a later deletion cancels reminders", async () => {
  const q = createEntryNotificationQueue();
  const calls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const failed = vi.fn();
  q.enqueue(
    "a",
    1,
    async () => {
      calls.push("sync");
      await held;
    },
    failed,
  );
  await vi.waitFor(() => expect(calls).toEqual(["sync"]));
  q.enqueue(
    "a",
    2,
    async () => {
      calls.push("cancel");
    },
    failed,
  );
  expect(calls).toEqual(["sync"]);
  release();
  await vi.waitFor(() => expect(calls).toEqual(["sync", "cancel"]));
  expect(failed).not.toHaveBeenCalled();
});
it("supersedes queued older revisions and continues after a scheduling failure", async () => {
  const q = createEntryNotificationQueue();
  const old = vi.fn(async () => {});
  const latest = vi.fn(async () => {
    throw Error("native failed");
  });
  const failed = vi.fn();
  q.enqueue("a", 1, old, failed);
  q.enqueue("a", 3, latest, failed);
  q.enqueue("a", 2, old, failed);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  expect(old).not.toHaveBeenCalled();
  const recovery = vi.fn(async () => {});
  q.enqueue("a", 4, recovery, failed);
  await vi.waitFor(() => expect(recovery).toHaveBeenCalledOnce());
});

it("captures queued reminder work before restore and allows new work on the surviving port", async () => {
  let generation = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const effects: string[] = [];
  const oldCancelAttempt = vi.fn();
  const notifications: PflegeShiftNotificationPort = {
    syncEntry: vi.fn(),
    cancelEntry: vi.fn(),
    capture: () => {
      const current = generation;
      return {
        syncEntry: async (entry) => {
          if (entry.revision === 1) await held;
          if (current === generation) effects.push(`sync:${entry.revision}`);
        },
        cancelEntry: async () => {
          oldCancelAttempt();
          if (current === generation) effects.push("cancel");
        },
      };
    },
  };
  const record = vi.fn();
  const reconciler = createEntryNotificationReconciler(notifications, { record });
  const entry = { id: "a", kind: "SHIFT", revision: 1 } as CalendarEntry;
  reconciler.sync(entry, "Europe/Berlin", vi.fn());
  await Promise.resolve();
  reconciler.cancel(entry, vi.fn());
  generation++;
  release();
  await vi.waitFor(() => expect(oldCancelAttempt).toHaveBeenCalledOnce());
  expect(effects).toEqual([]);
  reconciler.sync({ ...entry, revision: 3 }, "Europe/Berlin", vi.fn());
  await vi.waitFor(() => expect(effects).toEqual(["sync:3"]));
  expect(record).not.toHaveBeenCalled();
});

it("does not let a retired generation with a higher revision block restored reminders", async () => {
  let generation = "old";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = vi.fn();
  const effects = vi.fn();
  const notifications: PflegeShiftNotificationPort = {
    syncEntry: vi.fn(),
    cancelEntry: vi.fn(),
    capture: () => {
      const captured = generation;
      return {
        scopeKey: captured,
        syncEntry: async (entry) => {
          started(captured);
          if (captured === "old") await held;
          if (captured === generation) effects(entry.revision);
        },
        cancelEntry: async () => undefined,
      };
    },
  };
  const queue = createEntryNotificationReconciler(notifications, { record: vi.fn() });
  const entry = { id: "same", kind: "SHIFT", revision: 7 } as CalendarEntry;
  queue.sync(entry, "Europe/Berlin", vi.fn());
  await vi.waitFor(() => expect(started).toHaveBeenCalledWith("old"));
  generation = "restored";
  queue.sync({ ...entry, revision: 1 }, "Europe/Berlin", vi.fn(), true);
  await vi.waitFor(() => expect(effects).toHaveBeenCalledExactlyOnceWith(1));
  release();
  await held;
});

it("uses the pre-read scope for restored data without capturing another generation", async () => {
  const capture = vi.fn();
  const syncEntry = vi.fn(async () => undefined);
  const notifications: PflegeShiftNotificationPort = {
    capture,
    syncEntry: vi.fn(),
    cancelEntry: vi.fn(),
  };
  const captured = { scopeKey: "read-generation", syncEntry, cancelEntry: vi.fn() };
  const queue = createEntryNotificationReconciler(notifications, { record: vi.fn() });
  const entry = { id: "same", kind: "SHIFT", revision: 1 } as CalendarEntry;
  queue.sync(entry, "Europe/Berlin", vi.fn(), true, captured);
  await vi.waitFor(() => expect(syncEntry).toHaveBeenCalledWith(entry, "Europe/Berlin"));
  expect(capture).not.toHaveBeenCalled();
});
