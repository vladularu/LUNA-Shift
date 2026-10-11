import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { settings } from "@/domain/net-pay-profile-test-fixtures";
import { NET_PAY_PENSION_OPTIONS } from "@/domain/net-pay-pension-schemes";
import {
  loadApplicableNetPaySettings,
  loadNetPayProfileTimeline,
  saveContinuousNetPaySettings,
  saveMonthlyNetPaySettings,
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
    expect(await loadNetPayProfileTimeline(source.db)).toHaveLength(1);
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
