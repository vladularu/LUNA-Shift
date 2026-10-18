import { describe, expect, it } from "vitest";
import { annualSalaryProposal } from "./annual-salary-proposal";
import { forecastProfile } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { UserProfile } from "@/domain/types";

const context = {
  entries: [],
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
  resolver: bundledRuleResolver,
};
const ordinary = { ...forecastProfile, tariff: null };
describe("dated and reviewable tariff amount proposals", () => {
  it.each<readonly [string, UserProfile, number, readonly string[]]>([
    ["TVöD P8", forecastProfile, 9000, ["2026-07", "2026-08", "2026-09"]],
    [
      "TVöD P9",
      { ...forecastProfile, tariff: { ...forecastProfile.tariff!, payGroup: "P9" } },
      8500,
      ["2026-07", "2026-08", "2026-09"],
    ],
    [
      "TVöD E7 Krankenhaus",
      {
        ...ordinary,
        vkaETariff: { payGroup: "E7", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
      },
      9000,
      ["2026-07", "2026-08", "2026-09"],
    ],
    [
      "TV-L KR12",
      { ...ordinary, tvlKrTariff: { payGroup: "KR12", payLevel: 4, universityRegion: "WEST" } },
      7435,
      ["2026-07", "2026-08", "2026-09"],
    ],
    [
      "TV-H KR8",
      { ...ordinary, tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 } },
      9000,
      ["2026-07", "2026-08", "2026-09"],
    ],
    [
      "TV-UK",
      { ...ordinary, tvUkNursingTariff: { payGroup: "PUK7", payLevel: 4 } },
      8800,
      ["2026-07", "2026-08", "2026-09"],
    ],
    [
      "TVAöD",
      {
        ...ordinary,
        nursingTrainingTariff: { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" },
      },
      9000,
      ["2026-08", "2026-09", "2026-10"],
    ],
    [
      "TVA-L",
      { ...ordinary, tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST" } },
      9500,
      ["2026-11"],
    ],
  ])("uses the proper rate and reference period for %s", (_, profile, rate, months) => {
    const proposal = annualSalaryProposal(2026, profile, context);
    expect(proposal).not.toBeNull();
    expect(proposal?.rateBasisPoints).toBe(rate);
    expect(proposal?.referenceMonths).toEqual(months);
    expect(proposal!.grossCents).toBeGreaterThan(0);
    expect(proposal?.note).toContain("vollem Jahresanspruch");
  });
  it("leaves unverified years, uncovered groups and private agreements manual", () => {
    expect(annualSalaryProposal(2027, forecastProfile, context)).toBeNull();
    expect(
      annualSalaryProposal(2026, { ...ordinary, manualMonthlyGrossCents: 400_000 }, context),
    ).toBeNull();
    expect(
      annualSalaryProposal(
        2026,
        {
          ...ordinary,
          tvhKrTariff: { payGroup: "KR13", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
        },
        context,
      ),
    ).toBeNull();
  });
  it("never derives a personal tariff proposal from active test data, including assessment lookback", () => {
    expect(
      annualSalaryProposal(2026, forecastProfile, { ...context, testMonths: ["2026-05"] }),
    ).toBeNull();
  });
});
