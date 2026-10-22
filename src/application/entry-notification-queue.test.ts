import { it, expect, vi } from "vitest";
import { createEntryNotificationQueue } from "./entry-notification-queue";
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
