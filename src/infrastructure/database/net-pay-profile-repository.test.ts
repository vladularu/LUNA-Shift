import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settings } from "@/domain/net-pay-profile-test-fixtures";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { loadProfile } from "./profile-repository";
import { generateTestRun, restoreTestBackup, setDeveloperMode } from "./dev-tools-repository";
import { migrateDatabase } from "./migrations";
import {
  deleteMonthlyNetPaySettings,
  loadMonthlyNetPaySettings,
  mapNetPayProfileRow,
  NetPayProfileConflictError,
  saveMonthlyNetPaySettings,
} from "./net-pay-profile-repository";
import { setupTvlShiftWork, type TvlShiftWorkFixture } from "./tvl-shift-work-test-fixtures";

describe("local monthly net-pay profile storage", () => {
  let f: TvlShiftWorkFixture;
  beforeEach(async () => {
    f = await setupTvlShiftWork();
  });
  afterEach(() => {
    vi.useRealTimers();
    f.adapter.database.close();
  });

  it("migrates once and reads exactly the requested month without an implicit fallback", async () => {
    await migrateDatabase(f.db);
    expect(
      f.adapter.database
        .prepare("SELECT count(*) AS count FROM schema_migrations WHERE version=32")
        .get(),
    ).toEqual({ count: 1 });
    const july = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    expect(july.revision).toBe(1);
    expect(await loadMonthlyNetPaySettings(f.db, "2026-07")).toEqual(july);
    expect(await loadMonthlyNetPaySettings(f.db, "2026-08")).toBeNull();
  });
  it("roundtrips cash-month payments, their revisions and annual payroll facts through SQLite", async () => {
    const initial = automatedSettings("2026-10");
    const value = {
      ...initial,
      automation: {
        ...initial.automation!,
        annualPayments: [
          {
            revision: 1,
            payoutMonth: "2026-11",
            grossCents: 360_000,
            netBasis: {
              kind: "PAYROLL" as const,
              annualTaxableGrossCents: 4_800_000,
              socialInsuranceDays: 330,
              healthAssessedCents: 4_400_000,
              pensionAssessedCents: 4_400_000,
            },
          },
        ],
      },
    };
    const saved = await saveMonthlyNetPaySettings(f.db, { settings: value, expected: null });
    expect((await loadMonthlyNetPaySettings(f.db, "2026-10"))?.settings).toEqual(value);
    const cancelled = {
      ...value,
      automation: {
        ...value.automation,
        annualPayments: value.automation.annualPayments.map((p) => ({
          ...p,
          grossCents: 0,
          revision: 2,
        })),
      },
    };
    await saveMonthlyNetPaySettings(f.db, { settings: cancelled, expected: saved });
    expect(
      (await loadMonthlyNetPaySettings(f.db, "2026-10"))?.settings.automation?.annualPayments?.[0],
    ).toMatchObject({ grossCents: 0, revision: 2 });
  });
  it("updates one month and retains a past month's complete settings", async () => {
    const july = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    const august = await saveMonthlyNetPaySettings(f.db, {
      settings: settings("2026-08"),
      expected: null,
    });
    const updated = await saveMonthlyNetPaySettings(f.db, {
      settings: { ...august.settings, profile: { ...august.settings.profile, taxClass: 3 } },
      expected: august,
    });
    expect(updated.revision).toBe(2);
    expect(updated.createdAt).toBe(august.createdAt);
    expect(await loadMonthlyNetPaySettings(f.db, "2026-07")).toEqual(july);
  });
  it("rejects stale writes, creates and deletes before changing the row", async () => {
    const saved = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    const updated = await saveMonthlyNetPaySettings(f.db, {
      settings: saved.settings,
      expected: saved,
    });
    await expect(
      saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: saved }),
    ).rejects.toBeInstanceOf(NetPayProfileConflictError);
    await expect(
      saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null }),
    ).rejects.toBeInstanceOf(NetPayProfileConflictError);
    await expect(deleteMonthlyNetPaySettings(f.db, "2026-07", saved)).rejects.toBeInstanceOf(
      NetPayProfileConflictError,
    );
    expect(await loadMonthlyNetPaySettings(f.db, "2026-07")).toEqual(updated);
  });
  it("detects a deleted and recreated profile even if its revision and timestamp match", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T21:00:00Z"));
    const saved = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    await deleteMonthlyNetPaySettings(f.db, "2026-07", saved);
    const recreated = await saveMonthlyNetPaySettings(f.db, {
      settings: { ...settings(), profile: { ...settings().profile, taxClass: 3 } },
      expected: null,
    });
    expect(recreated.revision).toBe(saved.revision);
    expect(recreated.updatedAt).toBe(saved.updatedAt);
    await expect(
      saveMonthlyNetPaySettings(f.db, { settings: saved.settings, expected: saved }),
    ).rejects.toBeInstanceOf(NetPayProfileConflictError);
  });
  it("deletes exactly one month and permits an idempotent confirmed absence", async () => {
    const saved = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    await saveMonthlyNetPaySettings(f.db, { settings: settings("2026-08"), expected: null });
    await deleteMonthlyNetPaySettings(f.db, saved.settings.month, saved);
    await deleteMonthlyNetPaySettings(f.db, saved.settings.month, null);
    expect(await loadMonthlyNetPaySettings(f.db, "2026-07")).toBeNull();
    expect(await loadMonthlyNetPaySettings(f.db, "2026-08")).not.toBeNull();
  });
  it("migrates an existing v31 database without changing user data", async () => {
    const profile = await loadProfile(f.db);
    f.adapter.database.exec(
      "DROP TABLE net_pay_profiles; DELETE FROM schema_migrations WHERE version=32;",
    );
    await migrateDatabase(f.db);
    expect(await loadProfile(f.db)).toEqual(profile);
    expect(await loadMonthlyNetPaySettings(f.db, "2026-07")).toBeNull();
  });
  it("rejects invalid settings before a write and corrupt stored month bindings before reuse", async () => {
    await expect(
      saveMonthlyNetPaySettings(f.db, {
        settings: { ...settings(), month: "2026-13" },
        expected: null,
      }),
    ).rejects.toThrow();
    const saved = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    f.adapter.database
      .prepare("UPDATE net_pay_profiles SET settings_json=? WHERE month=?")
      .run(JSON.stringify(settings("2026-08")), "2026-07");
    await expect(loadMonthlyNetPaySettings(f.db, "2026-07")).rejects.toThrow("Monatsbindung");
    await expect(
      saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: saved }),
    ).rejects.toThrow("Monatsbindung");
  });
  it("rejects malformed row versions, revisions and timestamps", () => {
    const row = {
      month: "2026-07",
      settings_json: JSON.stringify(settings()),
      revision: 1,
      created_at: "2026-10-09T21:00:00Z",
      updated_at: "2026-10-09T21:00:00Z",
    };
    for (const patch of [
      { revision: 0 },
      { revision: 1.5 },
      { settings_json: '{"version":2}' },
      { updated_at: "invalid" },
      { created_at: "2026-10-10T21:00:00Z" },
      { extra: true },
    ])
      expect(() => mapNetPayProfileRow({ ...row, ...patch })).toThrow();
  });
  it("keeps timestamps valid when the system clock moves backwards", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T21:00:00Z"));
    const saved = await saveMonthlyNetPaySettings(f.db, { settings: settings(), expected: null });
    vi.setSystemTime(new Date("2026-10-08T21:00:00Z"));
    const updated = await saveMonthlyNetPaySettings(f.db, {
      settings: saved.settings,
      expected: saved,
    });
    expect(updated.updatedAt).toBe(saved.updatedAt);
    expect(updated.revision).toBe(2);
  });
  it("preserves profiles through a real developer test run and blocks edits for its month", async () => {
    const saved = await saveMonthlyNetPaySettings(f.db, {
      settings: settings("2026-09"),
      expected: null,
    });
    await setDeveloperMode(f.db, true);
    const profile = (await loadProfile(f.db))!;
    await generateTestRun(
      f.db,
      { startMonth: "2026-09", scenario: "NORMAL_ROTATION", range: 1 },
      profile,
    );
    await expect(
      saveMonthlyNetPaySettings(f.db, { settings: saved.settings, expected: saved }),
    ).rejects.toThrow("Testlabor");
    await expect(deleteMonthlyNetPaySettings(f.db, "2026-09", saved)).rejects.toThrow("Testlabor");
    expect(await loadMonthlyNetPaySettings(f.db, "2026-09")).toEqual(saved);
    await restoreTestBackup(f.db, ["2026-09"]);
    expect(await loadMonthlyNetPaySettings(f.db, "2026-09")).toEqual(saved);
    expect(
      (await saveMonthlyNetPaySettings(f.db, { settings: saved.settings, expected: saved }))
        .revision,
    ).toBe(2);
  });
});
