import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TariffAnnualTestDatabase } from "@/infrastructure/database/tariff-annual-test-database";
import {
  saveShift,
  listCalendarEntries,
} from "@/infrastructure/database/calendar-entry-repository";
import {
  migrateCalendarSharing,
  setSharingActiveAccount,
  bindSharingCalendar,
  listSharingBindings,
  stageSharingPublication,
  acknowledgeSharingPublication,
  listCachedSharingCalendars,
  cacheSharingSnapshot,
} from "@/infrastructure/database/calendar-sharing-repository";
import type { CloudSharedCalendar } from "@/domain/calendar-sharing";
const account = "10000000-0000-4000-8000-000000000001";
const calendarId = "20000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000001";
const calendar: CloudSharedCalendar = {
  id: calendarId,
  ownerId: account,
  name: "Dienstplan",
  color: "#123456",
  visibility: "DETAILS",
  revision: 0,
  isOwner: true,
  publishedAt: null,
  deviceId,
};
const shiftInput = {
  date: "2026-10-01",
  title: "Privat",
  type: "NIGHT" as const,
  startTime: "21:00",
  endTime: "07:30",
  breakMinutes: 60,
  color: "#123456",
  symbol: "moon",
};
let test: TariffAnnualTestDatabase;
beforeEach(async () => {
  test = new TariffAnnualTestDatabase();
  await test.setup();
  await migrateCalendarSharing(test.db);
  await setSharingActiveAccount(test.db, account);
  await bindSharingCalendar(test.db, account, calendar, "a".repeat(64), []);
});
afterEach(() => test.database.close());
describe("sharing SQLite atomic outbox and isolation", () => {
  it("marks shift changes atomically and stages a persistent safe snapshot", async () => {
    await saveShift(test.db, shiftInput);
    const [binding] = await listSharingBindings(test.db, account);
    expect(binding.generation).toBeGreaterThan(binding.acknowledgedGeneration);
    const mutation = await stageSharingPublication(test.db, binding, "Europe/Berlin", () =>
      crypto.randomUUID(),
    );
    expect(mutation!.entries[0].title).toBe("Nacht");
    expect(JSON.stringify(mutation)).not.toContain("Privat");
    const retry = await stageSharingPublication(test.db, binding, "Europe/Berlin", () =>
      crypto.randomUUID(),
    );
    expect(retry).toEqual(mutation);
  });
  it("keeps newer local edits dirty after an older snapshot is acknowledged", async () => {
    await saveShift(test.db, shiftInput);
    const [binding] = await listSharingBindings(test.db, account);
    const first = (await stageSharingPublication(test.db, binding, "Europe/Berlin", () =>
      crypto.randomUUID(),
    ))!;
    await saveShift(test.db, { ...shiftInput, date: "2026-10-02" });
    await acknowledgeSharingPublication(test.db, first, 1);
    const [updated] = await listSharingBindings(test.db, account);
    expect(updated.serverRevision).toBe(1);
    expect(updated.generation).toBeGreaterThan(updated.acknowledgedGeneration);
    expect(
      (await stageSharingPublication(test.db, updated, "Europe/Berlin", () => crypto.randomUUID()))!
        .entries,
    ).toHaveLength(2);
  });
  it("rolls back local save when its atomic dirty marker fails", async () => {
    test.database.exec(
      "CREATE TRIGGER fail_sharing_marker BEFORE UPDATE ON sharing_local_bindings BEGIN SELECT RAISE(ABORT,'marker failure'); END",
    );
    await expect(saveShift(test.db, shiftInput)).rejects.toThrow();
    expect(await listCalendarEntries(test.db)).toHaveLength(0);
  });
  it("isolates account switches and never uploads previous-account changes automatically", async () => {
    const other = "10000000-0000-4000-8000-000000000002";
    await setSharingActiveAccount(test.db, other);
    const [old] = await listSharingBindings(test.db, account);
    expect(old.enabled).toBe(false);
    await expect(
      stageSharingPublication(test.db, old, "Europe/Berlin", () => crypto.randomUUID()),
    ).rejects.toThrow();
  });
  it("replaces caches on complete snapshots and preserves them on unchanged replies", async () => {
    const foreign = {
      ...calendar,
      isOwner: false,
      ownerId: "10000000-0000-4000-8000-000000000002",
      revision: 1,
    };
    const entry = {
      id: crypto.randomUUID(),
      startsAt: "2026-10-01T19:00:00Z",
      endsAt: "2026-10-02T05:30:00Z",
      timeZone: "Europe/Berlin",
      allDay: false,
      title: "Nacht",
      color: "#123456",
      symbol: "moon",
    };
    await cacheSharingSnapshot(test.db, account, {
      calendar: foreign,
      revision: 1,
      unchanged: false,
      reset: true,
      entries: [entry],
      fetchedAt: "2026-10-01T20:00:00Z",
    });
    await cacheSharingSnapshot(test.db, account, {
      calendar: foreign,
      revision: 1,
      unchanged: true,
      reset: false,
      entries: [],
      fetchedAt: "2026-10-01T21:00:00Z",
    });
    expect((await listCachedSharingCalendars(test.db, account))[0].entries).toHaveLength(1);
    await cacheSharingSnapshot(test.db, account, {
      calendar: { ...foreign, revision: 2 },
      revision: 2,
      unchanged: false,
      reset: true,
      entries: [],
      fetchedAt: "2026-10-01T22:00:00Z",
    });
    expect((await listCachedSharingCalendars(test.db, account))[0].entries).toEqual([]);
  });
  it("clears foreign caches on logout while retaining local shifts", async () => {
    await saveShift(test.db, shiftInput);
    await setSharingActiveAccount(test.db, null);
    expect(await listCachedSharingCalendars(test.db, account)).toEqual([]);
    expect(await listCalendarEntries(test.db)).toHaveLength(1);
  });
  it("catches up local edits made while signed out on same-account restore", async () => {
    await saveShift(test.db, shiftInput);
    const [before] = await listSharingBindings(test.db, account);
    const published = (await stageSharingPublication(test.db, before, "Europe/Berlin", () =>
      crypto.randomUUID(),
    ))!;
    await acknowledgeSharingPublication(test.db, published, 1);
    await setSharingActiveAccount(test.db, null);
    await saveShift(test.db, { ...shiftInput, date: "2026-10-02" });
    await setSharingActiveAccount(test.db, account);
    const [restored] = await listSharingBindings(test.db, account);
    expect(restored.enabled).toBe(true);
    expect(
      (await stageSharingPublication(test.db, restored, "Europe/Berlin", () =>
        crypto.randomUUID(),
      ))!.entries,
    ).toHaveLength(2);
  });
  it("protects unacknowledged tombstones until the sharing snapshot is confirmed", async () => {
    const { purgeExpiredTombstones } =
      await import("@/infrastructure/database/tombstone-retention");
    const shift = await saveShift(test.db, shiftInput);
    test.database
      .prepare("UPDATE shift_entries SET deleted_at='2025-01-01' WHERE id=?")
      .run(shift.id);
    const [dirty] = await listSharingBindings(test.db, account);
    expect(await purgeExpiredTombstones(test.db, new Date("2026-10-12"))).toEqual({
      appointments: 0,
      shifts: 0,
      templates: 0,
    });
    expect(
      test.database.prepare("SELECT id FROM shift_entries WHERE id=?").get(shift.id),
    ).toBeDefined();
    const deletion = (await stageSharingPublication(test.db, dirty, "Europe/Berlin", () =>
      crypto.randomUUID(),
    ))!;
    expect(deletion.entries).toEqual([]);
    expect((await purgeExpiredTombstones(test.db, new Date("2026-10-12"))).shifts).toBe(0);
    await acknowledgeSharingPublication(test.db, deletion, 1);
    expect((await purgeExpiredTombstones(test.db, new Date("2026-10-12"))).shifts).toBe(1);
  });
});
