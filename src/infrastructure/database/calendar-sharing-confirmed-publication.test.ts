import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TariffAnnualTestDatabase } from "./tariff-annual-test-database";
import { saveAppointment, saveShift, listCalendarEntries } from "./calendar-entry-repository";
import * as sharing from "./calendar-sharing-repository";
import { projectSharingEntries } from "@/engine/sharing-projection";
import { sharingProjectionSignature } from "@/engine/sharing-publication-confirmation";
import type {
  CloudSharedCalendar,
  LocalSharingBinding,
  SharingPublication,
} from "@/domain/calendar-sharing";
import type { SharingPublicationConfirmation } from "@/domain/calendar-sharing-ports";
const account = "10000000-0000-4000-8000-000000000001";
const calendarId = "20000000-0000-4000-8000-000000000001";
const calendar: CloudSharedCalendar = {
  id: calendarId,
  ownerId: account,
  deviceId: "30000000-0000-4000-8000-000000000001",
  name: "Plan",
  color: "#123456",
  visibility: "DETAILS",
  revision: 5,
  isOwner: true,
  publishedAt: null,
};
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
const makeId = () => crypto.randomUUID();
let test: TariffAnnualTestDatabase;
let binding: LocalSharingBinding;
let confirmation: SharingPublicationConfirmation;
let previous: SharingPublication;
let shiftId: string;
let secondAppointmentId: string;
function state() {
  return Object.fromEntries(
    ["sharing_local_bindings", "sharing_publication_outbox", "sharing_entry_ids"].map((table) => [
      table,
      test.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
}
async function proof(): Promise<SharingPublicationConfirmation> {
  const [current] = await sharing.listSharingBindings(test.db, account);
  return {
    generation: current.generation,
    visibility: current.visibility,
    selectedAppointmentIds: [...current.selectedAppointmentIds],
    serverRevision: 7,
    projection: sharingProjectionSignature(
      projectSharingEntries(await listCalendarEntries(test.db), {
        timeZone: "Europe/Berlin",
        visibility: current.visibility,
        selectedAppointmentIds: current.selectedAppointmentIds,
        publicId: () => "11111111-1111-4111-8111-111111111111",
      }),
    ),
  };
}
beforeEach(async () => {
  test = new TariffAnnualTestDatabase();
  await test.setup();
  const shift = await saveShift(test.db, shiftInput);
  shiftId = shift.id;
  const appointment = await saveAppointment(test.db, {
    date: "2026-10-02",
    title: "Private Untersuchung",
    allDay: false,
    startTime: "10:00",
    endTime: "11:00",
    color: "#123456",
  });
  const second = await saveAppointment(test.db, {
    date: "2026-10-02",
    title: "Anderer privater Termin",
    allDay: false,
    startTime: "10:00",
    endTime: "11:00",
    color: "#123456",
  });
  secondAppointmentId = second.id;
  await sharing.setSharingActiveAccount(test.db, account);
  await sharing.bindSharingCalendar(test.db, account, calendar, "a".repeat(64), [appointment.id]);
  [binding] = await sharing.listSharingBindings(test.db, account);
  previous = (await sharing.stageSharingPublication(test.db, binding, "Europe/Berlin", makeId))!;
  test.database
    .prepare("UPDATE sharing_local_bindings SET enabled=0 WHERE calendar_id=?")
    .run(calendarId);
  [binding] = await sharing.listSharingBindings(test.db, account);
  confirmation = await proof();
});
afterEach(() => test.database.close());
describe("atomic confirmed sharing publication", () => {
  it("checks and stages exactly the preview while resuming in the same transaction", async () => {
    const publication = await sharing.stageConfirmedSharingPublication(
      test.db,
      binding,
      "Europe/Berlin",
      makeId,
      confirmation,
    );
    expect(sharingProjectionSignature(publication.entries)).toBe(confirmation.projection);
    expect(publication.mutationId).not.toBe(previous.mutationId);
    expect(publication.generation).toBe(confirmation.generation + 1);
    expect(publication.expectedRevision).toBe(7);
    const [enabled] = await sharing.listSharingBindings(test.db, account);
    expect(enabled).toMatchObject({
      enabled: true,
      generation: confirmation.generation + 1,
      serverRevision: 7,
    });
    expect(
      (await sharing.stageSharingPublication(test.db, enabled, "Europe/Berlin", makeId))!
        .mutationId,
    ).toBe(publication.mutationId);
  });
  it("leaves bindings, pending outbox and public mappings untouched when the generation changes", async () => {
    test.database.exec("UPDATE sharing_local_bindings SET generation=generation+1");
    const before = state();
    await expect(
      sharing.stageConfirmedSharingPublication(
        test.db,
        binding,
        "Europe/Berlin",
        makeId,
        confirmation,
      ),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(state()).toEqual(before);
  });
  it("rejects changing selected private IDs even when their exposed DTOs look identical", async () => {
    test.database
      .prepare("UPDATE sharing_local_bindings SET appointment_ids_json=?")
      .run(JSON.stringify([secondAppointmentId]));
    expect((await proof()).projection).toBe(confirmation.projection);
    const before = state();
    await expect(
      sharing.stageConfirmedSharingPublication(
        test.db,
        binding,
        "Europe/Berlin",
        makeId,
        confirmation,
      ),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(state()).toEqual(before);
  });
  it("rejects a changed privacy mode before enabling anything", async () => {
    test.database.exec("UPDATE sharing_local_bindings SET visibility='AVAILABILITY'");
    const before = state();
    await expect(
      sharing.stageConfirmedSharingPublication(
        test.db,
        binding,
        "Europe/Berlin",
        makeId,
        confirmation,
      ),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(state()).toEqual(before);
  });
  it("detects paused-calendar edits even though dirty generation does not advance while paused", async () => {
    await saveShift(test.db, {
      ...shiftInput,
      id: shiftId,
      expectedRevision: 1,
      startTime: "22:00",
    });
    expect((await proof()).generation).toBe(confirmation.generation);
    const before = state();
    await expect(
      sharing.stageConfirmedSharingPublication(
        test.db,
        binding,
        "Europe/Berlin",
        makeId,
        confirmation,
      ),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(state()).toEqual(before);
  });
  it("rolls back resume, outbox replacement and new public mappings if staging fails after the proof check", async () => {
    test.database.exec("DELETE FROM sharing_entry_ids");
    const before = state();
    test.fail = "INSERT INTO sharing_publication_outbox";
    await expect(
      sharing.stageConfirmedSharingPublication(
        test.db,
        binding,
        "Europe/Berlin",
        makeId,
        confirmation,
      ),
    ).rejects.toThrow("injected write failure");
    test.fail = null;
    expect(state()).toEqual(before);
  });
  it("rejects another active account without changing the paused binding", async () => {
    await sharing.setSharingActiveAccount(test.db, "10000000-0000-4000-8000-000000000002");
    const before = state();
    await expect(
      sharing.stageConfirmedSharingPublication(
        test.db,
        binding,
        "Europe/Berlin",
        makeId,
        confirmation,
      ),
    ).rejects.toThrow("SHARE_ACCOUNT_CHANGED");
    expect(state()).toEqual(before);
  });
  it("rejects invalid server revisions without changing consent or pending data", async () => {
    const before = state();
    await expect(
      sharing.stageConfirmedSharingPublication(test.db, binding, "Europe/Berlin", makeId, {
        ...confirmation,
        serverRevision: -1,
      }),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(state()).toEqual(before);
  });
  it("does not let an acknowledgement for the replaced mutation consume the confirmed publication", async () => {
    await sharing.stageConfirmedSharingPublication(
      test.db,
      binding,
      "Europe/Berlin",
      makeId,
      confirmation,
    );
    const before = state();
    await sharing.acknowledgeSharingPublication(test.db, previous, 6);
    expect(state()).toEqual(before);
  });
});
