import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ComplianceIssue, MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { Temporal } from "@js-temporal/polyfill";
import { checkDate, checkDayParts, ComplianceIssueContent } from "./compliance-issue-content";
import { ComplianceDayList } from "./compliance-day-list";
import { newSpecialDuty } from "@/domain/special-duty";
import { specialDutyComplianceIssues } from "@/engine/special-duty-compliance";
import { calculateMonthlyCompliance } from "@/engine/compliance";
import { PLANNING_NIGHT_POLICY } from "@/domain/planning-night-policy";
import * as Palette from "@/theme/palette";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";
import { Linking, StyleSheet } from "react-native";
import { colorContrastRatio } from "@/theme/color-contrast";
jest.mock("lucide-react-native", () => {
  const NativeView = jest.requireActual<typeof import("react-native")>("react-native").View;
  return {
    ...jest.requireActual<object>("lucide-react-native"),
    Info: (props: object) => <NativeView testID="info-glyph" {...props} />,
    AlertTriangle: (props: object) => <NativeView testID="warning-glyph" {...props} />,
    AlertCircle: (props: object) => <NativeView testID="critical-glyph" {...props} />,
  };
});
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
let mockFontScale = 1;
let mockWindowWidth = 390;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth, height: 844, scale: 3, fontScale: mockFontScale }),
}));
const shift: ShiftEntry = {
  kind: "SHIFT",
  id: "late",
  templateId: null,
  date: "2026-11-30",
  title: "Spät",
  type: "LATE",
  startTime: "13:18",
  endTime: "21:30",
  breakMinutes: 30,
  color: "#227766",
  symbol: "S",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  deletedAt: null,
};
const early = {
  ...shift,
  id: "early",
  date: "2026-12-01",
  title: "Früh",
  startTime: "07:00",
  endTime: "15:12",
};
const issue = (change: Partial<ComplianceIssue> = {}): ComplianceIssue => ({
  id: "rest",
  date: "2026-12-01",
  kind: "LEGAL",
  rule: "ARBZG_5_REST_10H",
  severity: "critical",
  title: "Ruhezeit unter 10 Stunden",
  description:
    "Zwischen den Diensten liegen nur 9.5 h Ruhezeit. Damit wird auch die für Krankenhäuser und Pflegeeinrichtungen mögliche Verkürzung auf 10 Stunden unterschritten.",
  relatedShiftIds: [shift.id, early.id],
  ...change,
});
const result = (issues: readonly ComplianceIssue[]): MonthlyComplianceResult => ({
  month: "2026-12",
  issues,
  affectedDates: issues.map((i) => i.date),
  criticalCount: 1,
  warningCount: 1,
  infoCount: 0,
});
const list = (
  issues: readonly ComplianceIssue[],
  shifts: readonly ShiftEntry[] = [early, shift],
  showPlanning = true,
) => (
  <ComplianceDayList
    compliance={result(issues)}
    shifts={shifts}
    showPlanning={showPlanning}
    timeZone="Europe/Berlin"
  />
);

describe("visible check timelines", () => {
  it("keeps open four-week status without a permanent weekend overview", async () => {
    const screen = await render(
      <ComplianceDayList
        compliance={{
          ...result([]),
          weekendAssessment: {
            policyVersion: "2026-11-09-four-weeks",
            month: "2026-11",
            weekends: [],
            windows: [],
            totalCount: 5,
            occupiedCount: 3,
            freeCount: 1,
            unknownCount: 1,
          },
        }}
        shifts={[]}
        showPlanning={false}
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.queryByTestId("weekend-assessment-summary")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wochenendübersicht ansehen" })).toBeNull();
    expect(screen.queryByTestId("check-complete")).toBeNull();
    expect(screen.getByText("Prüfung eingeschränkt")).toBeVisible();
  });
  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "keeps new recovery cards neutral and makes sources accessible",
    async (palette) => {
      const paletteSpy = jest.spyOn(Palette, "usePalette").mockReturnValue(palette);
      const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
      try {
        const entries: ShiftEntry[] = [
          ...["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"].map((date) => ({
            ...shift,
            id: date,
            date,
            type: "NIGHT" as const,
            startTime: "22:00",
            endTime: "06:00",
          })),
          { ...early, id: "next", date: "2026-12-03", startTime: "05:59" },
        ];
        const actual = calculateMonthlyCompliance("2026-12", entries, "Europe/Berlin", {
          allEmploymentWorkRecorded: true,
          regularRotatingNightWork: true,
        });
        const findings = actual.issues.filter(
          (finding) => finding.rule === "PLANNING_NIGHT_SERIES",
        );
        expect(findings).toHaveLength(1);
        const finding = findings[0];
        const screen = await render(list(findings, entries));
        const card = screen.getByTestId(`planning-hint-card-${finding.date}`);
        expect(card).toHaveStyle({
          backgroundColor: palette.surfaceRaised,
          borderWidth: 0,
        });
        expect(within(card).getByText("4 Nächte in Folge")).toBeVisible();
        expect(within(card).getByText("Danach 23 Std. 59 Min. frei.")).toBeVisible();
        expect(within(card).queryByLabelText("23:59 h arbeitsfreie Zeit")).toBeNull();
        expect(screen.queryByText("Empfehlung & Quellen")).toBeNull();
        expect(
          within(card).queryByTestId("warning-glyph", { includeHiddenElements: true }),
        ).toBeNull();
        expect(
          within(card).getByRole("button", { name: "Details ansehen: 4 Nächte in Folge" }).props
            .accessibilityValue.text,
        ).toBe("Danach 23 Std. 59 Min. frei.");
        await fireEvent.press(
          within(card).getByRole("button", { name: "Details ansehen: 4 Nächte in Folge" }),
        );
        expect(screen.queryByText(/nicht, wie erholt du persönlich bist/)).toBeNull();
        expect(
          within(screen.getByTestId("planning-hint-detail-content")).getAllByText(
            /23 Std\. 59 Min\./,
          ),
        ).toHaveLength(1);
        expect(screen.queryByRole("button", { name: /Dienste anzeigen/ })).toBeNull();
        expect(screen.getByTestId("check-affected-shifts")).toBeVisible();
        await fireEvent.press(
          screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
        );
        expect(screen.getByText(/nicht, wie erholt du persönlich bist/)).toBeVisible();
        await fireEvent.press(
          screen.getByRole("link", { name: PLANNING_NIGHT_POLICY.sources[1].title }),
        );
        expect(open).toHaveBeenCalledWith(PLANNING_NIGHT_POLICY.sources[1].url);
      } finally {
        paletteSpy.mockRestore();
        open.mockRestore();
      }
    },
  );

  it("shows the selected recovery row with the relevant 48-hour comparison", async () => {
    const entries: ShiftEntry[] = [
      ...["2026-11-30", "2026-12-01"].map((date) => ({
        ...shift,
        id: date,
        date,
        type: "NIGHT" as const,
        startTime: "22:00",
        endTime: "06:00",
      })),
      { ...early, id: "next", date: "2026-12-03", startTime: "06:00" },
    ];
    const findings = calculateMonthlyCompliance("2026-12", entries, "Europe/Berlin", {
      allEmploymentWorkRecorded: true,
    }).issues.filter((finding) => finding.rule === "PLANNING_NIGHT_RECOVERY");
    const screen = await render(list(findings, entries));
    expect(screen.getByText("Erholung nach 2 Nächten")).toBeVisible();
    expect(screen.getByText("Danach 24 Std. frei.")).toBeVisible();
    expect(screen.queryByLabelText("24:00 h arbeitsfreie Zeit")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(
      within(screen.getByTestId("planning-hint-detail-content")).getAllByText(/24 Std\./),
    ).toHaveLength(1);
    expect(screen.getByText("Empfohlen sind möglichst 48 Stunden freie Zeit.")).toBeVisible();
  });
  it.each([1, 3.1])(
    "explains the supplied 48:30-hour example only in details at text scale %s",
    async (scale) => {
      mockFontScale = scale;
      const entries: ShiftEntry[] = [
        ...["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"].map((date) => ({
          ...shift,
          id: date,
          date,
          type: "NIGHT" as const,
          startTime: "21:00",
          endTime: "07:30",
        })),
        { ...early, id: "next", date: "2026-08-10", startTime: "08:00" },
      ];
      const findings = calculateMonthlyCompliance("2026-08", entries, "Europe/Berlin", {
        allEmploymentWorkRecorded: true,
      }).issues.filter((finding) => finding.rule === "PLANNING_NIGHT_SERIES");
      const screen = await render(list(findings, entries));
      expect(screen.getByText("4 Nächte in Folge")).toBeVisible();
      expect(screen.queryByText(/48:30/)).toBeNull();
      expect(screen.queryByText("Warum dieser Hinweis?")).toBeNull();
      expect(screen.queryByText("Empfehlung & Quellen")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
      const details = within(screen.getByTestId("planning-hint-detail-content"));
      expect(details.queryByLabelText("48:30 h arbeitsfreie Zeit")).toBeNull();
      expect(details.queryByText(/nur die Anzahl der Nächte/)).toBeNull();
      expect(details.getByText(/08\.08\.2026/)).toBeTruthy();
      expect(details.getByText(/08\.08\.2026 · 07:30 bis 10\.08\.2026 · 08:00/)).toBeTruthy();
      expect(details.getAllByTestId(/^check-shift-/)).toHaveLength(5);
      expect(details.queryByRole("button", { name: "5 Dienste anzeigen" })).toBeNull();
      expect(details.getAllByTestId(/^check-shift-/)).toHaveLength(5);
      expect(details.queryAllByRole("link")).toHaveLength(0);
      await fireEvent.press(
        details.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
      );
      expect(details.getAllByRole("link")).toHaveLength(3);
    },
  );
  it("does not invent a four-week observation without facts and retains missing-entry context", async () => {
    const finding = issue({
      id: "weekend",
      kind: "PLANNING",
      rule: "PLANNING_WEEKEND_RECOVERY",
      title: "Wochenenddaten prüfen",
      relatedShiftIds: ["deleted"],
    });
    const screen = await render(list([finding], []));
    expect(screen.getByText("Wochenenddaten prüfen")).toBeVisible();
    expect(screen.queryByText(finding.description)).toBeNull();
    expect(screen.queryByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.queryByText(finding.description)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));
    expect(screen.getByText(finding.description)).toBeVisible();
    expect(screen.getByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeVisible();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("retires a cached three-weekend finding without inventing a four-week observation", async () => {
    const entries = [
      "2026-11-14",
      "2026-11-15",
      "2026-11-21",
      "2026-11-22",
      "2026-11-28",
      "2026-11-29",
    ].map((date) => ({ ...shift, id: date, date }));
    const finding = issue({
      id: "three-weekends",
      kind: "PLANNING",
      rule: "PLANNING_WEEKENDS",
      date: "2026-11-29",
      relatedShiftIds: entries.map((entry) => entry.id),
      facts: {
        rule: "PLANNING_WEEKENDS",
        count: 3,
        weekendSeries: {
          policyVersion: "2026-11-08",
          firstSaturday: "2026-11-14",
          lastSunday: "2026-11-29",
        },
      },
    });
    const screen = await render(list([finding], entries));
    expect(screen.queryByTestId("check-details-three-weekends")).toBeNull();
    expect(screen.queryByText("3 Wochenenden in Folge mit Diensten")).toBeNull();
    expect(screen.queryByRole("button", { name: /Details ansehen:/ })).toBeNull();
  });
  it("shows the screenshot series ending after midnight without changing the six start-day count", async () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      ...shift,
      id: `nov-series-${index}`,
      date: `2026-11-${24 + index}`,
      title: index < 3 ? "Tag" : "Nacht",
      type: index < 3 ? ("DAY" as const) : ("NIGHT" as const),
      startTime: index < 3 ? "08:00" : "21:00",
      endTime: index < 3 ? "16:12" : "07:30",
    }));
    const finding = issue({
      id: "nov-series",
      date: "2026-11-29",
      kind: "PLANNING",
      rule: "PLANNING_7_DAYS",
      relatedShiftIds: entries.map((entry) => entry.id),
      facts: { rule: "PLANNING_7_DAYS", count: 6 },
    });
    const screen = await render(list([finding], entries));
    expect(screen.getByText("6 Diensttage in Folge")).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.getByText("24.11.2026 · 08:00 bis 30.11.2026 · 07:30")).toBeVisible();
    expect(screen.getAllByTestId(/^check-shift-/)).toHaveLength(6);
  });
  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "keeps scope neutral in both appearances",
    async (palette) => {
      const spy = jest.spyOn(Palette, "usePalette").mockReturnValue(palette);
      try {
        const scope = issue({ rule: "SPECIAL_DUTY_REVIEW", severity: "info" });
        const screen = await render(list([scope]));
        expect(screen.getByText("Prüfumfang eingeschränkt")).toHaveStyle({
          color: palette.textMuted,
        });
        expect(screen.queryAllByTestId(/^check-details-/)).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    },
  );
  it.each([
    [390, 1],
    [320, 1],
    [390, 3.1],
  ])(
    "groups routine readiness into one collapsed scope at width %s and scale %s",
    async (width, scale) => {
      mockWindowWidth = width;
      mockFontScale = scale;
      const duties = ["STANDBY", "ON_CALL", "STANDBY"].map((kind, index) => ({
        ...shift,
        id: `scope-${index}`,
        date: `2026-12-0${index + 2}`,
        specialDuty: {
          ...newSpecialDuty(
            kind as "STANDBY" | "ON_CALL",
            shift.startTime!,
            shift.endTime!,
            "Europe/Berlin",
          ),
          calloutsComplete: kind === "ON_CALL",
        },
      }));
      const screen = await render(list(specialDutyComplianceIssues(duties, "2026-12"), duties));
      expect(screen.queryAllByTestId(/^check-day-group-/)).toHaveLength(0);
      expect(screen.queryAllByTestId(/^check-details-/)).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
      expect(screen.queryByTestId("check-complete")).toBeNull();
      expect(screen.getByText("Prüfung eingeschränkt")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Prüfungs-Dino" })).toBeNull();
      expect(screen.queryByText("Prüfung abgeschlossen")).toBeNull();
      const button = screen.getByRole("button", { name: /^Prüfstatus:/ });
      expect(button.props.accessibilityState.expanded).toBe(false);
      expect(button).toHaveStyle({ minHeight: 44 });
      expect(screen.queryByTestId("check-scope-details")).toBeNull();
      await fireEvent.press(button);
      expect(button.props.accessibilityState.expanded).toBe(true);
      expect(screen.queryByText(/^Bereitschaftsdienst wird/)).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: "Prüfgrenzen", expanded: false }));
      expect(screen.getAllByText(/^Bereitschaftsdienst wird/)).toHaveLength(1);
      expect(screen.getAllByText(/^Bei Rufbereitschaft werden/)).toHaveLength(1);
      await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
      await waitFor(() => expect(screen.queryByTestId("check-scope-details")).toBeNull());
      await screen.rerender(list(specialDutyComplianceIssues(duties, "2026-12"), duties, false));
      expect(screen.getAllByRole("button", { name: /^Prüfstatus:/ })).toHaveLength(1);
    },
  );
  it("preserves pauses, rest and incomplete-callout findings beside scope", async () => {
    const duty = {
      ...shift,
      id: "on-call",
      date: "2026-12-01",
      specialDuty: newSpecialDuty("ON_CALL", shift.startTime!, shift.endTime!, "Europe/Berlin"),
    };
    const findings = [
      ...specialDutyComplianceIssues([duty], "2026-12"),
      issue(),
      issue({
        id: "pause",
        rule: "ARBZG_4_INTERRUPTION",
        severity: "warning",
        title: "Unterbrechung als Pause prüfen",
      }),
    ];
    const screen = await render(list(findings, [early, shift, duty]));
    expect(screen.getByText("Rufbereitschaft: Einsatzzeiten ergänzen")).toBeTruthy();
    expect(screen.getByText("Ruhezeit zu kurz")).toBeTruthy();
    expect(screen.getByTestId("check-details-pause")).toBeTruthy();
    expect(screen.getAllByTestId(/^check-details-/)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Prüfungs-Dino" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Prüfstatus:/ })).toBeTruthy();
    await fireEvent.press(
      within(
        screen.getByTestId("check-details-SPECIAL_DUTY_CALLOUTS_INCOMPLETE:on-call:2026-12"),
      ).getByRole("button", { name: /Details ansehen/ }),
    );
    expect(screen.queryByRole("button", { name: "1 Dienst anzeigen" })).toBeNull();
    expect(screen.getByTestId("check-shift-on-call")).toBeTruthy();
  });
  beforeEach(() => {
    mockFontScale = 1;
    mockWindowWidth = 390;
  });

  it.each([LIGHT_PALETTE, DARK_PALETTE])(
    "uses distinct tariff and legal borders while legal explanations stay in Details",
    async (palette) => {
      const spy = jest.spyOn(Palette, "usePalette").mockReturnValue(palette);
      const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
      try {
        const finding = issue({
          facts: { rule: "ARBZG_5_REST_10H", restMinutes: 570, minimumRestMinutes: 600 },
        });
        const screen = await render(
          <ComplianceIssueContent
            issue={finding}
            shifts={[shift, early]}
            timeZone="Europe/Berlin"
          />,
        );
        const card = within(screen.getByTestId("check-details-rest"));
        expect(screen.getByTestId("check-details-rest")).toHaveStyle({
          backgroundColor: palette.surfaceRaised,
          borderColor: palette.legalCheckBorder,
          borderWidth: 1,
        });
        expect(card.getByText("Gesetzliche Prüfung")).toBeVisible();
        expect(card.getByText("9:30 h")).toBeVisible();
        expect(card.queryByText(finding.description)).toBeNull();
        expect(card.queryByRole("link")).toBeNull();
        await fireEvent.press(card.getByRole("button", { name: /Details ansehen:/ }));
        expect(screen.getByText(finding.description)).toBeVisible();
        expect(screen.getByTestId("check-shift-late")).toBeVisible();
        await fireEvent.press(
          screen.getByRole("link", { name: "Arbeitszeitgesetz · § 5 Ruhezeit" }),
        );
        expect(open).toHaveBeenCalledWith("https://www.gesetze-im-internet.de/arbzg/__5.html");
        expect(screen.queryByRole("button", { name: "2 Dienste anzeigen" })).toBeNull();
        expect(screen.getByTestId("check-shift-late")).toBeVisible();
      } finally {
        spy.mockRestore();
        open.mockRestore();
      }
    },
  );

  it.each([
    [LIGHT_PALETTE, 1],
    [DARK_PALETTE, 1],
    [LIGHT_PALETTE, 3.1],
    [DARK_PALETTE, 3.1],
  ] as [typeof LIGHT_PALETTE, number][])(
    "distinguishes planning from legal cards accessibly in both appearances",
    async (palette, scale) => {
      mockFontScale = scale;
      const spy = jest.spyOn(Palette, "usePalette").mockReturnValue(palette);
      try {
        const planning = issue({ id: "planning", kind: "PLANNING", severity: "warning" });
        const screen = await render(list([issue(), planning]));
        const card = screen.getByTestId(`planning-hint-card-${planning.date}`);
        const legal = screen.getByTestId("check-details-rest");
        const cardStyle = StyleSheet.flatten(card.props.style);
        const label = within(card).getByText("Hinweise & Empfehlungen");
        const labelStyle = StyleSheet.flatten(label.props.style);
        expect(within(card).getByText("Hinweise & Empfehlungen")).toBeVisible();
        expect(within(card).queryByText("Arbeitswissenschaftliche Hinweise")).toBeNull();
        expect(within(legal).getByText("Gesetzliche Prüfung")).toBeVisible();
        expect(legal).toHaveStyle({ backgroundColor: palette.surfaceRaised });
        expect(cardStyle.backgroundColor).toBe(palette.surfaceRaised);
        expect(labelStyle.color).toBe(palette.textMuted);
        expect(within(card).getByRole("button", { name: /Details ansehen:/ })).toHaveStyle({
          minHeight: 44,
        });
        expect(
          within(card).queryByTestId("warning-glyph", { includeHiddenElements: true }),
        ).toBeNull();
        expect(
          within(screen.getByTestId("check-issue-card-heading-rest")).getByTestId(
            "critical-glyph",
            {
              includeHiddenElements: true,
            },
          ),
        ).toHaveProp("color", palette.danger);
        expect(cardStyle.borderWidth).toBe(0);
        expect(
          colorContrastRatio(labelStyle.color, cardStyle.backgroundColor),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          colorContrastRatio(palette.legalCheckBorder, cardStyle.backgroundColor),
        ).toBeGreaterThanOrEqual(3);
        expect(colorContrastRatio(palette.text, cardStyle.backgroundColor)).toBeGreaterThanOrEqual(
          4.5,
        );
        await screen.rerender(list([issue(), planning], [early, shift], false));
        expect(screen.queryByText("Hinweise & Empfehlungen")).toBeNull();
        expect(screen.queryByText("Arbeitswissenschaftliche Hinweise")).toBeNull();
        expect(screen.getByTestId("check-details-rest")).toBeVisible();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("keeps mixed findings in one day group with category and severity on each card", async () => {
    const findings = [
      issue({
        id: "planning",
        kind: "PLANNING",
        severity: "warning",
        rule: "UNKNOWN",
        title: "Dienstfolge prüfen",
      }),
      issue({ id: "info", severity: "info", rule: "UNKNOWN", title: "Weiterer Hinweis" }),
      issue(),
    ];
    const screen = await render(list(findings));
    expect(screen.getAllByTestId(/^check-day-group-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^check-details-/).map((row) => row.props.testID)).toEqual([
      "check-details-rest",
      "check-details-planning",
      "check-details-info",
    ]);
    expect(
      within(screen.getByTestId("check-details-planning")).getByRole("button", {
        name: "Details ansehen: Dienstfolge prüfen",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("check-details-rest")).getByLabelText(
        "Ruhezeit zu kurz, Gesetzliche Prüfung, Kritisch",
      ),
    ).toBeTruthy();
    await screen.rerender(list(findings, [shift, early], false));
    expect(screen.queryByTestId("check-details-planning")).toBeNull();
    expect(screen.getAllByTestId(/^check-day-group-/)).toHaveLength(1);
    expect(screen.getByTestId("check-details-info")).toBeTruthy();
  });
  it("keeps a structured series and its shift detail route after copy changes", async () => {
    const shifts = Array.from({ length: 7 }, (_, index) => ({
      ...shift,
      id: `series-${index}`,
      date: `2026-12-0${index + 1}`,
    }));
    const finding = {
      ...issue({
        rule: "PLANNING_7_DAYS",
        kind: "PLANNING",
        severity: "warning",
        title: "Dienstfolge",
        description: "Eine kurze neue Formulierung.",
        relatedShiftIds: shifts.map((shift) => shift.id),
      }),
      facts: { rule: "PLANNING_7_DAYS" as const, count: 7 },
    };
    const screen = await render(list([finding], shifts));
    expect(screen.getByText("7 Diensttage in Folge")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.queryByRole("button", { name: "7 Dienste anzeigen" })).toBeNull();
    expect(screen.getAllByTestId(/^check-shift-/)).toHaveLength(7);
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("check-shift-series-0")).toBeNull());
    expect(screen.getByText("7 Diensttage in Folge")).toBeTruthy();
  });
  it("shows limited coverage separately, offers setup and never claims completion", async () => {
    const open = issue({
      id: "open",
      rule: "ARBZG_DATA_ALL_EMPLOYMENT",
      severity: "warning",
      title: "Arbeitszeiten aus allen Jobs erfasst?",
    });
    const screen = await render(list([open]));
    expect(screen.getByRole("button", { name: /^Prüfstatus:/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
    expect(screen.getByTestId("check-limited")).toBeTruthy();
    expect(screen.queryByTestId("check-complete")).toBeNull();
    expect(screen.queryByRole("button", { name: "Prüfungs-Dino" })).toBeNull();
    expect(screen.queryByText("Prüfung abgeschlossen")).toBeNull();
    expect(screen.queryByTestId("check-details-open")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Prüfstatus:/ }));
    expect(screen.getByRole("button", { name: "Angaben ergänzen" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await screen.rerender(list([open, issue()]));
    expect(screen.getByText("Ruhezeit zu kurz")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Prüfstatus:/ })).toBeTruthy();
  });
  it.each([
    [390, 1],
    [320, 1],
    [390, 3.1],
  ])("shows both endpoints and the gap at width %s and text scale %s", async (width, scale) => {
    mockFontScale = scale;
    mockWindowWidth = width;
    const screen = await render(list([issue()]));
    expect(screen.getByTestId("check-day-group-2026-12-01")).toHaveStyle({
      flexDirection: scale >= 1.3 || width < 360 ? "column" : "row",
    });
    expect(screen.getByRole("header", { name: "1. Dezember 2026" })).toBeTruthy();
    expect(screen.getByLabelText("Spät endet, 21:30, 30. November 2026")).toBeTruthy();
    expect(screen.getByLabelText("Früh beginnt, 07:00, 1. Dezember 2026")).toBeTruthy();
    expect(screen.getByText("Ruhezeit zu kurz")).toBeTruthy();
    expect(screen.getByText("9:30 h")).toBeTruthy();
    expect(screen.getByText("Spät endet")).toBeTruthy();
    expect(screen.getByText("Früh beginnt")).toBeTruthy();
    expect(screen.getByText("21:30")).toBeTruthy();
    expect(screen.getByText("07:00")).toBeTruthy();
    expect(screen.getByText("Mindestens 10 Std. Ruhezeit nötig.")).toBeTruthy();
    expect(screen.queryByText(issue().description)).toBeNull();
    expect(screen.queryByRole("button", { name: /Erklärung|Über die Prüfung/ })).toBeNull();
    expect(screen.queryByTestId("check-shift-late")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.queryByRole("button", { name: "2 Dienste anzeigen" })).toBeNull();
    expect(screen.getAllByTestId(/^check-shift-/).map((row) => row.props.testID)).toEqual([
      "check-shift-late",
      "check-shift-early",
    ]);
    expect(screen.queryByText("13:18–21:30")).toBeNull();
    expect(screen.getByTestId("check-shift-late").props.accessibilityLabel).toMatch(
      /13:18 bis 21:30/,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("check-shift-late")).toBeNull());
    expect(screen.getByText("9:30 h")).toBeTruthy();
  });
  it("keeps every finding immediately visible, in date and severity order", async () => {
    const screen = await render(
      list([
        issue({
          id: "later",
          date: "2026-12-04",
          rule: "TEST",
          title: "Später",
          description: "Später prüfen",
          kind: "PLANNING",
          severity: "warning",
        }),
        issue(),
      ]),
    );
    expect(screen.getAllByRole("header").map((h) => h.props.accessibilityLabel)).toEqual([
      "1. Dezember 2026",
      "4. Dezember 2026",
    ]);
    expect(screen.getByTestId("check-details-rest")).toBeTruthy();
    expect(screen.getByTestId("check-details-later")).toBeTruthy();
    expect(screen.getByText("Später")).toBeTruthy();
    expect(screen.queryByText("Später prüfen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Details ansehen: Später" }));
    expect(screen.queryByText("Später prüfen")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));
    expect(screen.getByText("Später prüfen")).toBeTruthy();
  });
  it("closes a planning sheet when the finding is filtered out", async () => {
    const planning = issue({ id: "planning", kind: "PLANNING" });
    const screen = await render(list([planning]));
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    await screen.rerender(list([planning], [shift, early], false));
    expect(screen.queryByTestId("check-shift-late")).toBeNull();
    expect(screen.queryByText(/Planungshinweise ausgeblendet/)).toBeNull();
    expect(screen.getByText("Keine Auffälligkeiten in den unterstützten Prüfungen.")).toBeTruthy();
    await screen.rerender(list([planning]));
    expect(screen.queryByTestId("check-shift-late")).toBeNull();
  });
  it.each([1, 3.1])(
    "keeps a long work series compact and opens all days at text scale %s",
    async (scale) => {
      mockFontScale = scale;
      const shifts = Array.from({ length: 12 }, (_, index) => ({
        ...shift,
        id: `day-${index}`,
        date: Temporal.PlainDate.from("2026-11-23").add({ days: index }).toString(),
      }));
      const series = issue({
        id: "series",
        rule: "PLANNING_7_DAYS",
        kind: "PLANNING",
        date: "2026-12-04",
        description: "12 aufeinanderfolgende Arbeitstage wurden erkannt.",
        relatedShiftIds: shifts.map((s) => s.id),
      });
      const screen = await render(list([series], [...shifts].reverse()));
      expect(screen.getByText("12 Diensttage hintereinander")).toBeTruthy();
      expect(screen.queryByText("23. November")).toBeNull();

      expect(screen.queryByTestId("check-shift-day-0")).toBeNull();
      await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
      expect(screen.getByText("23.11.2026 · 13:18 bis 04.12.2026 · 21:30")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "12 Dienste anzeigen" })).toBeNull();
      expect(screen.getAllByTestId(/^check-shift-/).map((r) => r.props.testID)).toEqual(
        shifts.map((s) => `check-shift-${s.id}`),
      );
      expect(screen.getByTestId("check-shift-day-0").props.accessibilityLabel).toBe(
        "Spät, 23. November 2026, 13:18 bis 21:30",
      );
    },
  );
  it("falls back without a made-up gap and explains missing/deleted shifts", async () => {
    const screen = await render(list([issue()], [{ ...early, deletedAt: "2026-12-01" }, shift]));
    expect(screen.queryByText("9:30 h")).toBeNull();
    expect(screen.queryByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /Details ansehen:/ }));
    expect(screen.getByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeTruthy();
    expect(screen.getByText(issue().description)).toBeTruthy();
    expect(screen.queryByText("9:30 h")).toBeNull();
  });
  it("keeps an unknown finding's original explanation reachable in Details", async () => {
    const finding = issue({
      rule: "UNKNOWN",
      title: "Offene Bedingung",
      description: "Unbekannte Bedingung und Frist bleiben sichtbar.",
      relatedShiftIds: [],
    });
    const screen = await render(list([finding], []));
    expect(screen.getByText(finding.title)).toBeTruthy();
    expect(screen.queryByText(finding.description)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Details ansehen: Offene Bedingung" }),
    );
    expect(screen.getByText(finding.description)).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("centers an actually completed result", async () => {
    const screen = await render(list([], []));
    expect(screen.getByTestId("check-complete")).toHaveStyle({
      flexGrow: 1,
      minHeight: 280,
      justifyContent: "center",
      alignItems: "center",
    });
    expect(screen.getByRole("header", { name: "Dienstplan-Check" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prüfungs-Dino" })).toBeTruthy();
  });
});
it("formats dates even when localization is unavailable", () => {
  const locale = jest
    .spyOn(Temporal.PlainDate.prototype, "toLocaleString")
    .mockImplementation(() => {
      throw new Error("Unsupported runtime localization");
    });
  try {
    expect(checkDate("2026-08-25")).toBe("25. August 2026");
    expect(checkDate("2024-02-29", false)).toBe("29. Februar");
    expect(checkDate("2026-02-30")).toBe("Datum nicht verfügbar");
    expect(checkDayParts("2026-12-01")).toEqual(["1", "Dez."]);
    expect(checkDayParts("2024-02-29")).toEqual(["29", "Feb."]);
    expect(checkDayParts("2026-02-30")).toEqual(["—", ""]);
    expect(locale).not.toHaveBeenCalled();
  } finally {
    locale.mockRestore();
  }
});
