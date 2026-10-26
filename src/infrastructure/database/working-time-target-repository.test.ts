import canonicalize from "canonicalize";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateMonthlyWorkingTimeTarget } from "@/engine/working-time-target";
import { TariffAnnualTestDatabase } from "./tariff-annual-test-database";
import { loadProfile, saveProfile } from "./profile-repository";
import { saveShift } from "./calendar-entry-repository";
import { shift as shiftFixture } from "@/engine/remuneration-test-fixtures";
import { migrateDatabase } from "./migrations";
import {
  loadWorkingTimeTargetSettings,
  saveWorkingTimeTargetSettings,
} from "./working-time-target-repository";

import { decemberTargetContext } from "@/domain/working-time-target-test-fixtures";

describe("dated working time target persistence", () => {
  let adapter: TariffAnnualTestDatabase;
  beforeEach(async () => {
    adapter = new TariffAnnualTestDatabase();
    await adapter.setup();
  });
  afterEach(() => adapter.database.close());
  it("keeps target confirmations through note and premium edits but invalidates changed duty hours", async () => {
    let duty = await saveShift(adapter.db, {
      ...shiftFixture({ date: "2026-12-25", startTime: "08:00", endTime: "16:00" }),
      id: undefined,
    });
    await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: await loadWorkingTimeTargetSettings(adapter.db),
    });
    duty = await saveShift(adapter.db, {
      ...duty,
      expectedRevision: duty.revision,
      note: "Neue Notiz",
      holidayPremiumMode: "WITHOUT_TIME_OFF",
    });
    let loaded = await loadWorkingTimeTargetSettings(adapter.db);
    expect(loaded.staleDates).toEqual([]);
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-12",
        { federalState: "HE", weeklyMinutes: 2310 },
        undefined,
        loaded.context,
      ).targetMinutes,
    ).toBe(8778);
    await saveShift(adapter.db, { ...duty, expectedRevision: duty.revision, breakMinutes: 60 });
    loaded = await loadWorkingTimeTargetSettings(adapter.db);
    expect(loaded.staleDates).toEqual(["2026-12-25"]); // A daytime predecessor is irrelevant on 26 December.
  });
  it("upgrades unchanged legacy bindings once without losing historical confirmations", async () => {
    const duty = await saveShift(adapter.db, {
      ...shiftFixture({ date: "2026-12-25", startTime: "08:00", endTime: "16:00" }),
      id: undefined,
    });
    const original = await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: await loadWorkingTimeTargetSettings(adapter.db),
    });
    const shifts = await adapter.db.getAllAsync<{
      id: string;
      date: string;
      revision: number;
      updated_at: string;
      start_time: string | null;
      end_time: string | null;
    }>(
      "SELECT id,date,revision,updated_at,start_time,end_time FROM shift_entries WHERE deleted_at IS NULL ORDER BY date,id",
    );
    const profile = await loadProfile(adapter.db);
    const bindings = decemberTargetContext.days.map((day) => {
      const previous = new Date(day.date + "T12:00:00Z");
      previous.setUTCDate(previous.getUTCDate() - 1);
      return {
        date: day.date,
        signature: canonicalize({
          timeZone: profile!.timeZone,
          work: decemberTargetContext.periods.map(
            ({ validFrom: _from, validTo: _to, ...work }) => work,
          ),
          employed: true,
          shifts: shifts.filter(
            (shift) =>
              shift.date === previous.toISOString().slice(0, 10) || shift.date === day.date,
          ),
        })!,
      };
    });
    await adapter.db.runAsync(
      "UPDATE working_time_target_settings SET settings_json=? WHERE id='singleton'",
      JSON.stringify({ ...original.saved!.settings, planBindings: bindings }),
    );
    adapter.database.exec(
      "INSERT INTO dev_test_backups(month,payload,run_id,created_at) VALUES('2026-12','{}','target-binding-test','2026-01-01T00:00:00Z')",
    );
    expect((await loadWorkingTimeTargetSettings(adapter.db)).saved?.revision).toBe(
      original.saved!.revision,
    );
    adapter.database.exec("DELETE FROM dev_test_backups");
    const upgraded = await loadWorkingTimeTargetSettings(adapter.db);
    expect(upgraded.staleDates).toEqual([]);
    expect(upgraded.context).toEqual(decemberTargetContext);
    expect(upgraded.saved?.revision).toBe(original.saved!.revision + 1);
    expect((await loadWorkingTimeTargetSettings(adapter.db)).saved?.revision).toBe(
      upgraded.saved?.revision,
    );
    await saveShift(adapter.db, {
      ...duty,
      expectedRevision: duty.revision,
      holidayPremiumMode: "WITHOUT_TIME_OFF",
    });
    expect((await loadWorkingTimeTargetSettings(adapter.db)).staleDates).toEqual([]);
    // A legacy binding already stale before the upgrade cannot be silently re-confirmed.
    await adapter.db.runAsync(
      "UPDATE working_time_target_settings SET settings_json=? WHERE id='singleton'",
      JSON.stringify({ ...original.saved!.settings, planBindings: bindings }),
    );
    const staleLegacy = await loadWorkingTimeTargetSettings(adapter.db);
    expect(staleLegacy.staleDates).toContain("2026-12-25");
    expect(staleLegacy.context?.days.find((day) => day.date === "2026-12-25")?.rosterStatus).toBe(
      "DRAFT",
    );
  });
  it("requires a day-specific action to confirm new final facts", async () => {
    const empty = await loadWorkingTimeTargetSettings(adapter.db);
    await expect(
      saveWorkingTimeTargetSettings(adapter.db, {
        context: decemberTargetContext,
        expected: empty,
      }),
    ).rejects.toThrow("ausdrücklich bestätigen");
    expect((await loadWorkingTimeTargetSettings(adapter.db)).saved).toBeNull();
  });
  it("invalidates only dates affected by a changed plan, including an overnight predecessor", async () => {
    const empty = await loadWorkingTimeTargetSettings(adapter.db);
    await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: empty,
    });
    const work = await saveShift(adapter.db, {
      ...shiftFixture({ date: "2026-12-23", startTime: "22:00", endTime: "06:00" }),
      id: undefined,
    });
    let loaded = await loadWorkingTimeTargetSettings(adapter.db);
    expect(loaded.staleDates).toEqual(["2026-12-24"]);
    expect(loaded.context?.days.find((day) => day.date === "2026-12-25")?.rosterStatus).toBe(
      "FINAL",
    );
    await saveShift(adapter.db, { ...work, expectedRevision: work.revision, endTime: "07:00" });
    loaded = await loadWorkingTimeTargetSettings(adapter.db);
    expect(loaded.context?.days[0]).toMatchObject({
      rosterStatus: "DRAFT",
      lostMinutes: null,
      mustWorkElsewhere: null,
    });
    // A profile-only save must not silently refresh an old final confirmation.
    const stillStale = await saveWorkingTimeTargetSettings(adapter.db, {
      context: loaded.saved!.settings.context,
      expected: loaded,
    });
    expect(stillStale.staleDates).toEqual(["2026-12-24"]);
    const checked = await saveWorkingTimeTargetSettings(adapter.db, {
      context: stillStale.saved!.settings.context,
      expected: stillStale,
      confirmedDates: ["2026-12-24"],
    });
    expect(checked.staleDates).toEqual([]);
  });
  it("invalidates confirmations when the applicable work model changes", async () => {
    const first = await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: await loadWorkingTimeTargetSettings(adapter.db),
    });
    const changed = await saveWorkingTimeTargetSettings(adapter.db, {
      context: {
        ...decemberTargetContext,
        periods: [{ ...decemberTargetContext.periods[0], weeklyMinutes: 1920 }],
      },
      expected: first,
    });
    expect(changed.staleDates).toHaveLength(4);
  });
  it("blocks writes during a test-laboratory run and rolls back a failed write", async () => {
    const empty = await loadWorkingTimeTargetSettings(adapter.db);
    adapter.database.exec(
      "INSERT INTO dev_test_backups(month,payload,run_id,created_at) VALUES('2026-12','{}','target-test','2026-01-01T00:00:00Z')",
    );
    await expect(
      saveWorkingTimeTargetSettings(adapter.db, {
        context: { periods: [], days: [] },
        expected: empty,
      }),
    ).rejects.toThrow("Testlabor");
    adapter.database.exec("DELETE FROM dev_test_backups");
    adapter.fail = "INSERT INTO working_time_target_settings";
    await expect(
      saveWorkingTimeTargetSettings(adapter.db, {
        context: { periods: [], days: [] },
        expected: empty,
      }),
    ).rejects.toThrow("injected");
    expect((await loadWorkingTimeTargetSettings(adapter.db)).saved).toBeNull();
  });
  it("migrates additively without deriving claims or changing the work profile", async () => {
    const original = await loadProfile(adapter.db);
    await migrateDatabase(adapter.db);
    const snapshot = await loadWorkingTimeTargetSettings(adapter.db);
    expect(snapshot.saved).toBeNull();
    expect(snapshot.context).toBeUndefined();
    expect(await loadProfile(adapter.db)).toEqual(original);
  });
  it("roundtrips explicit BT-K facts and calculates the independent 8,778 minute reference", async () => {
    const loaded = await loadWorkingTimeTargetSettings(adapter.db);
    const saved = await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: loaded,
    });
    expect(saved.saved?.revision).toBe(1);
    expect(saved.context).toEqual(decemberTargetContext);
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-12",
        { federalState: "HE", weeklyMinutes: 2310 },
        undefined,
        saved.context,
      ).targetMinutes,
    ).toBe(8778);
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-11",
        { federalState: "HE", weeklyMinutes: 2310 },
        undefined,
        saved.context,
      ).status,
    ).toBe("UNAVAILABLE");
  });
  it("rejects concurrent writers and retains earlier history when a later period is appended", async () => {
    const empty = await loadWorkingTimeTargetSettings(adapter.db);
    const first = await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: empty,
    });
    await expect(
      saveWorkingTimeTargetSettings(adapter.db, {
        context: decemberTargetContext,
        confirmedDates: decemberTargetContext.days.map((day) => day.date),
        expected: empty,
      }),
    ).rejects.toThrow("zwischenzeitlich");
    const second = await saveWorkingTimeTargetSettings(adapter.db, {
      context: {
        ...decemberTargetContext,
        periods: [
          { ...decemberTargetContext.periods[0], validTo: "2026-12-31" },
          { ...decemberTargetContext.periods[0], validFrom: "2027-01-01", weeklyMinutes: 1920 },
        ],
      },
      expected: first,
    });
    expect(second.context?.periods).toHaveLength(2);
    expect(
      calculateMonthlyWorkingTimeTarget(
        "2026-12",
        { federalState: "HE", weeklyMinutes: 2310 },
        undefined,
        second.context,
      ).targetMinutes,
    ).toBe(8778);
  });
  it("invalidates roster confirmations after a time-zone change without rewriting saved facts", async () => {
    const empty = await loadWorkingTimeTargetSettings(adapter.db);
    const original = await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: empty,
    });
    const profile = (await loadProfile(adapter.db))!;
    await saveProfile(adapter.db, { ...profile, timeZone: "Europe/London" });
    const changed = await loadWorkingTimeTargetSettings(adapter.db);
    expect(changed.saved).toEqual(original.saved);
    expect(changed.context?.days.every((day) => day.rosterStatus === "DRAFT")).toBe(true);
    await expect(
      saveWorkingTimeTargetSettings(adapter.db, {
        context: decemberTargetContext,
        expected: original,
      }),
    ).rejects.toThrow("Dienstplan");
  });
  it("rejects corrupt future data instead of silently falling back", async () => {
    const empty = await loadWorkingTimeTargetSettings(adapter.db);
    await saveWorkingTimeTargetSettings(adapter.db, {
      context: decemberTargetContext,
      confirmedDates: decemberTargetContext.days.map((day) => day.date),
      expected: empty,
    });
    adapter.database
      .prepare("UPDATE working_time_target_settings SET settings_json=?")
      .run(JSON.stringify({ version: 2 }));
    await expect(loadWorkingTimeTargetSettings(adapter.db)).rejects.toThrow();
    await expect(
      saveWorkingTimeTargetSettings(adapter.db, {
        context: decemberTargetContext,
        confirmedDates: decemberTargetContext.days.map((day) => day.date),
        expected: empty,
      }),
    ).rejects.toThrow();
  });
});
