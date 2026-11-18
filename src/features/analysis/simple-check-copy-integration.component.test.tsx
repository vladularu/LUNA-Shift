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
const view = (secondary: boolean, issues: readonly ComplianceIssue[], entries = shifts) => {
  const compliance = {
    month: "2026-11",
    issues,
    affectedDates: issues.map((issue) => issue.date),
    ...countChecks(issues),
  };
  return secondary ? (
    <ComplianceDetails compliance={compliance} shifts={entries} timeZone="Europe/Berlin" />
  ) : (
    <ComplianceDayList
      compliance={compliance}
      shifts={entries}
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
  it("keeps duty symbols in the blue Sunday cells and only date and title in the duty rows", async () => {
    const night = forecastShift({
      id: "saturday-night",
      date: "2026-11-14",
      title: "Nacht",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:30",
    });
    const item = observation("weekends");
    const issue = { ...item, relatedShiftIds: [...item.relatedShiftIds, night.id] };
    const screen = await render(view(false, [issue], [...shifts, night]));
    await fireEvent.press(screen.getByTestId("check-details-weekends"));
    const calendar = within(screen.getByTestId("tariff-period"));
    expect(calendar.getAllByTestId(/^check-duty-symbol-/)).toHaveLength(2);
    const rows = within(screen.getByTestId("check-duty-overview"));
    expect(rows.getByText("14.11. · Nacht")).toBeVisible();
    expect(rows.queryAllByTestId(/^check-duty-symbol-/)).toHaveLength(0);
    expect(rows.queryAllByText(/\d{2}:\d{2}/)).toHaveLength(0);
  });

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
      expect(screen.getByText(/Tarifprüfung · Abweichung erkannt/)).toBeVisible();
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
      const issues = [observation("second", true), observation("first")],
        before = JSON.stringify(issues);
      const screen = await render(view(secondary, issues));
      const copy = tariffCheckPresentation(
        issues[0].tariff!,
        issues[0].title,
        issues[0].description,
      );
      expect(screen.getAllByText(copy.title)).toHaveLength(secondary ? 1 : 2);
      if (secondary) expect(screen.getByText(copy.summary)).toBeVisible();
      else expect(screen.queryByText(copy.summary)).toBeNull();
      expect(screen.queryByText(/bestätig/)).toBeNull();
      if (!secondary) {
        const inbox = within(screen.getByTestId("check-inbox-legal"));
        const periods = inbox.getAllByRole("button");
        expect(periods.map((entry) => entry.props.accessibilityValue.text)).toEqual([
          "Tarif · 02.11.–15.11.2026",
          "Tarif · 09.11.–22.11.2026",
        ]);
        await fireEvent.press(periods[0]);
        expect(screen.getByTestId("check-original-issue-first")).toBeVisible();
        expect(screen.queryByTestId("check-original-issue-second")).toBeNull();
        expect(screen.queryByTestId("check-issue-periods")).toBeNull();
        const cell = within(screen.getByTestId("tariff-period-2026-11-08"));
        expect(cell.getByTestId("check-duty-symbol-2026-11-08-sunday-8")).toBeVisible();
        expect(cell.getByText("8.")).toBeVisible();
        expect(
          within(screen.getByTestId("check-shift-sunday-8")).queryByTestId(/^check-duty-symbol-/),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: "Betroffene Dienste" })).toBeNull();
        await fireEvent.press(
          screen.getByRole("button", { name: "Prüfgrundlage", expanded: false }),
        );
        expect(
          screen.getByRole("link", { name: TARIFF_TIME_POLICIES.TVOED_K.freeSource!.title }),
        ).toBeVisible();
        expect(screen.getByText(TARIFF_TIME_POLICIES.TVOED_K.freeSource!.title)).toHaveStyle({
          textDecorationLine: "underline",
        });
        await fireEvent.press(screen.getByRole("button", { name: "Hinweis schließen" }));
        await fireEvent.press(screen.getByTestId("check-details-second"));
        expect(screen.getByTestId("check-original-issue-second")).toBeVisible();
        expect(screen.queryByTestId("check-original-issue-first")).toBeNull();
        expect(screen.queryByTestId("check-shift-sunday-8")).toBeNull();
        expect(screen.getByTestId("check-shift-sunday-22")).toBeVisible();
        await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
        expect(screen.getByTestId("check-inbox-legal")).toBeVisible();
        expect(JSON.stringify(issues)).toBe(before);
        return;
      }
      await openObservation(screen, secondary);
      expect(
        within(screen.getByTestId("check-original-issue-second")).getByText(copy.summary),
      ).toBeVisible();
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
        original.getByRole("button", {
          name: "Quelle & Berechnung",
          expanded: false,
        }),
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
      if (secondary) expect(screen.getByText(copy.summary)).toBeVisible();
      else expect(screen.queryByText(copy.summary)).toBeNull();
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
