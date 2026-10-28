import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { subscribeNetPayProfiles } from "./net-pay-profile-events";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import { NET_PAY_PENSION_OPTIONS } from "@/domain/net-pay-pension-schemes";
import {
  loadApplicableNetPaySettings,
  loadNetPayProfileTimeline,
  saveContinuousNetPaySettings,
  saveMonthlyNetPaySettings,
  deleteMonthlyNetPaySettings,
  resetAnnualSalaryPayments,
} from "./net-pay-profile-repository";
import { restoreLocalBackup } from "./local-backup-restore";
import {
  exportTvlBackup,
  setupTvlShiftWork,
  validateTvlBackup,
  type TvlShiftWorkFixture,
} from "./tvl-shift-work-test-fixtures";
import { generateTestRun, setDeveloperMode } from "./dev-tools-repository";
import { loadProfile } from "./profile-repository";

describe("continuous net-pay persistence", () => {
  let source: TvlShiftWorkFixture;
  let target: TvlShiftWorkFixture;
  beforeEach(async () => {
    source = await setupTvlShiftWork();
    target = await setupTvlShiftWork();
  });
  afterEach(() => {
    source.adapter.database.close();
    target.adapter.database.close();
  });
  it("publishes timeline invalidation after commits, never after a rolled-back conflict", async () => {
    const transactions: boolean[] = [];
    const unsubscribe = subscribeNetPayProfiles(source.db, () => {
      transactions.push(source.adapter.database.inTransaction);
    });
    const first = await saveContinuousNetPaySettings(source.db, {
      settings: automatedSettings("2026-10"),
      expectedTimeline: [],
    });
    await expect(
      saveContinuousNetPaySettings(source.db, {
        settings: automatedSettings("2026-11"),
        expectedTimeline: [],
      }),
    ).rejects.toThrow("zwischenzeitlich");
    expect(transactions).toEqual([false]);
    const monthly = await saveMonthlyNetPaySettings(source.db, {
      settings: { ...settings(), month: "2027-01" },
      expected: null,
    });
    await deleteMonthlyNetPaySettings(source.db, "2027-01", monthly);
    await resetAnnualSalaryPayments(source.db, { year: 2026, expectedTimeline: [first] });
    expect(transactions).toEqual([false, false, false, false]);
    unsubscribe();
  });
  it.each(["2026-01", "2026-10", "2027-06"])(
    "applies the first setup in %s from January with a single dated row",
    async (month) => {
      const saved = await saveContinuousNetPaySettings(source.db, {
        settings: automatedSettings(month),
        expectedTimeline: [],
      });
      const year = month.slice(0, 4);
      expect(saved.settings.month).toBe(year + "-01");
      for (let index = 1; index <= 12; index++) {
        const targetMonth = year + "-" + String(index).padStart(2, "0");
        expect((await loadApplicableNetPaySettings(source.db, targetMonth)).saved).toEqual(saved);
      }
      expect(
        (await loadApplicableNetPaySettings(source.db, Number(year) - 1 + "-12")).saved,
      ).toBeNull();
      expect(await loadNetPayProfileTimeline(source.db)).toEqual([saved]);
    },
  );
  it("keeps January through June when the tax class changes from July", async () => {
    const january = await saveContinuousNetPaySettings(source.db, {
      settings: automatedSettings("2026-10"),
      expectedTimeline: [],
    });
    const next = automatedSettings("2026-07");
    const july = await saveContinuousNetPaySettings(source.db, {
      settings: { ...next, profile: { ...next.profile, taxClass: 4 } },
      expectedTimeline: [january],
    });
    expect(july.settings.month).toBe("2026-07");
    for (let index = 1; index <= 12; index++) {
      const result = await loadApplicableNetPaySettings(
        source.db,
        "2026-" + String(index).padStart(2, "0"),
      );
      expect(result.saved).toEqual(index < 7 ? january : july);
    }
    expect(await loadNetPayProfileTimeline(source.db)).toEqual([january, july]);
  });
  it("does not backdate a later change just because it is in a new year", async () => {
    const january = await saveContinuousNetPaySettings(source.db, {
      settings: automatedSettings("2026-10"),
      expectedTimeline: [],
    });
    const next = automatedSettings("2027-10");
    const october = await saveContinuousNetPaySettings(source.db, {
      settings: { ...next, profile: { ...next.profile, taxClass: 4 } },
      expectedTimeline: [january],
    });
    expect(october.settings.month).toBe("2027-10");
    expect((await loadApplicableNetPaySettings(source.db, "2027-09")).saved).toEqual(january);
    expect((await loadApplicableNetPaySettings(source.db, "2027-10")).saved).toEqual(october);
  });
  it("blocks first-year setup when an earlier affected month has an active test run", async () => {
    await setDeveloperMode(source.db, true);
    await generateTestRun(
      source.db,
      { startMonth: "2026-09", scenario: "NORMAL_ROTATION", range: 1 },
      (await loadProfile(source.db))!,
    );
    await expect(
      saveContinuousNetPaySettings(source.db, {
        settings: automatedSettings("2026-10"),
        expectedTimeline: [],
      }),
    ).rejects.toThrow("Testlabor");
    expect(await loadNetPayProfileTimeline(source.db)).toHaveLength(0);
  });
  it.each(NET_PAY_PENSION_OPTIONS.map(({ value }) => value))(
    "restores and inherits the pension model %s without changing it",
    async (pensionScheme) => {
      const initial = automatedSettings("2026-06");
      const saved = await saveContinuousNetPaySettings(source.db, {
        settings: { ...initial, automation: { ...initial.automation!, pensionScheme } },
        expectedTimeline: [],
      });
      const exported = await exportTvlBackup(source);
      await restoreLocalBackup(target.db, await validateTvlBackup(exported.serialized));
      expect((await loadApplicableNetPaySettings(target.db, "2026-10")).saved).toEqual(saved);
      expect(saved.settings.automation?.pensionScheme).toBe(pensionScheme);
    },
  );
  it.each([null, 0, 100, 350])(
    "backs up and restores an EZVK employee share of %s",
    async (pensionEmployeeRateBps) => {
      const initial = automatedSettings("2026-06");
      const saved = await saveContinuousNetPaySettings(source.db, {
        settings: {
          ...initial,
          automation: {
            ...initial.automation!,
            pensionScheme: "EZVK_KARLSRUHE",
            pensionEmployeeRateBps,
          },
        },
        expectedTimeline: [],
      });
      expect((await loadApplicableNetPaySettings(source.db, "2026-10")).saved).toEqual(saved);
      const exported = await exportTvlBackup(source);
      await restoreLocalBackup(target.db, await validateTvlBackup(exported.serialized));
      expect((await loadApplicableNetPaySettings(target.db, "2026-10")).saved).toEqual(saved);
      expect(saved.settings.automation?.pensionEmployeeRateBps).toBe(pensionEmployeeRateBps);
    },
  );
  it("restores dated changes and old exact monthly records without generating rows for later months", async () => {
    const july = await saveMonthlyNetPaySettings(source.db, {
      settings: settings(),
      expected: null,
    });
    await saveContinuousNetPaySettings(source.db, {
      settings: automatedSettings("2026-06"),
      expectedTimeline: await loadNetPayProfileTimeline(source.db),
    });
    const august = await saveContinuousNetPaySettings(source.db, {
      settings: automatedSettings("2026-08"),
      expectedTimeline: await loadNetPayProfileTimeline(source.db),
    });
    const exported = await exportTvlBackup(source);
    await restoreLocalBackup(target.db, await validateTvlBackup(exported.serialized));
    expect((await loadApplicableNetPaySettings(target.db, "2026-07")).saved).toEqual(july);
    expect((await loadApplicableNetPaySettings(target.db, "2026-12")).saved).toEqual(august);
    expect(await loadNetPayProfileTimeline(target.db)).toHaveLength(3);
  });
  it("detects stale inherited sources and inserted future changes inside the write transaction", async () => {
    await saveContinuousNetPaySettings(source.db, {
      settings: automatedSettings(),
      expectedTimeline: [],
    });
    const stale = await loadNetPayProfileTimeline(source.db);
    await saveContinuousNetPaySettings(source.db, {
      settings: { ...automatedSettings(), profile: { ...settings().profile, taxClass: 3 } },
      expectedTimeline: stale,
    });
    await expect(
      saveContinuousNetPaySettings(source.db, {
        settings: automatedSettings("2026-08"),
        expectedTimeline: stale,
      }),
    ).rejects.toThrow("zwischenzeitlich");
    expect(await loadNetPayProfileTimeline(source.db)).toHaveLength(2);
  });
  it("blocks an effective change that would influence a later active test month", async () => {
    await setDeveloperMode(source.db, true);
    await generateTestRun(
      source.db,
      { startMonth: "2026-09", scenario: "NORMAL_ROTATION", range: 1 },
      (await loadProfile(source.db))!,
    );
    await expect(
      saveContinuousNetPaySettings(source.db, {
        settings: automatedSettings("2026-08"),
        expectedTimeline: [],
      }),
    ).rejects.toThrow("Testlabor");
    expect(await loadNetPayProfileTimeline(source.db)).toHaveLength(0);
  });
});
