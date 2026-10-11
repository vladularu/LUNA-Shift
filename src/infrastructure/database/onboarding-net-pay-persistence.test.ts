import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import {
  EMPTY_TARIFF_SELECTION,
  onboardingTariffProfile,
  type OnboardingTariffMode,
  type OnboardingTariffSelection,
} from "@/features/onboarding/onboarding-tariff-values";
import { loadProfile, saveProfile } from "./profile-repository";
import {
  loadApplicableNetPaySettings,
  saveContinuousNetPaySettings,
} from "./net-pay-profile-repository";
import { restoreLocalBackup } from "./local-backup-restore";
import {
  exportTvlBackup,
  setupTvlShiftWork,
  validateTvlBackup,
  type TvlShiftWorkFixture,
} from "./tvl-shift-work-test-fixtures";

const cases: readonly [OnboardingTariffMode, Partial<OnboardingTariffSelection>][] = [
  ["TVOED_P", { group: "P8", level: 4, sector: "BT_K", tariffRegion: "OTHER" }],
  ["TVOED_E", { group: "E8", level: 4, sector: "BT_K", tariffRegion: "OTHER" }],
  ["TVL_KR", { group: "KR8", level: 4, universityRegion: "WEST" }],
  ["TVH_KR", { group: "KR5", level: "1a", fullTime: 2310 }],
  ["TVUK_NURSING", { group: "PUK8", level: 7 }],
  ["TVAOED_PFLEGE", { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" }],
  ["TVAL_PFLEGE", { trainingYear: 3, universityRegion: "EAST" }],
];

describe("onboarding and net-pay acceptance integration", () => {
  let source: TvlShiftWorkFixture;
  let restored: TvlShiftWorkFixture;
  beforeEach(async () => {
    source = await setupTvlShiftWork();
    restored = await setupTvlShiftWork();
  });
  afterEach(() => {
    source.adapter.database.close();
    restored.adapter.database.close();
  });
  it.each(cases)(
    "preserves %s and dated net-pay settings when check evidence is saved and restored",
    async (mode, details) => {
      const profile = await saveProfile(source.db, {
        ...onboardingTariffProfile({ ...EMPTY_TARIFF_SELECTION, mode, ...details }, 1800),
        federalState: "BY",
        holidayRegion: "UNKNOWN",
        industry: "HEALTHCARE",
        weeklyMinutes: 1800,
        timeZone: "Europe/Berlin",
      });
      const net = await saveContinuousNetPaySettings(source.db, {
        settings: automatedSettings("2026-06"),
        expectedTimeline: [],
      });
      const updated = await saveProfile(source.db, {
        ...profile,
        allEmploymentWorkRecorded: true,
        regularRotatingNightWork: false,
        sundayHolidayWorkEligible: null,
        holidayRegion: "NONE",
      });
      expect(updated).toEqual({
        ...profile,
        allEmploymentWorkRecorded: true,
        regularRotatingNightWork: false,
        sundayHolidayWorkEligible: null,
        holidayRegion: "NONE",
        updatedAt: updated.updatedAt,
      });
      expect((await loadApplicableNetPaySettings(source.db, "2026-10")).saved).toEqual(net);
      const backup = await exportTvlBackup(source);
      await restoreLocalBackup(restored.db, await validateTvlBackup(backup.serialized));
      expect(await loadProfile(restored.db)).toEqual(updated);
      expect((await loadApplicableNetPaySettings(restored.db, "2026-10")).saved).toEqual(net);
    },
  );
});
