import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import type { ComplianceIssue } from "@/domain/types";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { PLANNING_NIGHT_POLICY } from "@/domain/planning-night-policy";
import { LIGHT_PALETTE, DARK_PALETTE } from "@/theme/palette-values";
import * as Palette from "@/theme/palette";
import { PlanningHintList, planningHintGroups } from "./planning-hint-list";
import { ComplianceDayList } from "./compliance-day-list";
import { countChecks } from "./check-visibility";
import { Temporal } from "@js-temporal/polyfill";
import {
  PLANNING_WEEKEND_POLICY,
  planningWeekendWindowEnds,
  type PlanningWeekend,
  type PlanningWeekendAssessment,
} from "@/domain/planning-weekend-policy";

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
let mockWidth = 390,
  mockScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: mockScale }),
}));

const duties = Array.from({ length: 6 }, (_, index) =>
  forecastShift({
    id: `duty-${index}`,
    date: `2026-11-0${index + 2}`,
    title: index >= 2 ? "Nacht" : "Tag",
    type: index >= 2 ? "NIGHT" : "DAY",
    startTime: index >= 2 ? "21:00" : "08:00",
    endTime: index >= 2 ? "07:00" : "16:00",
  }),
);
const following = forecastShift({
  id: "following",
  date: "2026-11-09",
  startTime: "08:00",
  endTime: "16:00",
});
const allShifts = [...duties, following];
const work: ComplianceIssue = {
  id: "work",
  kind: "PLANNING",
  rule: "PLANNING_7_DAYS",
  severity: "info",
  date: "2026-11-07",
  title: "6 Diensttage in Folge",
  description: "Originale Dienstfolge",
  relatedShiftIds: duties.map((duty) => duty.id),
  facts: { rule: "PLANNING_7_DAYS", count: 6 },
};
const sequence = {
  policyVersion: PLANNING_NIGHT_POLICY.version,
  firstNight: "2026-11-04",
  lastNight: "2026-11-07",
  countIsMinimum: false,
  recoveryStatus: "under48" as const,
  restMinutes: 1500,
  lastShiftId: duties[5].id,
  nextShiftId: following.id,
};
const night: ComplianceIssue = {
  ...work,
  id: "night",
  rule: "PLANNING_NIGHT_SERIES",
  title: "4 Nächte in Folge",
  description: "Originale Nachtserie",
  relatedShiftIds: [...duties.slice(2).map((duty) => duty.id), following.id],
  facts: { rule: "PLANNING_NIGHT_SERIES", count: 4, nightSequence: sequence },
};
const recovery: ComplianceIssue = {
  ...night,
  id: "recovery",
  rule: "PLANNING_NIGHT_RECOVERY",
  title: "Erholung nach 4 Nächten",
  facts: { rule: "PLANNING_NIGHT_RECOVERY", count: 4, nightSequence: sequence },
};
const unknown: ComplianceIssue = {
  ...work,
  id: "unknown",
  rule: "UNKNOWN_PLANNING",
  title: "Weitere Dienstfolge prüfen",
  description: "Unveränderte unbekannte Beobachtung",
  facts: undefined,
  relatedShiftIds: [],
};
const view = (issues: readonly ComplianceIssue[]) => (
  <PlanningHintList
    groups={planningHintGroups(issues, allShifts)}
    shifts={allShifts}
    timeZone="Europe/Berlin"
  />
);

describe("compact planning hint lists", () => {
  it("keeps three distinct points in one date card and lets the whole work row open its existing detail sheet", async () => {
    const screen = await render(view([night, work, unknown]));
    expect(screen.getAllByTestId(/^planning-hint-card-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^planning-hint-row-/)).toHaveLength(3);
    expect(screen.queryByText("Details ansehen")).toBeNull();
    const row = screen.getByRole("button", { name: "Details ansehen: 6 Diensttage in Folge" });
    expect(row.props.accessibilityValue.text).toBe("02.11.–07.11.2026");
    expect(row).toHaveStyle({ minHeight: 44 });
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(row);
    expect(screen.getAllByTestId("planning-hint-detail-content")).toHaveLength(1);
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
    );
    expect(
      screen.getByRole("link", {
        name: "BAuA: Arbeitszeitgestaltung – Handbuch zur Gefährdungsbeurteilung",
      }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "6 Dienste anzeigen", expanded: false }),
    ).toHaveLength(1);
    expect(screen.queryByTestId("check-shift-duty-0")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "6 Dienste anzeigen" }));
    expect(screen.getByTestId("check-shift-duty-0")).toBeVisible();
  });

  it("coalesces only a validated identical night phase into one primary sheet and preserves raw findings", async () => {
    const issues = [work, recovery, night],
      before = JSON.stringify(issues);
    const screen = await render(view(issues));
    expect(screen.getAllByTestId(/^planning-hint-row-/)).toHaveLength(2);
    expect(screen.queryByTestId("planning-hint-row-recovery")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Details ansehen: 4 Nächte in Folge" }),
    );
    expect(screen.getAllByTestId("planning-hint-detail-content")).toHaveLength(1);
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
    );
    expect(
      screen.getAllByRole("link", { name: PLANNING_NIGHT_POLICY.sources[0].title }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "5 Dienste anzeigen", expanded: false }),
    ).toHaveLength(1);
    expect(JSON.stringify(issues)).toBe(before);
    expect(countChecks(issues).infoCount).toBe(3);
  });

  it("does not hide contradictory recovery metadata or unknown points", async () => {
    const contradiction: ComplianceIssue = {
      ...recovery,
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY",
        count: 4,
        nightSequence: { ...sequence, restMinutes: 1530 },
      },
    };
    const screen = await render(view([night, contradiction, unknown]));
    expect(screen.getAllByTestId(/^planning-hint-row-/)).toHaveLength(3);
    expect(screen.getByTestId("planning-hint-row-recovery")).toBeVisible();
    expect(screen.getByTestId("planning-hint-row-unknown")).toBeVisible();
  });

  it("never uses a work series to bridge two different night phases", async () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      forecastShift({
        id: `phase-${index}`,
        date: `2026-11-${String(index + 1).padStart(2, "0")}`,
        type: [1, 2, 6, 7].includes(index) ? "NIGHT" : "DAY",
        startTime: [1, 2, 6, 7].includes(index) ? "21:00" : "08:00",
        endTime: [1, 2, 6, 7].includes(index) ? "07:00" : "16:00",
      }),
    );
    const longWork = {
      ...work,
      date: "2026-11-12",
      relatedShiftIds: entries.map((entry) => entry.id),
      facts: { rule: "PLANNING_7_DAYS" as const, count: 12 },
    };
    const phase = (start: number): ComplianceIssue => ({
      ...recovery,
      id: `night-${start}`,
      date: entries[start + 1].date,
      relatedShiftIds: entries.slice(start, start + 3).map((entry) => entry.id),
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY",
        count: 2,
        nightSequence: {
          ...sequence,
          firstNight: entries[start].date,
          lastNight: entries[start + 1].date,
          recoveryStatus: "under24",
          restMinutes: 60,
          lastShiftId: entries[start + 1].id,
          nextShiftId: entries[start + 2].id,
        },
      },
    });
    const issues = [longWork, phase(1), phase(6)];
    const screen = await render(
      <PlanningHintList
        groups={planningHintGroups(issues, entries)}
        shifts={entries}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getAllByTestId(/^planning-hint-row-/)).toHaveLength(3);
    expect(screen.getByTestId("planning-hint-row-work")).toBeVisible();
  });

  it("shows the selected October example as three rows with real periods and the actual free time", async () => {
    const dates = [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ];
    const entries = dates.map((date, index) =>
      forecastShift({
        id: date,
        date,
        type: index >= 4 ? "NIGHT" : "DAY",
        startTime: index >= 4 ? "21:00" : "08:00",
        endTime: index >= 4 ? "07:30" : "16:00",
      }),
    );
    const next = forecastShift({ id: "next-october", date: "2026-10-07", startTime: "07:00" });
    const oldDuties = ["2026-09-13", "2026-09-27"].map((date) => forecastShift({ id: date, date }));
    const weekend = (sunday: string): PlanningWeekend => ({
      saturday: Temporal.PlainDate.from(sunday).subtract({ days: 1 }).toString(),
      sunday,
      status: sunday > "2026-10-04" ? "UNKNOWN" : sunday === "2026-09-20" ? "FREE" : "OCCUPIED",
      relatedShiftIds: sunday <= "2026-10-04" && sunday !== "2026-09-20" ? [sunday] : [],
      reasons:
        sunday > "2026-10-04"
          ? ["OUTSIDE_COVERAGE"]
          : sunday === "2026-09-20"
            ? []
            : ["WORK_RECORDED"],
    });
    const counts = (items: readonly PlanningWeekend[]) => ({
      freeCount: items.filter((item) => item.status === "FREE").length,
      occupiedCount: items.filter((item) => item.status === "OCCUPIED").length,
      unknownCount: items.filter((item) => item.status === "UNKNOWN").length,
    });
    const ends = planningWeekendWindowEnds("2026-10"),
      weekends = ends.map(weekend);
    const assessment: PlanningWeekendAssessment = {
      policyVersion: PLANNING_WEEKEND_POLICY.version,
      month: "2026-10",
      weekends,
      totalCount: weekends.length,
      ...counts(weekends),
      windows: ends.map((until) => {
        const end = Temporal.PlainDate.from(until),
          items = [3, 2, 1, 0].map((weeks) => weekend(end.subtract({ weeks }).toString()));
        return {
          from: end.subtract({ days: 27 }).toString(),
          until,
          weekends: items,
          assessmentComplete: items.every((item) => item.status !== "UNKNOWN"),
          ...counts(items),
        };
      }),
    };
    const workPoint: ComplianceIssue = {
      ...work,
      id: "oct-work",
      date: "2026-10-04",
      relatedShiftIds: dates,
      facts: { rule: "PLANNING_7_DAYS", count: 7 },
    };
    const nightPoint: ComplianceIssue = {
      ...recovery,
      id: "oct-recovery",
      date: "2026-10-04",
      relatedShiftIds: [...dates.slice(4), next.id],
      facts: {
        rule: "PLANNING_NIGHT_RECOVERY",
        count: 3,
        nightSequence: {
          ...sequence,
          firstNight: "2026-10-02",
          lastNight: "2026-10-04",
          restMinutes: 2850,
          lastShiftId: "2026-10-04",
          nextShiftId: next.id,
        },
      },
    };
    const weekendPoint: ComplianceIssue = {
      ...work,
      id: "oct-weekend",
      date: "2026-10-04",
      rule: "PLANNING_WEEKEND_RECOVERY",
      relatedShiftIds: [...oldDuties.map((entry) => entry.id), "2026-10-04"],
      facts: { rule: "PLANNING_WEEKEND_RECOVERY", assessment },
    };
    const all = [...oldDuties, ...entries, next],
      issues = [workPoint, nightPoint, weekendPoint];
    const screen = await render(
      <PlanningHintList
        groups={planningHintGroups(issues, all)}
        shifts={all}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getAllByTestId(/^planning-hint-card-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^planning-hint-row-/)).toHaveLength(3);
    expect(screen.getByText("7 Diensttage in Folge")).toBeVisible();
    expect(screen.getByText("28.09.–04.10.2026")).toBeVisible();
    expect(screen.getByText("Erholung nach 3 Nächten")).toBeVisible();
    expect(screen.getByText("Danach 47 Std. 30 Min. frei.")).toBeVisible();
    expect(screen.getByText("07.09.–04.10.2026")).toBeVisible();
    await fireEvent.press(
      screen.getByRole("button", { name: "Details ansehen: 1 freies Wochenende in 4 Wochen" }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
    );
    expect(screen.getByRole("link", { name: PLANNING_WEEKEND_POLICY.source.title })).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "3 Dienste anzeigen", expanded: false }),
    ).toHaveLength(1);
  });

  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "keeps the selected neutral surface and readable wrapping at narrow widths and large type",
    async (palette) => {
      const spy = jest.spyOn(Palette, "usePalette").mockReturnValue(palette);
      mockWidth = 320;
      mockScale = 3.1;
      try {
        const screen = await render(view([work]));
        const card = screen.getByTestId("planning-hint-card-2026-11-07");
        expect(card).toHaveStyle({ backgroundColor: palette.surfaceRaised });
        const row = within(screen.getByTestId("planning-hint-row-work"));
        expect(row.getByText("6 Diensttage in Folge")).toHaveStyle({ fontSize: 16 });
        expect(row.getByText("02.11.–07.11.2026")).toHaveStyle({ fontSize: 14 });
        expect(row.getByText("6 Diensttage in Folge").props.numberOfLines).toBeUndefined();
        expect(screen.queryByTestId("warning-glyph")).toBeNull();
      } finally {
        spy.mockRestore();
        mockWidth = 390;
        mockScale = 1;
      }
    },
  );

  it("preserves an unknown observation in its own safe row and existing details", async () => {
    const criticalUnknown: ComplianceIssue = { ...unknown, severity: "critical" };
    const before = JSON.stringify(criticalUnknown);
    const screen = await render(view([criticalUnknown]));
    const row = screen.getByRole("button", { name: "Details ansehen: Weitere Dienstfolge prüfen" });
    expect(row.props.accessibilityValue.text).toBe("Einordnung in den Details prüfen.");
    expect(row.props.accessibilityHint).toContain("Hinweise & Empfehlungen");
    await fireEvent.press(row);
    expect(screen.queryByText(unknown.description)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));
    expect(screen.getAllByText(unknown.description)).toHaveLength(1);
    expect(screen.queryByRole("link")).toBeNull();
    expect(countChecks([criticalUnknown]).criticalCount).toBe(1);
    expect(JSON.stringify(criticalUnknown)).toBe(before);
  });

  it("keeps full legal and tariff cards while hiding all planning rows with the switch off", async () => {
    const legal: ComplianceIssue = {
      ...work,
      id: "legal",
      kind: "LEGAL",
      rule: "ARBZG_4_BREAK",
      facts: { rule: "ARBZG_4_BREAK", recordedBreakMinutes: 0, requiredBreakMinutes: 30 },
    };
    const issues = [legal, work, night];
    const screen = await render(
      <ComplianceDayList
        compliance={{
          month: "2026-11",
          issues,
          affectedDates: [work.date],
          ...countChecks(issues),
        }}
        shifts={allShifts}
        timeZone="Europe/Berlin"
        showPlanning={false}
      />,
    );
    expect(screen.queryByTestId(/^planning-hint-card-/)).toBeNull();
    expect(screen.getByTestId("check-details-legal")).toHaveStyle({
      borderWidth: 1,
      borderColor: LIGHT_PALETTE.legalCheckBorder,
    });
    expect(screen.getByText("Details ansehen")).toBeVisible();
  });
});
