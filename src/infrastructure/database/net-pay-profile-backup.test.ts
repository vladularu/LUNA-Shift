import { LATEST_DATABASE_SCHEMA_VERSION } from "./migrations";
import canonicalize from "canonicalize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { settings } from "@/domain/net-pay-profile-test-fixtures";
import { restoreLocalBackup } from "./local-backup-restore";
import {
  LOCAL_BACKUP_VERSION,
  createLocalBackupDocument,
  loadLocalBackupSnapshot,
} from "./local-backup";
import { loadMonthlyNetPaySettings, saveMonthlyNetPaySettings } from "./net-pay-profile-repository";
import {
  exportTvlBackup,
  setupTvlShiftWork,
  tvlSha256,
  validateTvlBackup,
  type TvlShiftWorkFixture,
} from "./tvl-shift-work-test-fixtures";

interface MutableBackup {
  version: number;
  databaseSchemaVersion: number;
  data: Record<string, unknown>;
  integrity: { value: string };
}

async function changed(
  serialized: string,
  mutation: (root: MutableBackup) => void,
): Promise<string> {
  const root = JSON.parse(serialized) as MutableBackup;
  mutation(root);
  const { integrity: _, ...unsigned } = root;
  root.integrity.value = await tvlSha256(canonicalize(unsigned)!);
  return JSON.stringify(root);
}

describe("monthly net-pay profile backup compatibility", () => {
  let source: TvlShiftWorkFixture;
  let target: TvlShiftWorkFixture;
  beforeEach(async () => {
    source = await setupTvlShiftWork();
    target = await setupTvlShiftWork();
    await saveMonthlyNetPaySettings(source.db, { settings: settings(), expected: null });
    await saveMonthlyNetPaySettings(source.db, {
      settings: {
        ...settings("2026-09"),
        sfnBasicHourlyPayCents: 4_000,
        specialCases: ["ADDITIONAL_DEDUCTIONS"],
        profile: { ...settings().profile, taxClass: 4, factorPermille: 875 },
      },
      expected: null,
    });
  });
  afterEach(() => {
    source.adapter.database.close();
    target.adapter.database.close();
  });

  it("exports v20 and restores all profile fields, revisions and timestamps", async () => {
    const exported = await exportTvlBackup(source);
    expect(LOCAL_BACKUP_VERSION).toBe(20);
    expect(exported.document.databaseSchemaVersion).toBe(LATEST_DATABASE_SCHEMA_VERSION);
    expect(exported.document.data.netPayProfiles).toHaveLength(2);
    const original = await loadMonthlyNetPaySettings(source.db, "2026-09");
    await saveMonthlyNetPaySettings(target.db, { settings: settings("2026-08"), expected: null });
    await restoreLocalBackup(target.db, await validateTvlBackup(exported.serialized));
    expect(await loadMonthlyNetPaySettings(target.db, "2026-09")).toEqual(original);
    expect(await loadMonthlyNetPaySettings(target.db, "2026-07")).toEqual(
      await loadMonthlyNetPaySettings(source.db, "2026-07"),
    );
    expect(await loadMonthlyNetPaySettings(target.db, "2026-08")).toBeNull();
  });

  it.each(Array.from({ length: 19 }, (_, i) => i + 1))(
    "reads legacy v%i without inventing monthly profiles",
    async (version) => {
      const exported = await exportTvlBackup(source);
      const introduced: readonly (readonly [string, number])[] = [
        ["netPayProfiles", 20],
        ["drkTrainingMonthConfirmations", 19],
        ["drkEmployeeMonthConfirmations", 18],
        ["tvoedAnnexAPremiumFacts", 17],
        ["tvoedSueAllowanceConfirmations", 16],
        ["tvoedSueMonthConfirmations", 15],
        ["tvoedAnnexAMonthConfirmations", 14],
        ["caritasOvertime", 13],
        ["caritasMonthFacts", 11],
        ["caritasWorkDays", 10],
        ["tvlShiftWork", 9],
        ["tariffAnnualClaims", 8],
        ["actualAnnualPayments", 7],
        ["trainingProfiles", 6],
        ["shiftTrainingDetails", 6],
        ["paidAbsences", 5],
        ["overtimeAllocations", 4],
        ["allowanceDecisions", 3],
        ["remunerationProfiles", 2],
      ];
      const legacy = await changed(exported.serialized, (root) => {
        root.version = version;
        for (const [key, minimum] of introduced) if (version < minimum) delete root.data[key];
      });
      const parsed = await validateTvlBackup(legacy);
      expect(parsed.document.data.netPayProfiles).toEqual([]);
      await saveMonthlyNetPaySettings(target.db, { settings: settings(), expected: null });
      await restoreLocalBackup(target.db, parsed);
      expect(await loadMonthlyNetPaySettings(target.db, "2026-07")).toBeNull();
    },
  );

  it.each([
    "missing",
    "duplicate",
    "binding",
    "future-settings",
    "future-backup",
    "parent",
    "schema",
    "revision",
    "time",
    "extra",
    "negative-rate",
  ])("rejects %s before replacing data", async (mutation) => {
    const saved = await saveMonthlyNetPaySettings(target.db, {
      settings: settings(),
      expected: null,
    });
    const exported = await exportTvlBackup(source);
    const serialized = await changed(exported.serialized, (root) => {
      const rows = root.data.netPayProfiles as Record<string, unknown>[];
      const data = JSON.parse(rows[0].settings_json as string) as Record<string, unknown>;
      if (mutation === "missing") delete root.data.netPayProfiles;
      if (mutation === "duplicate") rows.push(rows[0]);
      if (mutation === "binding") rows[0].month = "2026-08";
      if (mutation === "future-settings") data.version = 2;
      if (mutation === "future-backup") root.version = 21;
      if (mutation === "parent") root.data.profile = null;
      if (mutation === "schema") root.databaseSchemaVersion = 31;
      if (mutation === "revision") rows[0].revision = 0;
      if (mutation === "time") rows[0].updated_at = "invalid";
      if (mutation === "extra") rows[0].extra = 1;
      if (mutation === "negative-rate") data.sfnBasicHourlyPayCents = -1;
      rows[0].settings_json = JSON.stringify(data);
    });
    await expect(validateTvlBackup(serialized)).rejects.toThrow();
    expect(await loadMonthlyNetPaySettings(target.db, "2026-07")).toEqual(saved);
  });

  it("detects changed profile JSON through the existing checksum", async () => {
    const exported = await exportTvlBackup(source);
    const root = JSON.parse(exported.serialized) as MutableBackup;
    const rows = root.data.netPayProfiles as Record<string, unknown>[];
    const value = JSON.parse(rows[0].settings_json as string);
    value.profile.taxClass = 3;
    rows[0].settings_json = JSON.stringify(value);
    await expect(validateTvlBackup(JSON.stringify(root))).rejects.toThrow("Prüfwert");
  });

  it("rolls all replaced data back when insertion fails", async () => {
    const saved = await saveMonthlyNetPaySettings(target.db, {
      settings: settings(),
      expected: null,
    });
    const shifts = target.adapter.database.prepare("SELECT * FROM shift_entries").all();
    const exported = await exportTvlBackup(source);
    const validated = await validateTvlBackup(exported.serialized);
    target.adapter.database.exec(
      "CREATE TRIGGER reject_net_pay BEFORE INSERT ON net_pay_profiles BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END;",
    );
    await expect(restoreLocalBackup(target.db, validated)).rejects.toThrow(
      "injected restore failure",
    );
    expect(await loadMonthlyNetPaySettings(target.db, "2026-07")).toEqual(saved);
    expect(target.adapter.database.prepare("SELECT * FROM shift_entries").all()).toEqual(shifts);
  });

  it("refuses to export corrupt persisted or supplied profile rows", async () => {
    const snapshot = await loadLocalBackupSnapshot(source.db);
    const badRow = { ...snapshot.netPayProfiles[0], month: "2026-08" };
    await expect(
      createLocalBackupDocument(
        { ...snapshot, netPayProfiles: [badRow] },
        { appVersion: null, createdAt: new Date(), sha256: tvlSha256 },
      ),
    ).rejects.toThrow();
    source.adapter.database
      .prepare("UPDATE net_pay_profiles SET updated_at='invalid' WHERE month='2026-07'")
      .run();
    await expect(loadLocalBackupSnapshot(source.db)).rejects.toThrow();
  });
});
