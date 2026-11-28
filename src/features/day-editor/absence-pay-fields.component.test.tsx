import type { UserProfile } from "@/domain/types";
import { expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { EMPTY_ABSENCE_PAY } from "@/domain/absence-pay";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver as mockResolver } from "@/rules/rule-resolver";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS as mockWorkPattern } from "@/engine/simple-pay";
import { absencePayEditor } from "./absence-pay-fields";

const mockEntries = ["2026-07-12", "2026-08-09", "2026-09-13"].map((date) =>
  forecastShift({ date, id: date }),
);
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftTariff: () => ({ tariffDecisions: [], workPatternSettings: mockWorkPattern }),
  usePflegeShiftTestData: () => ({ testMonths: [] }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: mockResolver }),
}));
it("shows an estimated rate on a new vacation day before saving or opening any settings", async () => {
  const view = await render(
    <>{absencePayEditor(forecastProfile, "2026-10-12", "VACATION", null, null)}</>,
  );
  expect(view.getByText(/ca\. .*€/)).toBeTruthy();
  expect(view.queryByText("Sonderfall bearbeiten")).toBeNull();
  expect(view.queryByLabelText("Tagessatz laut Abrechnung in Euro")).toBeNull();
  await fireEvent.press(view.getByText("U/K-Aufschlag"));
  expect(view.getByText(/Juli 2026 bis September 2026/)).toBeTruthy();
});
it("displays an existing payroll rate for sickness without opening a form", async () => {
  const view = await render(
    <>
      {absencePayEditor(
        forecastProfile,
        "2026-10-12",
        "SICK",
        { ...EMPTY_ABSENCE_PAY, day: "PAID", dailyRateCents: 1500 },
        null,
      )}
    </>,
  );
  expect(view.getByText(/15,00/)).toBeTruthy();
  await fireEvent.press(view.getByText("U/K-Aufschlag"));
  expect(view.queryByText("Sonderfall bearbeiten")).toBeNull();
  expect(view.queryByLabelText("Referenzmonate vollständig erfasst")).toBeNull();
  expect(view.getByText(/laut Abrechnung/)).toBeTruthy();
});

it.each<[string, Partial<UserProfile>, string]>([
  [
    "TV-L",
    { tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
    "§ 21 TV-L",
  ],
  [
    "TV-H",
    {
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
    "§ 21 TV-H",
  ],
  [
    "TV-UK",
    { federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } },
    "§§ 19, 24 TV-UK",
  ],
  [
    "TVAöD",
    { nursingTrainingTariff: { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" } },
    "§ 9 TVAöD-Pflege",
  ],
  [
    "TVA-L",
    { tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST" } },
    "§ 9 TVA-L Pflege",
  ],
])(
  "zeigt den Tageswert oder das Monatsentgelt für %s direkt auf der Karte",
  async (name, tariff, source) => {
    const profile = { ...forecastProfile, tariff: null, ...tariff };
    const view = await render(
      <>{absencePayEditor(profile, "2026-10-12", "VACATION", null, null)}</>,
    );
    const monthly = name.startsWith("TVA");
    expect(monthly ? view.getByText("Im Monatsgehalt") : view.getByText(/ca\. .*€/)).toBeTruthy();
    expect(view.queryByText(/Auszahlung/)).toBeNull();
    await fireEvent.press(view.getByText(monthly ? "Ausbildungsentgelt" : "U/K-Aufschlag"));
    expect(view.getByText(new RegExp(source))).toBeTruthy();
  },
);
