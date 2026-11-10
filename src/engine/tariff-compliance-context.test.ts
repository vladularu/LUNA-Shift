import { describe, expect, it } from "vitest";
import type { UserProfile } from "@/domain/types";
import { captureEmploymentProfile } from "@/domain/employment-history";
import { createWorkingTimeCalculationProfile } from "./working-time-calculation-profile";
import { tariffContextAt } from "./tariff-compliance-context";
import type { WorkingTimeTargetInput } from "@/domain/working-time-target";

const profile: UserProfile = {
  federalState: "NW",
  holidayRegion: "NONE",
  weeklyMinutes: 2310,
  timeZone: "Europe/Berlin",
  regularRotatingNightWork: null,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
  tariff: {
    payGroup: "P8",
    payLevel: 4,
    sector: "BT_K",
    tariffRegion: "OTHER",
    fullTimeWeeklyMinutes: 2310,
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function withTarget(overrides: Partial<WorkingTimeTargetInput>) {
  const calculated = createWorkingTimeCalculationProfile(profile, null, []);
  return { ...calculated, workingTimeTarget: { ...calculated.workingTimeTarget!, ...overrides } };
}

describe("tariff context for the existing legal check", () => {
  it.each([
    { answer: true, coverage: "UNKNOWN", assignment: "UNKNOWN", known: true },
    { answer: false, coverage: "AROUND_THE_CLOCK", assignment: "PERMANENT", known: false },
    { answer: null, coverage: "AROUND_THE_CLOCK", assignment: "PERMANENT", known: true },
    { answer: null, coverage: "AROUND_THE_CLOCK", assignment: "TEMPORARY", known: false },
    { answer: null, coverage: "UNKNOWN", assignment: "PERMANENT", known: false },
  ] as const)(
    "derives the Sunday basis from saved settings %j",
    ({ answer, coverage, assignment, known }) => {
      const result = tariffContextAt(
        {
          ...profile,
          sundayHolidayWorkEligible: answer,
          workPattern: { workplaceCoverage: coverage, assignment },
        },
        "2026-08-01",
      );
      expect(result?.sundayWorkModelKnown).toBe(known);
      expect(result?.sundayHolidayWorkEligible).toBe(answer);
    },
  );
  it("does not treat a salary selection as confirmed legal scope", () => {
    const result = tariffContextAt(profile, "2026-08-01");
    expect(result?.policy?.family).toBe("TVOED_K");
    expect(result?.scopeConfirmed).toBe(false);
  });

  it("keeps the TV-H JVA scope unresolved and uses the official employer source", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    const target = calculated.workingTimeTarget!;
    const p = {
      ...calculated,
      workingTimeTarget: {
        ...target,
        context: {
          ...target.context!,
          periods: target.context!.periods.map((period) => ({
            ...period,
            tariff: { kind: "TVH_KR" as const, version: "2026-01-01", scopeConfirmed: null },
          })),
        },
      },
    };
    const context = tariffContextAt(p, "2026-08-01");
    expect(context?.policy?.family).toBe("TVH_KR");
    expect(context?.requirements.join(" ")).toMatch(/Justizvollzug/);
    expect(context?.scopeConfirmed).toBe(false);
    expect(context?.policy?.freeSource).toMatchObject({
      url: "https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf",
      section: "§ 43 Nr. 3",
    });
  });

  it("resolves the same candidate for saved and derived forecast profiles", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    expect(tariffContextAt(calculated, "2026-08-01")).toEqual(
      tariffContextAt(profile, "2026-08-01"),
    );
  });

  it("uses actual dated employment instead of the current tariff for old weeks", () => {
    const old: UserProfile = {
      ...profile,
      tariff: null,
      tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
    };
    const dated: UserProfile = {
      ...profile,
      employmentTimeline: [
        {
          effectiveFrom: null,
          employment: captureEmploymentProfile(old),
          data: { version: 1, weeklyMinutes: 2310, selection: { kind: "unconfigured" } },
          revision: 1,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
        {
          effectiveFrom: "2026-08-05",
          employment: captureEmploymentProfile(profile),
          data: { version: 1, weeklyMinutes: 2310, selection: { kind: "unconfigured" } },
          revision: 1,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
      ],
    };
    expect(tariffContextAt(dated, "2026-08-04")?.policy?.family).toBe("TVL_KR");
    expect(tariffContextAt(dated, "2026-08-05")?.policy?.family).toBe("TVOED_K");
  });

  it("keeps manual pay without a work-time tariff outside tariff claims", () => {
    const manual = { ...profile, tariff: null, manualMonthlyGrossCents: 300000 };
    expect(tariffContextAt(manual, "2026-08-01")).toBeNull();
    expect(
      tariffContextAt(createWorkingTimeCalculationProfile(manual, null, []), "2026-08-01"),
    ).toBeNull();
  });

  it("does not silently choose one of conflicting salary bases", () => {
    const p = {
      ...profile,
      salaryBasisConflict: { tariff: profile.tariff, manualMonthlyGrossCents: 300000 },
    };
    expect(tariffContextAt(p, "2026-08-01")?.unavailable).toBe(true);
  });

  it("keeps the UK average rule separate from fixed five-day distribution", () => {
    const p = {
      ...profile,
      tariff: null,
      tvUkNursingTariff: { payGroup: "PUK8" as const, payLevel: 4 as const },
    };
    expect(tariffContextAt(p, "2026-08-01")?.policy?.averageFive).toBe(true);
    expect(tariffContextAt(p, "2026-08-01")?.policy?.consecutiveFreeDays).toBe(true);
  });

  it("preserves unreviewed dates as a coverage limitation, not legal expiry", () => {
    const result = tariffContextAt(profile, "2027-01-01");
    expect(result?.unavailable).toBe(true);
    expect(result?.requirements.join(" ")).toMatch(/geprüft/);
    expect(result?.requirements.join(" ")).not.toMatch(/abgelaufen/);
  });

  it("requires an employer scope for adult TVA-L instead of guessing a hospital", () => {
    const p = {
      ...profile,
      tariff: null,
      tvalPflegeTariff: {
        trainingYear: 1 as const,
        universityRegion: "WEST" as const,
        employerScope: null,
      },
    };
    expect(tariffContextAt(p, "2026-08-01")?.unavailable).toBe(true);
  });

  it("honors explicitly corrected forecast tariff assignment without claiming proof", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    const target = calculated.workingTimeTarget!;
    const corrected = {
      ...calculated,
      workingTimeTarget: {
        ...target,
        context: {
          ...target.context!,
          periods: [
            {
              ...target.context!.periods[0],
              tariff: {
                kind: "TVUK_NURSING" as const,
                version: "2026-01-01",
                scopeConfirmed: null,
                accountRuleConfirmed: null,
              },
            },
          ],
        },
      },
    };
    expect(tariffContextAt(corrected, "2026-08-01")?.policy?.family).toBe("TVUK");
    expect(tariffContextAt(corrected, "2026-08-01")?.scopeConfirmed).toBe(false);
  });

  it("does not run a normal tariff check when its scope was explicitly excluded", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    const target = calculated.workingTimeTarget!;
    const excluded = {
      ...calculated,
      workingTimeTarget: {
        ...target,
        context: {
          ...target.context!,
          periods: [
            {
              ...target.context!.periods[0],
              tariff: { kind: "TVOED_K" as const, version: "2026-01-01", scopeConfirmed: false },
            },
          ],
        },
      },
    };
    expect(tariffContextAt(excluded, "2026-08-01")?.unavailable).toBe(true);
  });

  it("attributes adult training references to the actual training tariff", () => {
    const p = {
      ...profile,
      tariff: null,
      nursingTrainingTariff: {
        trainingYear: 1 as const,
        sector: "BT_K" as const,
        tariffRegion: "OTHER" as const,
      },
    };
    expect(tariffContextAt(p, "2026-08-01")?.policy?.source.title).toMatch(/TVAöD/);
    expect(tariffContextAt(p, "2026-08-01")?.policy?.source.section).toMatch(/§ 7/);
  });

  it.each(["loading", "error"] as const)(
    "does not fall back to salary when explicit target is %s",
    (status) => {
      const result = tariffContextAt(withTarget({ status, context: undefined }), "2026-08-01");
      expect(result?.unavailable).toBe(true);
      expect(result?.unavailableReason).toBe("SCOPE");
      expect(result?.policy).toBeNull();
    },
  );

  it("does not fall back through a gap in explicitly provided target periods", () => {
    const calculated = createWorkingTimeCalculationProfile(profile, null, []);
    const context = calculated.workingTimeTarget!.context!;
    const p = withTarget({
      context: {
        ...context,
        periods: [
          {
            ...context.periods[0],
            validFrom: "2026-08-15",
            tariff: {
              kind: "TVUK_NURSING",
              version: "2026-01-01",
              scopeConfirmed: null,
              accountRuleConfirmed: null,
            },
          },
        ],
      },
    });
    expect(tariffContextAt(p, "2026-08-10")?.unavailable).toBe(true);
    expect(tariffContextAt(p, "2026-08-10")?.policy).toBeNull();
    expect(tariffContextAt(p, "2026-08-15")?.policy?.family).toBe("TVUK");
  });

  it("does not choose a salary tariff for missing or ambiguous target context", () => {
    expect(
      tariffContextAt(withTarget({ status: "ready", context: undefined }), "2026-08-01")
        ?.unavailable,
    ).toBe(true);
    const context = createWorkingTimeCalculationProfile(profile, null, []).workingTimeTarget!
      .context!;
    const ambiguous = withTarget({
      context: { ...context, periods: [context.periods[0], context.periods[0]] },
    });
    expect(tariffContextAt(ambiguous, "2026-08-01")?.unavailable).toBe(true);
    expect(tariffContextAt(ambiguous, "2026-08-01")?.policy).toBeNull();
  });

  it("respects explicit inclusive employment bounds even when tariff periods cover more", () => {
    const context = createWorkingTimeCalculationProfile(profile, null, []).workingTimeTarget!
      .context!;
    const p = withTarget({
      context: { ...context, employment: { from: "2026-08-10", to: "2026-08-20" } },
    });
    expect(tariffContextAt(p, "2026-08-09")?.unavailable).toBe(true);
    expect(tariffContextAt(p, "2026-08-21")?.unavailable).toBe(true);
    expect(tariffContextAt(p, "2026-08-10")?.policy?.family).toBe("TVOED_K");
    expect(tariffContextAt(p, "2026-08-20")?.policy?.family).toBe("TVOED_K");
  });

  it("distinguishes scope changes inside the same family and week", () => {
    const context = createWorkingTimeCalculationProfile(profile, null, []).workingTimeTarget!
      .context!;
    const period = context.periods[0];
    const p = withTarget({
      mode: "ROSTER",
      context: {
        ...context,
        periods: [
          {
            ...period,
            validTo: "2026-08-05",
            tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: null },
          },
          {
            ...period,
            validFrom: "2026-08-06",
            tariff: { kind: "TVOED_K", version: "2026-01-01", scopeConfirmed: true },
          },
        ],
      },
    });
    const before = tariffContextAt(p, "2026-08-04");
    const after = tariffContextAt(p, "2026-08-07");
    expect(before?.scopeConfirmed).toBe(false);
    expect(after?.scopeConfirmed).toBe(true);
    expect(before?.key).not.toBe(after?.key);
  });
});
