import { createHash } from "node:crypto";
import { projectSharingEntries } from "@/engine/sharing-projection";
import { sharingProjectionSignature } from "@/engine/sharing-publication-confirmation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TariffAnnualTestDatabase } from "./tariff-annual-test-database";
import { saveAppointment, saveShift, listCalendarEntries } from "./calendar-entry-repository";
import { createLocalBackupDocument, loadLocalBackupSnapshot } from "./local-backup";
import {
  loadCurrentDatabaseSchemaVersion,
  validateLocalBackup,
  type ValidatedLocalBackup,
} from "./local-backup-validation";
import { restoreLocalBackup } from "./local-backup-restore";
import * as sharing from "./calendar-sharing-repository";
import {
  createCalendarSharingRuntime,
  type CalendarSharingRuntimeOptions,
} from "@/application/calendar-sharing-runtime";
import type {
  CloudSharedCalendar,
  LocalSharingBinding,
  SharingPublication,
} from "@/domain/calendar-sharing";
import type { SharingCloudPort, SharingLocalPort } from "@/domain/calendar-sharing-ports";

const account = "10000000-0000-4000-8000-000000000001";
const calendarId = "20000000-0000-4000-8000-000000000001";
const calendar: CloudSharedCalendar = {
  id: calendarId,
  ownerId: account,
  deviceId: "30000000-0000-4000-8000-000000000001",
  name: "Mein Plan",
  color: "#123456",
  visibility: "DETAILS",
  revision: 7,
  isOwner: true,
  publishedAt: "2026-10-01T12:00:00Z",
};
const secret = "a".repeat(64);
const shiftInput = {
  date: "2026-10-01",
  title: "Privater Dienst",
  type: "NIGHT" as const,
  startTime: "21:00",
  endTime: "07:30",
  breakMinutes: 60,
  color: "#123456",
  symbol: "moon",
};
const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");
const makeId = () => crypto.randomUUID();
let source: TariffAnnualTestDatabase;
let destination: TariffAnnualTestDatabase;
let backup: ValidatedLocalBackup;
let before: LocalSharingBinding;
let pending: SharingPublication;
let originalPrivateIds: readonly string[];
let originalPublicIds: readonly string[];

function localPort(): SharingLocalPort {
  const db = destination.db;
  return {
    initialize: () => sharing.migrateCalendarSharing(db),
    setActiveAccount: (id) => sharing.setSharingActiveAccount(db, id),
    listBindings: (id) => sharing.listSharingBindings(db, id),
    stagePublication: (binding, timeZone, id) =>
      sharing.stageSharingPublication(db, binding, timeZone, id),
    stageConfirmedPublication: (binding, timeZone, id, confirmation) =>
      sharing.stageConfirmedSharingPublication(db, binding, timeZone, id, confirmation),
    acknowledgePublication: (publication, revision) =>
      sharing.acknowledgeSharingPublication(db, publication, revision),
    resumePublication: (id, target) => sharing.resumeSharingPublication(db, id, target),
    clearConflict: (id, target, revision) =>
      sharing.clearSharingPublicationConflict(db, id, target, revision),
    listCaches: (id) => sharing.listCachedSharingCalendars(db, id),
    cacheSnapshot: (id, snapshot) => sharing.cacheSharingSnapshot(db, id, snapshot),
    removeCalendar: (id, target) => sharing.removeSharingCalendar(db, id, target),
    setVisible: (id, target, visible) => sharing.setSharingCalendarVisible(db, id, target, visible),
    forgetAccount: (id) => sharing.forgetSharingAccount(db, id),
    readEntries: () => listCalendarEntries(db),
    bindCalendar: (id, metadata, deviceSecret, selected) =>
      sharing.bindSharingCalendar(db, id, metadata, deviceSecret, selected),
  };
}
function sharingState() {
  return Object.fromEntries(
    [
      "sharing_active_account",
      "sharing_local_bindings",
      "sharing_publication_outbox",
      "sharing_entry_ids",
      "sharing_calendar_cache",
    ].map((table) => [
      table,
      destination.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}

beforeEach(async () => {
  source = new TariffAnnualTestDatabase();
  destination = new TariffAnnualTestDatabase();
  await source.setup();
  await destination.setup();
  const originalShift = await saveShift(destination.db, shiftInput);
  const originalAppointment = await saveAppointment(destination.db, {
    date: "2026-10-02",
    title: "Private Untersuchung",
    allDay: false,
    startTime: "10:00",
    endTime: "11:00",
    color: "#123456",
    note: "Private Notiz",
  });
  originalPrivateIds = [originalShift.id, originalAppointment.id];
  await sharing.setSharingActiveAccount(destination.db, account);
  await sharing.bindSharingCalendar(destination.db, account, calendar, secret, [
    originalAppointment.id,
  ]);
  [before] = await sharing.listSharingBindings(destination.db, account);
  pending = (await sharing.stageSharingPublication(
    destination.db,
    before,
    "Europe/Berlin",
    makeId,
  ))!;
  originalPublicIds = pending.entries.map((entry) => entry.id);
  await sharing.cacheSharingSnapshot(destination.db, account, {
    calendar: {
      ...calendar,
      id: "40000000-0000-4000-8000-000000000001",
      isOwner: false,
      ownerId: "50000000-0000-4000-8000-000000000001",
    },
    revision: 7,
    unchanged: false,
    reset: true,
    entries: pending.entries,
    fetchedAt: "2026-10-01T12:00:00Z",
  });
  // Backup may reuse private IDs, but contains a different person's private calendar.
  const restoredShift = await saveShift(source.db, {
    ...shiftInput,
    title: "Backup Privatdienst",
    date: "2026-10-03",
  });
  const restoredAppointment = await saveAppointment(source.db, {
    date: "2026-10-04",
    title: "Anderer privater Termin",
    allDay: false,
    startTime: "12:00",
    endTime: "13:00",
    color: "#654321",
    note: "Nicht automatisch freigeben",
  });
  source.database
    .prepare("UPDATE shift_entries SET id=? WHERE id=?")
    .run(originalShift.id, restoredShift.id);
  source.database
    .prepare("UPDATE appointments SET id=? WHERE id=?")
    .run(originalAppointment.id, restoredAppointment.id);
  const exported = await createLocalBackupDocument(await loadLocalBackupSnapshot(source.db), {
    appVersion: "0.1.0",
    createdAt: new Date(),
    sha256,
  });
  backup = await validateLocalBackup(exported.serialized, {
    maxDatabaseSchemaVersion: await loadCurrentDatabaseSchemaVersion(destination.db),
    sha256,
  });
});
afterEach(() => {
  source.database.close();
  destination.database.close();
});

describe("backup restore sharing isolation", () => {
  it("pauses publication before restoring user rows, clears local sharing snapshots and keeps account/device/server identity", async () => {
    await restoreLocalBackup(destination.db, backup);
    const [restored] = await sharing.listSharingBindings(destination.db, account);
    expect(restored).toMatchObject({
      enabled: false,
      selectedAppointmentIds: [],
      deviceId: before.deviceId,
      deviceSecret: secret,
      serverRevision: before.serverRevision,
      generation: before.generation + 1,
    });
    expect(
      destination.database
        .prepare("SELECT account_id FROM sharing_active_account WHERE id=1")
        .get(),
    ).toEqual({ account_id: account });
    for (const table of [
      "sharing_publication_outbox",
      "sharing_entry_ids",
      "sharing_calendar_cache",
    ])
      expect(destination.database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    expect((await listCalendarEntries(destination.db)).map((entry) => entry.id).sort()).toEqual(
      [...originalPrivateIds].sort(),
    );
    await expect(
      sharing.stageSharingPublication(destination.db, restored, "Europe/Berlin", makeId),
    ).rejects.toThrow("SHARE_ACCOUNT_CHANGED");
  });
  it("cannot auto-publish restored content even with a still valid cloud session", async () => {
    await sharing.acknowledgeSharingPublication(destination.db, pending, 8);
    await restoreLocalBackup(destination.db, backup);
    const remote = { ...calendar, revision: 8 };
    const cloud = {
      listCalendars: vi.fn(async () => [remote]),
      fetch: vi.fn(async () => ({
        calendar: remote,
        revision: 8,
        unchanged: false,
        reset: true,
        entries: [],
        fetchedAt: "2026-10-01T12:00:00Z",
      })),
      listMembers: vi.fn(async () => ({ members: [], invites: [] })),
      publish: vi.fn(async () => ({
        calendarId,
        revision: 9,
        publishedAt: "2026-10-01T12:00:00Z",
      })),
    };
    const options: CalendarSharingRuntimeOptions = {
      cloud: cloud as unknown as SharingCloudPort,
      local: localPort(),
      auth: {
        isConfigured: true,
        getSession: async () => ({ id: account, displayName: "Alex" }),
        subscribe: () => () => {},
        signInApple: async () => null,
        signInGoogle: async () => null,
        signOut: async () => {},
      },
      getInput: () => ({ timeZone: "Europe/Berlin", testLabActive: false }),
      now: () => Date.parse("2026-10-01T12:00:00Z"),
      makeId,
      makeSecret: () => secret,
      appleAvailable: false,
      shareUrl: async () => {},
      inviteUrl: (token) => token,
      isAppleUser: async () => false,
      prepareAppleDeletion: async () => ({ status: "cancelled" }),
      confirmManualAppleDeletion: async () => false,
      notifyDeletion: () => {},
      forgetAuthProfile: async () => {},
    };
    const runtime = createCalendarSharingRuntime(options);
    try {
      await runtime.start();
      await runtime.backgroundRefresh();
      expect(cloud.publish).not.toHaveBeenCalled();
      expect(runtime.getController().calendars[0].syncState).toBe("pending");
      const preview = await runtime.getController().preparePublicationPreview(calendarId);
      expect(cloud.publish).not.toHaveBeenCalled();
      await runtime.getController().publishCalendar(calendarId, preview.confirmationId);
      expect(cloud.publish).toHaveBeenCalledTimes(1);
      expect(cloud.publish).toHaveBeenCalledWith(
        expect.objectContaining({ selectedAppointmentIds: [] }),
        expect.objectContaining({
          entries: [expect.objectContaining({ title: "Nacht" })],
        }),
      );
    } finally {
      runtime.stop();
    }
  });
  it("requires an explicit fresh confirmation and does not reselect restored private appointment IDs or reuse old public IDs", async () => {
    await restoreLocalBackup(destination.db, backup);
    const [restored] = await sharing.listSharingBindings(destination.db, account);
    const projection = projectSharingEntries(await listCalendarEntries(destination.db), {
      timeZone: "Europe/Berlin",
      visibility: restored.visibility,
      selectedAppointmentIds: restored.selectedAppointmentIds,
      publicId: () => "11111111-1111-4111-8111-111111111111",
    });
    const fresh = await sharing.stageConfirmedSharingPublication(
      destination.db,
      restored,
      "Europe/Berlin",
      makeId,
      {
        generation: restored.generation,
        visibility: restored.visibility,
        selectedAppointmentIds: restored.selectedAppointmentIds,
        serverRevision: restored.serverRevision,
        projection: sharingProjectionSignature(projection),
      },
    );
    expect(fresh.entries).toHaveLength(1);
    expect(fresh.entries[0].title).toBe("Nacht");
    expect(fresh.entries.every((entry) => !originalPublicIds.includes(entry.id))).toBe(true);
    expect(JSON.stringify(fresh)).not.toContain("Termin");
    expect(fresh.expectedRevision).toBe(before.serverRevision);
  });
  it("rolls back sharing isolation together with a failed backup restore", async () => {
    const state = sharingState();
    const privateBefore = await listCalendarEntries(destination.db);
    destination.fail = "INSERT INTO shift_entries";
    await expect(restoreLocalBackup(destination.db, backup)).rejects.toThrow(
      "injected write failure",
    );
    destination.fail = null;
    expect(sharingState()).toEqual(state);
    expect(await listCalendarEntries(destination.db)).toEqual(privateBefore);
  });
});

it("detaches paused bindings from other accounts as well as the active publisher", async () => {
  const otherAccount = "10000000-0000-4000-8000-000000000002";
  const otherCalendar = "20000000-0000-4000-8000-000000000002";
  destination.database
    .prepare(
      `INSERT INTO sharing_local_bindings(calendar_id,account_id,device_id,device_secret,name,color,visibility,appointment_ids_json,generation,acknowledged_generation,server_revision,enabled)
    SELECT ?,?,device_id,?,name,color,visibility,appointment_ids_json,generation,acknowledged_generation,server_revision,0 FROM sharing_local_bindings WHERE calendar_id=?`,
    )
    .run(otherCalendar, otherAccount, "b".repeat(64), calendarId);
  const [old] = await sharing.listSharingBindings(destination.db, otherAccount);
  await restoreLocalBackup(destination.db, backup);
  const [restored] = await sharing.listSharingBindings(destination.db, otherAccount);
  expect(restored).toMatchObject({
    enabled: false,
    selectedAppointmentIds: [],
    generation: old.generation + 1,
    deviceSecret: old.deviceSecret,
    serverRevision: old.serverRevision,
  });
});
it("does not let a late pre-restore acknowledgement re-enable or recover cleared sharing state", async () => {
  await restoreLocalBackup(destination.db, backup);
  const state = sharingState();
  await sharing.acknowledgeSharingPublication(destination.db, pending, 8);
  expect(sharingState()).toEqual(state);
  const [restored] = await sharing.listSharingBindings(destination.db, account);
  expect(restored.enabled).toBe(false);
  expect(restored.serverRevision).toBe(7);
});
it("has no sharing side effects on an older database without sharing tables", async () => {
  const legacy = new TariffAnnualTestDatabase();
  try {
    const { withImmediateTransaction } = await import("./transaction");
    await withImmediateTransaction(legacy.db, () =>
      sharing.isolateSharingForBackupRestore(legacy.db),
    );
    expect(
      legacy.database.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sharing_%'").all(),
    ).toEqual([]);
    expect(legacy.database.inTransaction).toBe(false);
  } finally {
    legacy.database.close();
  }
});
