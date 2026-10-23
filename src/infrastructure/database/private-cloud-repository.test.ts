import { LATEST_DATABASE_SCHEMA_VERSION } from "./migrations";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TariffAnnualTestDatabase } from "./tariff-annual-test-database";
import { createPrivateCloudLocal, migratePrivateCloud } from "./private-cloud-repository";
import { saveAppointment } from "./calendar-entry-repository";
import { validatePrivateCloudDocument } from "@/infrastructure/private-cloud/cloud-document";
import { restoreLocalBackup } from "./local-backup-restore";
import type { PrivateCloudDocument } from "@/domain/private-cloud";

const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");
const present: PrivateCloudDocument["presentation"] = {
  calendarImage: null,
  calendarImageStrength: "medium",
};
let memory: TariffAnnualTestDatabase;
const beforeReplace = vi.fn(async () => undefined);
const recoverNotifications = vi.fn(async () => undefined);
const discard = vi.fn();
function local() {
  return createPrivateCloudLocal(memory.db, {
    sha256,
    readPresentation: async () => present,
    preparePresentation: async () => ({ apply: async () => undefined, discard }),
    beforeReplace,
    recoverNotifications,
  });
}
const receipt = (document: PrivateCloudDocument) => ({
  revision: 1,
  updatedAt: "2026-10-17T12:00:00.000Z",
  document,
});
beforeEach(async () => {
  memory = new TariffAnnualTestDatabase();
  await memory.setup();
  await migratePrivateCloud(memory.db);
  vi.clearAllMocks();
});
afterEach(() => {
  memory.database.close();
});

describe("atomic private cloud storage", () => {
  it("requires fresh cloud consent after a manual JSON import", async () => {
    const port = local();
    await port.bind("a", () => true);
    const snapshot = await port.capture();
    const { backup } = await validatePrivateCloudDocument(
      snapshot,
      LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    );
    await restoreLocalBackup(memory.db, backup);
    expect(await port.state()).toBeNull();
  });
  it("covers every personal backup collection and rejects unknown private fields", async () => {
    const snapshot = await local().capture();
    expect(Object.keys(snapshot.data)).toHaveLength(26);
    expect(snapshot.data).not.toHaveProperty("sharing_calendar_cache");
    expect(snapshot.data).not.toHaveProperty("tokens");
    expect(
      (await validatePrivateCloudDocument(snapshot, LATEST_DATABASE_SCHEMA_VERSION, sha256))
        .document,
    ).toEqual(snapshot);
    await expect(
      validatePrivateCloudDocument(
        { ...snapshot, data: { ...snapshot.data, tokens: [] } },
        LATEST_DATABASE_SCHEMA_VERSION,
        sha256,
      ),
    ).rejects.toThrow("Cloud-Stand");
    await expect(
      validatePrivateCloudDocument(
        { ...snapshot, presentation: { ...present, calendarImage: "file:///private.jpg" } },
        LATEST_DATABASE_SCHEMA_VERSION,
        sha256,
      ),
    ).rejects.toThrow("Cloud-Stand");
  });
  it("keeps a recovery copy and replaces personal data atomically", async () => {
    const port = local();
    await port.bind("a", () => true);
    const before = await port.capture();
    const next = {
      ...before,
      data: {
        ...before.data,
        profile: {
          ...(before.data.profile as Record<string, string | number | null>),
          employer_name: "Neuer Arbeitgeber",
        },
      },
    };
    expect(await port.apply("a", before, receipt(next), () => true)).toBe(true);
    expect(await port.capture()).toEqual(next);
    expect(await port.recovery()).toEqual(before);
    expect((await port.state())?.baseline?.revision).toBe(1);
    expect(beforeReplace).toHaveBeenCalledOnce();
  });
  it("does not overwrite a local edit committed after the snapshot was captured", async () => {
    const port = local();
    await port.bind("a", () => true);
    const before = await port.capture();
    await saveAppointment(memory.db, {
      date: "2026-10-17",
      title: "Noch gespeichert",
      allDay: true,
      startTime: null,
      endTime: null,
      color: "#123456",
      note: null,
      notification: null,
    });
    const changed = await port.capture();
    expect(await port.apply("a", before, receipt(before), () => true)).toBe(false);
    expect(await port.capture()).toEqual(changed);
    expect(beforeReplace).not.toHaveBeenCalled();
    expect((await port.state())?.baseline).toBeNull();
  });
  it("rolls back data, recovery and sync state if restoration fails", async () => {
    const port = local();
    await port.bind("a", () => true);
    const before = await port.capture();
    const next = {
      ...before,
      data: {
        ...before.data,
        profile: {
          ...(before.data.profile as Record<string, string | number | null>),
          employer_name: "Andere Daten",
        },
      },
    };
    memory.fail = "DELETE FROM shift_entries";
    await expect(port.apply("a", before, receipt(next), () => true)).rejects.toThrow("injected");
    memory.fail = null;
    expect(await port.capture()).toEqual(before);
    expect((await port.state())?.baseline).toBeNull();
    expect(discard).toHaveBeenCalledOnce();
    expect(recoverNotifications).toHaveBeenCalledOnce();
  });
  it("rejects a late account change inside the transaction", async () => {
    const port = local();
    await port.bind("a", () => true);
    const before = await port.capture();
    const next = {
      ...before,
      data: {
        ...before.data,
        profile: {
          ...(before.data.profile as Record<string, string | number | null>),
          employer_name: "Nicht übernehmen",
        },
      },
    };
    let current = true;
    beforeReplace.mockImplementationOnce(async () => {
      current = false;
    });
    await expect(port.apply("a", before, receipt(next), () => current)).rejects.toThrow("Konto");
    expect(await port.capture()).toEqual(before);
    expect((await port.state())?.baseline).toBeNull();
  });
  it("never serializes credentials or cloud account metadata into a personal snapshot", async () => {
    const port = local();
    await port.bind("a", () => true);
    const snapshot = await port.capture();
    await port.stage(
      "a",
      {
        document: snapshot,
        sourceDocument: snapshot,
        expectedRevision: 0,
        mutationId: "pending-id",
      },
      () => true,
    );
    expect(await port.capture()).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("pending-id");
  });
});
