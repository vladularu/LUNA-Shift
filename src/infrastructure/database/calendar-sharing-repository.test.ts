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
  configureSharingContent,
  isolateSharingForBackupRestore,
  rememberSharingInvitation,
  listSharingInvitations,
  setSharingCalendarColor,
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
const sourceContent = { version: 2 as const, shifts: true, allAppointments: false, notes: true };
beforeEach(async () => {
  test = new TariffAnnualTestDatabase();
  await test.setup();
  await migrateCalendarSharing(test.db);
  await setSharingActiveAccount(test.db, account);
  await bindSharingCalendar(test.db, account, calendar, "a".repeat(64), []);
});
afterEach(() => test.database.close());
it("retains an issued QR link across reload and clears it on account switch and restore", async () => {
  const invitation = {
    calendarId,
    id: "invite",
    url: "https://luna.example/sharing-invite?token=" + "b".repeat(64),
    expiresAt: "2099-10-14T00:00:00Z",
  };
  await rememberSharingInvitation(test.db, account, invitation);
  await migrateCalendarSharing(test.db);
  expect(await listSharingInvitations(test.db, account)).toEqual([invitation]);
  await isolateSharingForBackupRestore(test.db);
  expect(await listSharingInvitations(test.db, account)).toEqual([]);
  await rememberSharingInvitation(test.db, account, invitation);
  await setSharingActiveAccount(test.db, "another-account");
  expect(await listSharingInvitations(test.db, account)).toEqual([]);
});
it("publishes notes only after source consent and discards an older queued snapshot when consent is reduced", async () => {
  await saveShift(test.db, { ...shiftInput, note: "Notiz\nZweite Zeile" });
  const [legacy] = await listSharingBindings(test.db, account);
  expect(
    (await stageSharingPublication(test.db, legacy, "Europe/Berlin", () => crypto.randomUUID()))!
      .entries[0],
  ).not.toHaveProperty("note");
  await configureSharingContent(test.db, account, calendarId, sourceContent);
  const [allowed] = await listSharingBindings(test.db, account);
  const first = (await stageSharingPublication(test.db, allowed, "Europe/Berlin", () =>
    crypto.randomUUID(),
  ))!;
  expect(first.entries[0]).toMatchObject({ kind: "SHIFT", note: "Notiz\nZweite Zeile" });
  await configureSharingContent(test.db, account, calendarId, { ...sourceContent, notes: false });
  const [reduced] = await listSharingBindings(test.db, account);
  const next = (await stageSharingPublication(test.db, reduced, "Europe/Berlin", () =>
    crypto.randomUUID(),
  ))!;
  expect(next.mutationId).not.toBe(first.mutationId);
  expect(next.entries[0].note).toBeNull();
});
it("restore clears note consent and leaves publication paused", async () => {
  await configureSharingContent(test.db, account, calendarId, sourceContent);
  await isolateSharingForBackupRestore(test.db);
  const [restored] = await listSharingBindings(test.db, account);
  expect(restored.enabled).toBe(false);
  expect(restored.content).toBeUndefined();
  expect(restored.requiresContentConsent).toBe(true);
});
it("source consent cannot be changed under another active account", async () => {
  await setSharingActiveAccount(test.db, "another-account");
  await expect(
    configureSharingContent(test.db, account, calendarId, sourceContent),
  ).rejects.toThrow("SHARE_ACCOUNT_CHANGED");
  expect((await listSharingBindings(test.db, account))[0].content).toBeUndefined();
});
it("a newer rights revision replaces cached entries and removes formerly authorized notes", async () => {
  const entry = {
    id: crypto.randomUUID(),
    kind: "SHIFT" as const,
    note: "Vorher sichtbar",
    startsAt: "2026-10-01T20:00:00Z",
    endsAt: "2026-10-02T05:30:00Z",
    timeZone: "Europe/Berlin",
    allDay: false,
    title: "Nacht",
    color: "#123456",
    symbol: "moon",
  };
  const snapshot = {
    calendar: { ...calendar, isOwner: false, revision: 1 },
    revision: 1,
    unchanged: false,
    reset: true,
    entries: [entry],
    fetchedAt: "2026-10-13T20:00:00Z",
  };
  await cacheSharingSnapshot(test.db, account, snapshot);
  await cacheSharingSnapshot(test.db, account, {
    ...snapshot,
    calendar: { ...snapshot.calendar, revision: 2 },
    revision: 2,
    entries: [{ ...entry, note: null }],
  });
  expect((await listCachedSharingCalendars(test.db, account))[0].entries[0].note).toBeNull();
});
describe("sharing SQLite atomic outbox and isolation", () => {
  it("marks shift changes atomically and stages a persistent safe snapshot", async () => {
    await saveShift(test.db, shiftInput);
    const [binding] = await listSharingBindings(test.db, account);
    expect(binding.generation).toBeGreaterThan(binding.acknowledgedGeneration);
    const mutation = await stageSharingPublication(test.db, binding, "Europe/Berlin", () =>
      crypto.randomUUID(),
    );
    expect(mutation!.entries[0].title).toBe(shiftInput.title);
    expect(mutation!.entries[0].id).not.toBe((await listCalendarEntries(test.db))[0].id);
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

it("republishes existing detailed shares once after the service-name upgrade without resuming paused shares", async () => {
  await test.db.runAsync(
    "UPDATE sharing_local_bindings SET acknowledged_generation=generation WHERE calendar_id=?",
    calendarId,
  );
  await test.db.runAsync(
    "INSERT INTO sharing_local_bindings SELECT 'paused',account_id,device_id,device_secret,name,color,visibility,appointment_ids_json,generation,acknowledged_generation,server_revision,0,NULL FROM sharing_local_bindings WHERE calendar_id=?",
    calendarId,
  );
  await test.db.runAsync(
    "INSERT INTO sharing_local_bindings SELECT 'availability',account_id,device_id,device_secret,name,color,'AVAILABILITY',appointment_ids_json,generation,acknowledged_generation,server_revision,1,NULL FROM sharing_local_bindings WHERE calendar_id=?",
    calendarId,
  );
  const before = await listSharingBindings(test.db, account);
  await test.db.runAsync("DELETE FROM sharing_projection_version");
  await migrateCalendarSharing(test.db);
  const upgraded = await listSharingBindings(test.db, account);
  for (const previous of before) {
    const current = upgraded.find((item) => item.calendarId === previous.calendarId)!;
    expect(current.enabled).toBe(previous.enabled);
    expect(current.visibility).toBe(previous.visibility);
    expect(current.generation).toBe(
      previous.generation + (previous.enabled && previous.visibility === "DETAILS" ? 1 : 0),
    );
    expect(current.acknowledgedGeneration).toBe(previous.acknowledgedGeneration);
  }
  await migrateCalendarSharing(test.db);
  expect(await listSharingBindings(test.db, account)).toEqual(upgraded);
});

it("retains independent reader colors on upgrade and snapshot replacement without changing owner metadata", async () => {
  const foreign = { ...calendar, isOwner: false };
  const other = { ...foreign, id: "20000000-0000-4000-8000-000000000002" };
  const snapshot = (value: CloudSharedCalendar) => ({
    calendar: value,
    entries: [],
    revision: value.revision,
    reset: true,
    unchanged: false,
    fetchedAt: "2026-10-14T10:00:00Z",
  });
  await cacheSharingSnapshot(test.db, account, snapshot(foreign));
  await cacheSharingSnapshot(test.db, account, snapshot(other));
  await setSharingCalendarColor(test.db, "wrong-account", calendarId, "#AA4455");
  expect(
    (await listCachedSharingCalendars(test.db, account)).find((c) => c.calendar.id === calendarId)
      ?.localColor,
  ).toBeUndefined();
  await setSharingCalendarColor(test.db, account, calendarId, "#AA4455");
  await setSharingCalendarColor(test.db, account, other.id, "#4466AA");
  await migrateCalendarSharing(test.db);
  await cacheSharingSnapshot(
    test.db,
    account,
    snapshot({ ...foreign, color: "#112233", revision: 2 }),
  );
  const caches = await listCachedSharingCalendars(test.db, account);
  expect(caches.find((c) => c.calendar.id === calendarId)).toMatchObject({
    localColor: "#AA4455",
    calendar: { color: "#112233", revision: 2 },
  });
  expect(caches.find((c) => c.calendar.id === other.id)?.localColor).toBe("#4466AA");
  await cacheSharingSnapshot(test.db, "other-account", snapshot(foreign));
  expect(
    (await listCachedSharingCalendars(test.db, "other-account"))[0].localColor,
  ).toBeUndefined();
  await expect(setSharingCalendarColor(test.db, account, calendarId, "invalid")).rejects.toThrow(
    "SHARE_INVALID_ARGUMENT",
  );
});
it("adds reader colors to a legacy cache without replacing the cached calendar", async () => {
  const snapshot = {
    calendar: { ...calendar, isOwner: false },
    entries: [],
    revision: calendar.revision,
    reset: true,
    unchanged: false,
    fetchedAt: "2026-10-14T10:00:00Z",
  };
  await cacheSharingSnapshot(test.db, account, snapshot);
  test.database.exec("ALTER TABLE sharing_calendar_cache DROP COLUMN local_color");
  await migrateCalendarSharing(test.db);
  await migrateCalendarSharing(test.db);
  expect((await listCachedSharingCalendars(test.db, account))[0].calendar).toEqual(
    snapshot.calendar,
  );
  await setSharingCalendarColor(test.db, account, calendarId, "#AA4455");
  expect((await listCachedSharingCalendars(test.db, account))[0].localColor).toBe("#AA4455");
});
