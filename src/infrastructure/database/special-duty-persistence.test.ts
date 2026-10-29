import {
  makePrivateCloudDocument,
  validatePrivateCloudDocument,
} from "../private-cloud/cloud-document";
import { loadLocalBackupSnapshot } from "./local-backup";
import {
  tvlSha256,
  setupTvlShiftWork,
  exportTvlBackup,
  validateTvlBackup,
} from "./tvl-shift-work-test-fixtures";
import { LATEST_DATABASE_SCHEMA_VERSION } from "./migrations";
import { describe, expect, it } from "vitest";
import { newSpecialDuty, plannedSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import { listCalendarEntries, saveShift } from "./calendar-entry-repository";
import { listTemplates, saveTemplate } from "./shift-template-repository";
import { restoreLocalBackup } from "./local-backup-restore";
import { quickEntryShiftInputFromTemplate } from "@/features/calendar/quick-entry-actions";

describe("special-duty storage", () => {
  it("roundtrips a dated standby agreement through backup 23 and cloud and clears copied ordinals", async () => {
    const source = await setupTvlShiftWork();
    const target = await setupTvlShiftWork();
    try {
      const duty = {
        ...newSpecialDuty("STANDBY", "06:00", "14:00", "Europe/Berlin"),
        version: 2 as const,
        standbyLevel: "B" as const,
        settlement: "TIME_OFF" as const,
        standbyAgreement: {
          ...newStandbyAgreement("TVL_43"),
          rule: "STANDARD" as const,
          sequence: 9,
          payGroup: "KR_VI",
          timeOffMode: "WEIGHTED" as const,
        },
      };
      const saved = await saveShift(source.db, {
        ...source.shift,
        expectedRevision: source.shift.revision,
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 0,
        specialDuty: duty,
      });
      const cloud = makePrivateCloudDocument(await loadLocalBackupSnapshot(source.db), {
        calendarImage: null,
        calendarImageStrength: "medium",
      });
      expect(cloud.backupVersion).toBe(23);
      await validatePrivateCloudDocument(cloud, LATEST_DATABASE_SCHEMA_VERSION, tvlSha256);
      await expect(
        validatePrivateCloudDocument(
          { ...cloud, backupVersion: 22 },
          LATEST_DATABASE_SCHEMA_VERSION,
          tvlSha256,
        ),
      ).rejects.toThrow();
      const file = await exportTvlBackup(source);
      expect(file.document.version).toBe(23);
      await restoreLocalBackup(target.db, await validateTvlBackup(file.serialized));
      expect((await listCalendarEntries(target.db)).find((row) => row.id === saved.id)?.kind).toBe(
        "SHIFT",
      );
      expect(
        (await listCalendarEntries(target.db)).find((row) => row.id === saved.id),
      ).toMatchObject({ specialDuty: duty });
      const template = await saveTemplate(source.db, {
        name: "Bereitschaft",
        type: "CUSTOM",
        startTime: "06:00",
        endTime: "14:00",
        breakMinutes: 0,
        color: "#123456",
        symbol: "B",
        sortOrder: 30,
        specialDuty: plannedSpecialDuty(duty),
      });
      expect(template.specialDuty?.standbyAgreement).toEqual({
        ...duty.standbyAgreement,
        sequence: null,
      });
      const copied = await saveShift(
        source.db,
        quickEntryShiftInputFromTemplate(template, "2026-10-29"),
      );
      expect(copied.specialDuty?.standbyAgreement?.sequence).toBeNull();
      expect(copied.specialDuty?.standbyAgreement?.payGroup).toBe("KR_VI");
    } finally {
      source.adapter.database.close();
      target.adapter.database.close();
    }
  });
  it("roundtrips linked parts and callouts through SQLite and a signed backup", async () => {
    const source = await setupTvlShiftWork();
    const target = await setupTvlShiftWork();
    try {
      const duty = {
        ...newSpecialDuty("ON_CALL", "18:00", "08:00", "Europe/Berlin"),
        calloutsComplete: true,
        callouts: [
          {
            kind: "ON_SITE" as const,
            start: 1445,
            end: 1470,
            departure: 1430,
            returned: 1485,
            breakMinutes: 0,
          },
        ],
      };
      const saved = await saveShift(source.db, {
        ...source.shift,
        expectedRevision: source.shift.revision,
        startTime: "18:00",
        endTime: "08:00",
        breakMinutes: 0,
        specialDuty: duty,
      });
      expect(
        (await listCalendarEntries(source.db)).find((entry) => entry.id === saved.id),
      ).toMatchObject({ specialDuty: duty });
      const cloud = makePrivateCloudDocument(await loadLocalBackupSnapshot(source.db), {
        calendarImage: null,
        calendarImageStrength: "medium",
      });
      const checked = await validatePrivateCloudDocument(
        cloud,
        LATEST_DATABASE_SCHEMA_VERSION,
        tvlSha256,
      );
      expect(
        JSON.parse(
          checked.backup.document.data.shifts.find((row) => row.id === saved.id)!
            .special_duty_json as string,
        ),
      ).toEqual(duty);
      const file = await exportTvlBackup(source);
      await restoreLocalBackup(target.db, await validateTvlBackup(file.serialized));
      expect(
        (await listCalendarEntries(target.db)).find((entry) => entry.id === saved.id),
      ).toMatchObject({ specialDuty: duty });
      const revised = await saveShift(target.db, {
        ...saved,
        expectedRevision: saved.revision,
        note: "Nachgetragen",
      });
      expect(revised.specialDuty).toEqual(duty);
      await expect(
        saveShift(target.db, { ...saved, expectedRevision: saved.revision, specialDuty: null }),
      ).rejects.toThrow();
    } finally {
      source.adapter.database.close();
      target.adapter.database.close();
    }
  });

  it("keeps a split template and stamps all parts as one atomic entry", async () => {
    const fixture = await setupTvlShiftWork();
    try {
      const duty = {
        ...newSpecialDuty("SPLIT", "06:00", "10:00", "Europe/Berlin"),
        parts: [{ start: 960, end: 1200, breakMinutes: 0 }],
      };
      const template = await saveTemplate(fixture.db, {
        name: "Geteilt",
        type: "CUSTOM",
        startTime: "06:00",
        endTime: "10:00",
        breakMinutes: 0,
        color: "#123456",
        symbol: "D",
        sortOrder: 30,
        specialDuty: duty,
      });
      expect(
        (await listTemplates(fixture.db)).find((item) => item.id === template.id)?.specialDuty,
      ).toEqual(duty);
      const entry = await saveShift(
        fixture.db,
        quickEntryShiftInputFromTemplate(template, "2026-10-29"),
      );
      expect(entry.specialDuty).toEqual(duty);
      expect(entry.templateId).toBe(template.id);
    } finally {
      fixture.adapter.database.close();
    }
  });
});
