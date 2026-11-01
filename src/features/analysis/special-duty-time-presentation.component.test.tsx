import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { MonthOverview } from "./month-overview";
import { AnnualOverview } from "./annual-overview";
import type { MonthlyAnalysisCalculation } from "./monthly-analysis";
import { calculateMonthlySummary } from "@/engine/monthly-summary";
import { calculateMonthlyPayEstimate } from "@/engine/simple-pay";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { newSpecialDuty } from "@/domain/special-duty";
import { newStandbyAgreement } from "@/domain/standby-agreement";
import type { ShiftEntry, MonthlyPayEstimate } from "@/domain/types";
import { buildAnnualReport } from "./annual-report";
import { buildMonthlyShiftTypeAnalysis } from "./analysis-metrics";
import { formatEuro } from "./salary-summary-card";

let mockCardOrder = ["WORK"];

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("./analysis-net-pay-row", () => ({ AnalysisNetPayRow: () => null }));
jest.mock("./analysis-view-preferences", () => ({
  useAnalysisView: () => ({ preferences: { order: mockCardOrder, hidden: [] } }),
}));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ enabled: true }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCardOrder = ["WORK"];
});

const ordinary = ["01", "02", "03", "04", "07", "08", "10", "11"].map((day) =>
  forecastShift({
    id: `ordinary-${day}`,
    date: `2026-12-${day}`,
    startTime: "08:00",
    endTime: "16:27",
    breakMinutes: 30,
  }),
);
const standby = (): ShiftEntry =>
  forecastShift({
    id: "standby",
    title: "Bereitschaftsdienst",
    date: "2026-12-09",
    type: "CUSTOM",
    startTime: "08:00",
    endTime: "16:00",
    breakMinutes: 30,
    specialDuty: {
      ...newSpecialDuty("STANDBY", "08:00", "16:00", "Europe/Berlin"),
      version: 2,
      standbyLevel: "II",
      settlement: "TIME_OFF",
      standbyAgreement: { ...newStandbyAgreement("TVOED_K"), rule: "STANDARD" },
    },
  });
function overview(entries: readonly ShiftEntry[], pay: Partial<MonthlyPayEstimate> = {}) {
  const value = calculateMonthlySummary("2026-12", entries, forecastProfile, resolver);
  const data: MonthlyAnalysisCalculation = {
    summary: { ok: true, value },
    pay: {
      ok: true,
      value: {
        ...calculateMonthlyPayEstimate(
          "2026-12",
          entries,
          forecastProfile,
          null,
          entries,
          undefined,
          resolver,
        ),
        ...pay,
      },
    },
    monthShifts: entries,
    complianceShifts: { ok: true, value: entries },
    shiftTypeAnalysis: buildMonthlyShiftTypeAnalysis("2026-12", entries, forecastProfile, resolver),
  };
  return (
    <MonthOverview
      month="2026-12"
      data={data}
      profile={forecastProfile}
      compliance={null}
      checkError={null}
      showPlanning
    />
  );
}

describe("special-duty time account guidance", () => {
  it.each([
    { dutyAmount: 24.35, expectedAllowances: 441.17, gross: 4684.09 },
    { dutyAmount: 155.36, expectedAllowances: 572.18, gross: 4815.1 },
    { dutyAmount: undefined, expectedAllowances: 416.82, gross: 4659.74 },
  ])(
    "keeps readiness pay $dutyAmount in the original allowance row without adding it twice",
    async ({ dutyAmount, expectedAllowances, gross }) => {
      mockCardOrder = ["PAY"];
      const view = await render(
        overview(ordinary, {
          available: true,
          personalBaseAmount: 4075.58,
          timePremiumAmount: 167.34,
          overtimeAmount: 0,
          allowanceAmount: 275,
          tvoedAllowanceAmount: 0,
          careAllowanceAmount: 141.82,
          specialDutyAmount: dutyAmount,
          estimatedGrossAmount: gross,
        }),
      );
      expect(view.getByLabelText(`Brutto geschätzt: ${formatEuro(gross)}`)).toBeTruthy();
      expect(view.getByRole("button", { name: `Gehalt, ${formatEuro(gross)}` })).toBeTruthy();
      expect(
        view.getByLabelText(`Weitere Zulagen: ${formatEuro(expectedAllowances)}`),
      ).toBeTruthy();
    },
  );
  it("reproduces the photographed missing method and opens that duty directly", async () => {
    mockCardOrder = ["WORK", "SHIFTS"];
    const view = await render(overview([...ordinary, standby()]));
    expect(view.getByLabelText("Zeitkonto: Noch offen")).toBeTruthy();
    expect(
      view.getByText(/Erfasst: 71:06 h\. 09\.12\.: Ergänze das vereinbarte Verfahren/),
    ).toBeTruthy();
    await fireEvent.press(
      view.getByRole("button", { name: /Bereitschaftsdienst, Anzahl 1.*Zeitgutschrift offen/ }),
    );
    await fireEvent.press(view.getByRole("button", { name: /09\.12\..*Dienst bearbeiten/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: "2026-12-09", mode: "SHIFT", entryId: "standby" },
    });
  });
  it("labels paid account time clearly and retains the recorded hours", async () => {
    const entry = standby();
    const view = await render(
      overview([
        ...ordinary,
        { ...entry, specialDuty: { ...entry.specialDuty!, settlement: "PAY" } },
      ]),
    );
    expect(view.getByLabelText("Zeitkonto: 63:36 h")).toBeTruthy();
    expect(view.getByText(/Erfasst: 71:06 h/)).toBeTruthy();
    expect(view.getByText(/7:30 h Bereitschaft mit Auszahlung/)).toBeTruthy();
    expect(view.queryByText("Bereitschaften ansehen")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
  it("keeps several unresolved duties editable in their inline group", async () => {
    mockCardOrder = ["WORK", "SHIFTS"];
    const first = standby();
    const view = await render(overview([first, { ...first, id: "second", date: "2026-12-12" }]));
    await fireEvent.press(
      view.getByRole("button", { name: /Bereitschaftsdienst, Anzahl 2.*Zeitgutschrift offen/ }),
    );
    await fireEvent.press(view.getByRole("button", { name: /12\.12\..*Dienst bearbeiten/ }));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/shift-editor",
      params: { date: "2026-12-12", mode: "SHIFT", entryId: "second" },
    });
  });
  it("retains the existing Ist display for ordinary shifts", async () => {
    const view = await render(overview(ordinary));
    expect(view.getByLabelText("Ist: 63:36 h")).toBeTruthy();
    expect(view.queryByText("Zeitkonto")).toBeNull();
    expect(view.queryByText("Bereitschaften ansehen")).toBeNull();
  });
  it("uses the same weighted account time and caption in the annual overview", async () => {
    const entry = standby();
    const report = buildAnnualReport(
      2026,
      [
        {
          ...entry,
          specialDuty: {
            ...entry.specialDuty!,
            standbyAgreement: { ...entry.specialDuty!.standbyAgreement!, timeOffMode: "WEIGHTED" },
          },
        },
      ],
      forecastProfile,
      [],
    );
    const view = await render(<AnnualOverview report={report} pending={false} />);
    expect(view.getByLabelText("Zeitkonto: 5:37:30 h")).toBeTruthy();
    expect(view.getByText(/Erfasst: 7:30 h/)).toBeTruthy();
  });
});
