import { describe, it, expect, vi } from "vitest";
import type { CalendarEntry, ShiftEntry, ShiftTemplate, SaveShiftInput } from "@/domain/types";
import { createQuickStampQueue, type StampPreviewDay } from "./quick-stamp-queue";
import { buildQuickEntryActions } from "./quick-entry-actions";
const template: ShiftTemplate = {
  id: "early",
  name: "Früh",
  type: "EARLY",
  startTime: "06:00",
  endTime: "14:00",
  breakMinutes: 30,
  color: "#123456",
  symbol: "sun",
  sortOrder: 0,
  revision: 1,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};
const action = buildQuickEntryActions([template])[0];
if (action.kind !== "TEMPLATE") throw Error("template");
const stampAction = action;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture(initial: readonly CalendarEntry[] = []) {
  let entries = initial;
  let days: readonly StampPreviewDay[] = [];
  const save = vi.fn(async (input: SaveShiftInput) => {
    const saved: ShiftEntry = {
      ...input,
      templateId: input.templateId ?? null,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      breakMinutes: input.breakMinutes ?? 0,
      color: input.color ?? template.color,
      symbol: input.symbol ?? template.symbol,
      kind: "SHIFT",
      id: "saved",
      revision: 1,
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
      note: null,
      overtimeMinutes: 0,
      holidayPremiumMode: "WITH_TIME_OFF",
    };
    entries = [...entries, saved];
    return saved;
  });
  const remove = vi.fn(async (entry: CalendarEntry) => {
    entries = entries.filter((e) => e.id !== entry.id);
  });
  const failed = vi.fn();
  const queue = createQuickStampQueue({
    entries: () => entries,
    save,
    remove,
    changed: (next) => {
      days = next;
    },
    failed,
    completed: vi.fn(),
  });
  return {
    queue,
    save,
    remove,
    failed,
    get days() {
      return days;
    },
    get entries() {
      return entries;
    },
    set entries(next: readonly CalendarEntry[]) {
      entries = next;
    },
  };
}
describe("quick stamp immediate feedback and durable ordering", () => {
  it("shows a pending service immediately and preserves rapid add/remove/add intentions", async () => {
    const f = fixture();
    const write = deferred<ShiftEntry>();
    const normal = f.save.getMockImplementation()!;
    f.save.mockImplementationOnce(async (input) => {
      await write.promise;
      return normal(input);
    });
    const first = f.queue.stamp(stampAction, "2026-10-22");
    expect(f.days[0].entries[0].id).toMatch(/^pending-stamp:/);
    const second = f.queue.stamp(stampAction, "2026-10-22");
    expect(f.days[0].entries).toHaveLength(0);
    const third = f.queue.stamp(stampAction, "2026-10-22");
    expect(f.days[0].entries).toHaveLength(1);
    expect(f.save).toHaveBeenCalledTimes(1);
    write.resolve({} as ShiftEntry);
    expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.save.mock.calls.every(([input]) => !("id" in input))).toBe(true);
    expect(f.entries).toHaveLength(1);
    f.queue.reconcile();
    expect(f.days).toHaveLength(0);
  });
  it("rolls back only failed work and keeps successful partial deletions", async () => {
    const f = fixture();
    await f.queue.stamp(stampAction, "2026-10-22");
    const one = f.entries[0];
    f.entries = [one, { ...one, id: "second" }];
    f.remove
      .mockImplementationOnce(async (entry) => {
        f.entries = f.entries.filter((e) => e.id !== entry.id);
      })
      .mockRejectedValueOnce(new Error("write failed"));
    const result = await f.queue.stamp(stampAction, "2026-10-22");
    expect(result).toBe(false);
    expect(f.failed).toHaveBeenCalledTimes(1);
    expect(f.entries.map((e) => e.id)).toEqual(["second"]);
    expect(f.days.flatMap((d) => d.entries).map((e) => e.id)).toEqual(["second"]);
    expect(await f.queue.stamp(stampAction, "2026-10-22")).toBe(true);
    expect(f.entries).toHaveLength(0);
  });
  it("does not toggle a service away when canonical data catches up before save completion", async () => {
    const f = fixture();
    const write = deferred<ShiftEntry>();
    const normal = f.save.getMockImplementation()!;
    f.save.mockImplementationOnce(async (input) => {
      const saved = await normal(input);
      f.queue.reconcile();
      await write.promise;
      return saved;
    });
    const saving = f.queue.stamp(stampAction, "2026-10-22");
    await vi.waitFor(() => expect(f.entries).toHaveLength(1));
    f.queue.reconcile();
    expect(f.days[0].entries).toHaveLength(1);
    expect(f.days[0].entries[0].id).toBe("saved");
    write.resolve(f.entries[0] as ShiftEntry);
    expect(await saving).toBe(true);
  });
  it("allows another date while a save is delayed and removes a failed pending prediction", async () => {
    const f = fixture();
    const write = deferred<ShiftEntry>();
    f.save.mockImplementationOnce(() => write.promise);
    const pending = f.queue.stamp(stampAction, "2026-10-22");
    expect(await f.queue.stamp(stampAction, "2026-10-23")).toBe(true);
    write.resolve({ ...f.entries[0], date: "2026-10-22", id: "other" } as ShiftEntry);
    expect(await pending).toBe(true);
    const g = fixture();
    g.save.mockRejectedValueOnce(new Error("full"));
    expect(await g.queue.stamp(stampAction, "2026-10-22")).toBe(false);
    expect(g.days).toHaveLength(0);
    expect(g.entries).toHaveLength(0);
  });
});

it("does not republish an unchanged prediction while canonical array identity changes", async () => {
  const changed = vi.fn();
  const saved: ShiftEntry = {
    ...template,
    kind: "SHIFT",
    id: "saved",
    date: "2026-10-22",
    templateId: template.id,
    title: template.name,
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
  };
  const queue = createQuickStampQueue({
    entries: () => [],
    save: async () => saved,
    remove: async () => {},
    changed,
    failed: vi.fn(),
    completed: vi.fn(),
  });
  await queue.stamp(stampAction, "2026-10-22");
  const calls = changed.mock.calls.length;
  for (let i = 0; i < 100; i++) queue.reconcile();
  expect(changed).toHaveBeenCalledTimes(calls);
});
