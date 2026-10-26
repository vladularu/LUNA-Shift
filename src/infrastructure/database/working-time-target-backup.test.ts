import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import {
  loadWorkingTimeTargetSettings,
  saveWorkingTimeTargetSettings,
} from "./working-time-target-repository";
import { loadProfile } from "./profile-repository";
import { restoreLocalBackup } from "./local-backup-restore";
import { LOCAL_BACKUP_VERSION, loadLocalBackupSnapshot } from "./local-backup";
import { LATEST_DATABASE_SCHEMA_VERSION } from "./migrations";
import {
  makePrivateCloudDocument,
  validatePrivateCloudDocument,
} from "../private-cloud/cloud-document";
import { mergePrivateCloudDocuments } from "@/domain/private-cloud-merge";
import {
  exportTvlBackup,
  resignTvlBackup,
  setupTvlShiftWork,
  validateTvlBackup,
  type TvlShiftWorkFixture,
} from "./tvl-shift-work-test-fixtures";

describe("working-time target backup v21", () => {
  let source: TvlShiftWorkFixture, target: TvlShiftWorkFixture;
  beforeEach(async () => {
    source = await setupTvlShiftWork();
    target = await setupTvlShiftWork();
    await saveWorkingTimeTargetSettings(source.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: await loadWorkingTimeTargetSettings(source.db),
    });
  });
  afterEach(() => {
    source.adapter.database.close();
    target.adapter.database.close();
  });
  it("roundtrips target settings in the existing private cloud document and accepts v20 history", async () => {
    const document = makePrivateCloudDocument(await loadLocalBackupSnapshot(source.db), {
      calendarImage: null,
      calendarImageStrength: "medium",
    });
    const sha256 = (await import("./tvl-shift-work-test-fixtures")).tvlSha256;
    const validated = await validatePrivateCloudDocument(
      document,
      LATEST_DATABASE_SCHEMA_VERSION,
      sha256,
    );
    await restoreLocalBackup(target.db, validated.backup);
    expect((await loadWorkingTimeTargetSettings(target.db)).saved).toEqual(
      (await loadWorkingTimeTargetSettings(source.db)).saved,
    );
    const { workingTimeTargetSettings: _target, ...legacyData } = document.data;
    const legacy = { ...document, backupVersion: 20, databaseSchemaVersion: 33, data: legacyData };
    const old = await validatePrivateCloudDocument(legacy, LATEST_DATABASE_SCHEMA_VERSION, sha256);
    expect(old.document.backupVersion).toBe(20);
    expect(old.backup.document.data.workingTimeTargetSettings).toEqual([]);
  });
  it("retains target data during a merge with an older cloud document and surfaces competing edits", async () => {
    const before = makePrivateCloudDocument(await loadLocalBackupSnapshot(target.db), {
      calendarImage: null,
      calendarImageStrength: "medium",
    });
    const ours = makePrivateCloudDocument(
      await loadLocalBackupSnapshot(source.db),
      before.presentation,
    );
    const { workingTimeTargetSettings: _target, ...legacyData } = before.data;
    const legacy = { ...before, backupVersion: 20, databaseSchemaVersion: 33, data: legacyData };
    const merged = mergePrivateCloudDocuments(legacy, ours, legacy);
    expect(merged.document.data.workingTimeTargetSettings).toEqual(
      ours.data.workingTimeTargetSettings,
    );
    const theirs = {
      ...ours,
      data: {
        ...ours.data,
        workingTimeTargetSettings: [
          {
            id: "singleton",
            settings_json: "competing edit",
            revision: 2,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        ],
      },
    };
    expect(mergePrivateCloudDocuments(before, ours, theirs).conflicts.length).toBeGreaterThan(0);
  });
  it("restores the exact context, revisions and timestamps and still calculates 146:18", async () => {
    const backup = await exportTvlBackup(source);
    expect(backup.document.version).toBe(21);
    const original = await loadWorkingTimeTargetSettings(source.db);
    await restoreLocalBackup(target.db, await validateTvlBackup(backup.serialized));
    const restored = await loadWorkingTimeTargetSettings(target.db);
    expect(restored).toEqual(original);
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-12",
        { federalState: "HE", weeklyMinutes: 2310 },
        undefined,
        restored.context,
      ).targetMinutes,
    ).toBe(8778);
  });
  it("roundtrips explicit BT-B through the existing backup format without altering legacy data", async () => {
    const context = {
      ...decemberTargetContext,
      periods: decemberTargetContext.periods.map((period) => ({
        ...period,
        weeklyMinutes: 2340,
        tariff: { kind: "TVOED_B" as const, version: "2026-01-01", scopeConfirmed: true },
      })),
      days: decemberTargetContext.days.map((day) => ({ ...day, lostMinutes: 468 })),
    };
    await saveWorkingTimeTargetSettings(source.db, {
      context,
      confirmedDates: context.days.map((day) => day.date),
      expected: await loadWorkingTimeTargetSettings(source.db),
    });
    const original = await loadWorkingTimeTargetSettings(source.db);
    const backup = await exportTvlBackup(source);
    expect(backup.document.version).toBe(LOCAL_BACKUP_VERSION);
    await restoreLocalBackup(target.db, await validateTvlBackup(backup.serialized));
    const restored = await loadWorkingTimeTargetSettings(target.db);
    expect(restored).toEqual(original);
    expect(restored.context?.periods[0].tariff.kind).toBe("TVOED_B");
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-12",
        { federalState: "HE", weeklyMinutes: 2340 },
        undefined,
        restored.context,
      ).targetMinutes,
    ).toBe(8892);
  });
  it("roundtrips TV-L without converting worked holidays into target deductions", async () => {
    const context = {
      ...decemberTargetContext,
      periods: decemberTargetContext.periods.map((period) => ({
        ...period,
        tariff: { kind: "TVL_KR" as const, version: "2026-02-14", scopeConfirmed: true },
      })),
      days: [24, 25, 26, 31].map((day) => ({
        date: "2026-12-" + day,
        rosterStatus: "FINAL" as const,
        disposition: [25, 26].includes(day) ? ("WORK_REQUIRED" as const) : ("RELEASED" as const),
        lostMinutes: 462,
      })),
    };
    await saveWorkingTimeTargetSettings(source.db, {
      context,
      confirmedDates: context.days.map((day) => day.date),
      expected: await loadWorkingTimeTargetSettings(source.db),
    });
    const original = await loadWorkingTimeTargetSettings(source.db);
    const backup = await exportTvlBackup(source);
    expect(backup.document.version).toBe(21);
    await restoreLocalBackup(target.db, await validateTvlBackup(backup.serialized));
    const restored = await loadWorkingTimeTargetSettings(target.db);
    expect(restored).toEqual(original);
    const result = calculateMonthlyWorkingTimeTarget(
      "2026-12",
      { federalState: "HE", weeklyMinutes: 2310 },
      undefined,
      restored.context,
    );
    expect(result).toMatchObject({
      targetMinutes: 9702,
      statutoryReductionMinutes: 0,
      tariffReductionMinutes: 924,
      status: "FINAL",
    });
    expect(result.notices.filter((n) => n.code === "HOLIDAY_TIME_OFF_SEPARATE")).toHaveLength(2);
  });
  it.each([1, 12, 19, 20])("reads legacy v%i without creating claims", async (version) => {
    const backup = await exportTvlBackup(source);
    const introduced = [
      ["remunerationProfiles", 2],
      ["allowanceDecisions", 3],
      ["overtimeAllocations", 4],
      ["paidAbsences", 5],
      ["trainingProfiles", 6],
      ["shiftTrainingDetails", 6],
      ["actualAnnualPayments", 7],
      ["tariffAnnualClaims", 8],
      ["tvlShiftWork", 9],
      ["caritasWorkDays", 10],
      ["caritasMonthFacts", 11],
      ["caritasOvertime", 13],
      ["tvoedAnnexAMonthConfirmations", 14],
      ["tvoedSueMonthConfirmations", 15],
      ["tvoedSueAllowanceConfirmations", 16],
      ["tvoedAnnexAPremiumFacts", 17],
      ["drkEmployeeMonthConfirmations", 18],
      ["drkTrainingMonthConfirmations", 19],
      ["netPayProfiles", 20],
      ["workingTimeTargetSettings", 21],
    ] as const;
    const old = await resignTvlBackup(backup.serialized, (root) => {
      root.version = version;
      for (const [key, since] of introduced) if (version < since) delete root.data[key];
    });
    await restoreLocalBackup(target.db, await validateTvlBackup(old));
    expect((await loadWorkingTimeTargetSettings(target.db)).context).toBeUndefined();
  });
  it.each([
    "future-backup",
    "future-settings",
    "no-parent",
    "schema",
    "duplicate",
    "missing",
    "revision",
    "timestamp",
    "unexpected-key",
  ])("rejects %s before replacing user data", async (kind) => {
    const original = await loadProfile(target.db);
    const backup = await exportTvlBackup(source);
    const bad = await resignTvlBackup(backup.serialized, (root) => {
      const rows = root.data.workingTimeTargetSettings as Record<string, unknown>[];
      if (kind === "future-backup") root.version = LOCAL_BACKUP_VERSION + 1;
      if (kind === "future-settings") rows[0].settings_json = '{"version":2}';
      if (kind === "no-parent") root.data.profile = null;
      if (kind === "schema") root.databaseSchemaVersion = 33;
      if (kind === "duplicate") rows.push(rows[0]);
      if (kind === "missing") delete root.data.workingTimeTargetSettings;
      if (kind === "revision") rows[0].revision = 0;
      if (kind === "timestamp") rows[0].updated_at = "2000-01-01T00:00:00Z";
      if (kind === "unexpected-key") rows[0].extra = true;
    });
    await expect(validateTvlBackup(bad)).rejects.toThrow();
    expect(await loadProfile(target.db)).toEqual(original);
  });
  it("rolls back the entire restore if inserting the target settings fails", async () => {
    const profile = await loadProfile(target.db);
    const shifts = target.adapter.database.prepare("SELECT * FROM shift_entries").all();
    const backup = await exportTvlBackup(source);
    target.adapter.database.exec(
      "CREATE TRIGGER reject_targets BEFORE INSERT ON working_time_target_settings BEGIN SELECT RAISE(ABORT,'target restore failure'); END;",
    );
    await expect(
      restoreLocalBackup(target.db, await validateTvlBackup(backup.serialized)),
    ).rejects.toThrow("target restore failure");
    expect(await loadProfile(target.db)).toEqual(profile);
    expect(target.adapter.database.prepare("SELECT * FROM shift_entries").all()).toEqual(shifts);
    expect((await loadWorkingTimeTargetSettings(target.db)).saved).toBeNull();
  });
});
