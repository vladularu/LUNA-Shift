import { fireEvent, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "./check-issue-route.test";
import type { ComplianceIssue } from "@/domain/types";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { TARIFF_SCOPE_SOURCE, TARIFF_TIME_POLICIES } from "@/domain/tariff-time-policy";
import { ComplianceDayList } from "./compliance-day-list";
import { ComplianceDetails } from "./compliance-details";
import { countChecks } from "./check-visibility";
import { tariffCheckPresentation } from "./tariff-check-presentation";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
const shifts = [8, 15, 22].map((day) =>
  forecastShift({
    id: `sunday-${day}`,
    date: `2026-11-${String(day).padStart(2, "0")}`,
  }),
);
const observation = (id: string, later = false): ComplianceIssue => ({
  id,
  date: later ? "2026-11-22" : "2026-11-15",
  kind: "LEGAL",
  severity: "info",
  rule: "TARIFF_FREE_SUNDAY",
  title: "Beide Sonntage mit Diensten",
  description: `Ursprüngliche Einordnung ${id}.`,
  relatedShiftIds: shifts.slice(later ? 1 : 0, later ? 3 : 2).map((shift) => shift.id),
  tariff: {
    ruleId: "TARIFF_FREE_SUNDAY",
    tariffLabel: "TVöD · BT-K",
    status: "REVIEW",
    period: {
      from: later ? "2026-11-09" : "2026-11-02",
      until: later ? "2026-11-22" : "2026-11-15",
    },
    source: TARIFF_TIME_POLICIES.TVOED_K.freeSource!,
    ruleText: TARIFF_TIME_POLICIES.TVOED_K.freeRuleText,
    requirements: ["Der persönliche Geltungsbereich dieser Tarifregel ist zu bestätigen."],
    count: 2,
    recordedDates: shifts.slice(later ? 1 : 0, later ? 3 : 2).map((shift) => shift.date),
  },
});
const view = (secondary: boolean, issues: readonly ComplianceIssue[]) => {
  const compliance = {
    month: "2026-11",
    issues,
    affectedDates: issues.map((issue) => issue.date),
    ...countChecks(issues),
  };
  return secondary ? (
    <ComplianceDetails compliance={compliance} shifts={shifts} timeZone="Europe/Berlin" />
  ) : (
    <ComplianceDayList
      compliance={compliance}
      shifts={shifts}
      timeZone="Europe/Berlin"
      showPlanning
    />
  );
};
type Screen = Awaited<ReturnType<typeof render>>;
async function openObservation(screen: Screen, secondary: boolean) {
  if (secondary) {
    const ruleCard = within(screen.getByTestId("check-rule-card-TARIFF_FREE_SUNDAY"));
    await fireEvent.press(ruleCard.getByRole("button", { expanded: false }));
  } else await fireEvent.press(screen.getByRole("button", { name: /^Details ansehen:/ }));
}

describe("simple check copy in both result renderers", () => {
  it.each<[boolean, boolean]>([
    [false, false],
    [true, false],
    [true, true],
  ])(
    "keeps a recorded deviation visible without alleging a legal violation (secondary %s, mixed %s)",
    async (secondary, mixed) => {
      const first = observation("deviation"),
        deviation = { ...first, tariff: { ...first.tariff!, status: "DEVIATION" as const } };
      const originals = mixed ? [observation("ordinary"), deviation] : [deviation];
      const before = JSON.stringify(originals),
        screen = await render(view(secondary, originals));
      expect(screen.getByText("Tarifprüfung · Abweichung erkannt")).toBeVisible();
      expect(screen.queryByText(/Rechtsverstoß|rechtswidrig|verboten/)).toBeNull();
      if (secondary)
        expect(
          within(screen.getByTestId("check-rule-card-TARIFF_FREE_SUNDAY")).getByRole("button", {
            expanded: false,
          }).props.accessibilityHint,
        ).toContain("Abweichung");
      expect(JSON.stringify(originals)).toBe(before);
      expect(countChecks(originals).infoCount).toBe(mixed ? 2 : 1);
    },
  );
  it.each<[boolean]>([[false], [true]])(
    "keeps one observation, all original periods and a duty overview for each original period (%s)",
    async (secondary) => {
      const issues = [observation("first"), observation("second", true)],
        before = JSON.stringify(issues);
      const screen = await render(view(secondary, issues));
      const copy = tariffCheckPresentation(
        issues[1].tariff!,
        issues[1].title,
        issues[1].description,
      );
      expect(screen.getByText(copy.title)).toBeVisible();
      expect(screen.getByText(copy.summary)).toBeVisible();
      expect(screen.queryByText(/bestätig/)).toBeNull();
      await openObservation(screen, secondary);
      expect(screen.getByTestId("check-original-issue-second")).toBeVisible();
      expect(screen.queryByTestId("check-original-issue-first")).toBeNull();
      const more = screen.getByRole("button", { name: "Weitere Zeiträume (1)", expanded: false });
      expect(more).toHaveStyle({ minHeight: 44 });
      expect(screen.queryByRole("button", { name: /Dienste (anzeigen|ausblenden)/ })).toBeNull();
      expect(screen.getByTestId("tariff-period")).toBeVisible();
      expect(screen.queryByTestId(`check-shift-${shifts[0].id}`)).toBeNull();
      await fireEvent.press(more);
      expect(screen.getByTestId("check-original-issue-first")).toBeVisible();
      const original = within(screen.getByTestId("check-original-issue-first"));
      await fireEvent.press(
        original.getByRole("button", { name: "Quelle & Berechnung", expanded: false }),
      );
      expect(
        original.getByRole("link", { name: TARIFF_TIME_POLICIES.TVOED_K.freeSource!.title }),
      ).toBeVisible();
      expect(screen.queryByRole("button", { name: "3 Dienste anzeigen" })).toBeNull();
      for (const shift of shifts)
        expect(screen.getAllByTestId(`check-shift-${shift.id}`).length).toBeGreaterThan(0);
      expect(countChecks(issues).infoCount).toBe(2);
      expect(JSON.stringify(issues)).toBe(before);
    },
  );

  it.each<[boolean]>([[false], [true]])(
    "keeps planned observations out of missing-input status (%s)",
    async (secondary) => {
      const item = observation("planned"),
        pending = { ...item, tariff: { ...item.tariff!, status: "PENDING" as const } };
      const screen = await render(view(secondary, [pending]));
      const copy = tariffCheckPresentation(pending.tariff, pending.title, pending.description);
      expect(screen.getByText(copy.title)).toBeVisible();
      expect(screen.getByText(copy.summary)).toBeVisible();
      expect(screen.queryByTestId("check-status-card")).toBeNull();
      expect(screen.queryByText("Prüfung eingeschränkt")).toBeNull();
    },
  );

  it.each<[boolean]>([[false], [true]])(
    "keeps unavailable foundations once in scope without a false all-clear or dead profile action (%s)",
    async (secondary) => {
      const item = observation("unavailable"),
        unavailable: ComplianceIssue = {
          ...item,
          rule: "TARIFF_SCOPE",
          tariff: {
            ...item.tariff!,
            ruleId: "TARIFF_SCOPE",
            status: "UNAVAILABLE",
            source: TARIFF_SCOPE_SOURCE,
          },
        };
      const screen = await render(view(secondary, [unavailable]));
      expect(screen.getAllByTestId("check-status-card")).toHaveLength(1);
      expect(screen.queryByTestId("check-complete")).toBeNull();
      expect(screen.queryByText("Keine Auffälligkeiten in den unterstützten Prüfungen")).toBeNull();
      await fireEvent.press(
        screen.getByRole("button", { name: "Prüfstatus: Tarifprüfung eingeschränkt" }),
      );
      expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
      expect(screen.queryByText(/Angabe offen/)).toBeNull();
    },
  );
});
