import { describe, expect, it } from "vitest";
import { work } from "@/engine/remuneration-test-fixtures";
import { employmentChangeLines, employmentChangedFields } from "./employment-change";

describe("TVA-L workplace save summary", () => {
  const before = {
    ...work,
    tariff: null,
    tvalPflegeTariff: { trainingYear: 2 as const, universityRegion: "WEST" as const },
  };
  it("explains a workplace-only change without an unchanged tariff arrow", () => {
    const after = {
      ...before,
      tvalPflegeTariff: { ...before.tvalPflegeTariff, employerScope: "SECTION_43" as const },
    };
    expect(employmentChangedFields(before, after)).toEqual(["tvalPflegeTariff"]);
    expect(employmentChangeLines(before, after)).toEqual([
      "Arbeitsbereich: Noch nicht geklärt → Krankenhaus / ärztliche Behandlung",
    ]);
  });
  it("shows both training-year and workplace changes", () => {
    const after = {
      ...before,
      tvalPflegeTariff: {
        ...before.tvalPflegeTariff,
        trainingYear: 3 as const,
        employerScope: "GENERAL" as const,
      },
    };
    expect(employmentChangeLines(before, after)).toEqual([
      expect.stringContaining("Tarif & Gehalt:"),
      "Arbeitsbereich: Noch nicht geklärt → Anderer Arbeitsbereich",
    ]);
  });
});
