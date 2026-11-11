import { fireEvent, waitFor, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "./check-issue-route.test";

import type { ComplianceIssue, MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { PLANNING_NIGHT_POLICY } from "@/domain/planning-night-policy";
import { AssessmentSummaryCard, ComplianceDetails } from "@/features/analysis/analysis-screen";
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
// These cases exercise compliance components; the salary row has dedicated integration coverage.
jest.mock("@/features/analysis/analysis-net-pay-row", () => ({ AnalysisNetPayRow: () => null }));
jest.mock("@/features/analysis/analysis-salary-inputs", () => ({
  AnalysisSalaryInputsProvider: ({ children }: import("react").PropsWithChildren) => children,
  useAnalysisSalaryInputs: () => ({
    status: "ready",
    saved: null,
    annualPayments: [],
    error: null,
  }),
}));
jest.mock("@/features/salary/use-net-pay-profile", () => ({
  useNetPayProfile: () => ({
    status: "ready",
    saved: null,
    timeline: [],
    annualPayments: [],
    error: null,
  }),
}));

function shift(
  id: string,
  date: string,
  title: string,
  startTime: string,
  endTime: string,
): ShiftEntry {
  return {
    kind: "SHIFT",
    id,
    date,
    templateId: null,
    title,
    type: "DAY",
    startTime,
    endTime,
    breakMinutes: 30,
    color: "#2F80ED",
    symbol: "D",
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

const shifts = [
  shift("late", "2026-08-04", "Spät", "14:00", "22:00"),
  shift("early-a", "2026-08-05", "Früh", "06:00", "14:00"),
  shift("early-b", "2026-08-06", "Früh", "06:00", "14:00"),
];

const compliance: MonthlyComplianceResult = {
  month: "2026-08",
  criticalCount: 3,
  warningCount: 0,
  infoCount: 0,
  affectedDates: ["2026-08-05", "2026-08-06", "2026-08-12"],
  issues: [
    {
      id: "rest-a",
      severity: "critical",
      kind: "LEGAL",
      rule: "ARBZG_5_REST_10H",
      title: "Ruhezeit unter 10 Stunden",
      description: "Zwischen den Diensten liegen nur 8 h Ruhezeit.",
      relatedShiftIds: ["late", "early-a"],
      date: "2026-08-05",
    },
    {
      id: "rest-b",
      severity: "critical",
      kind: "LEGAL",
      rule: "ARBZG_5_REST_10H",
      title: "Ruhezeit unter 10 Stunden",
      description: "Zwischen den Diensten liegen nur 9 h Ruhezeit.",
      relatedShiftIds: ["early-a", "early-b"],
      date: "2026-08-06",
    },
    {
      id: "overlap",
      severity: "critical",
      kind: "LEGAL",
      rule: "SHIFT_OVERLAP",
      title: "Dienste überschneiden sich",
      description: "Zwei arbeitszeitrelevante Einträge liegen zeitlich übereinander.",
      relatedShiftIds: ["early-a", "early-b"],
      date: "2026-08-12",
    },
  ],
};

describe("analysis compliance details", () => {
  it("retains the limited status without a permanent weekend overview when empty legal sections are hidden", async () => {
    const screen = await render(
      <ComplianceDetails
        compliance={{
          ...compliance,
          issues: [],
          weekendAssessment: {
            policyVersion: "2026-11-09-four-weeks",
            month: "2026-11",
            weekends: [],
            windows: [],
            totalCount: 5,
            occupiedCount: 2,
            freeCount: 2,
            unknownCount: 1,
          },
        }}
        shifts={[]}
        showPlanning={false}
        hideEmptyLegal
      />,
    );
    expect(screen.queryByTestId("weekend-assessment-summary")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wochenendübersicht ansehen" })).toBeNull();
    expect(screen.getByText("Prüfung eingeschränkt")).toBeVisible();
    expect(screen.getByText("Dienstplan-Check")).toBeVisible();
    expect(screen.queryByText("Gesetz & Tarif")).toBeNull();
  });
  it("presents grouped planning findings as neutral hints", async () => {
    const planning = {
      ...compliance.issues[0],
      id: "planning",
      kind: "PLANNING" as const,
      severity: "warning" as const,
      rule: "PLANNING_7_DAYS",
      title: "Dienstfolge prüfen",
    };
    const screen = await render(
      <ComplianceDetails
        compliance={{ ...compliance, criticalCount: 0, warningCount: 1, issues: [planning] }}
        shifts={shifts}
      />,
    );
    const button = screen.getByRole("button", { name: "Details ansehen: Dienstfolge prüfen" });
    expect(button.props.accessibilityHint).toContain("Erklärung");
    const group = within(screen.getByTestId("check-details-planning"));
    expect(group.getByRole("button", { name: "Details ansehen: Dienstfolge prüfen" })).toHaveStyle({
      minHeight: 44,
    });
    expect(group.queryByTestId("warning-glyph", { includeHiddenElements: true })).toBeNull();
    expect(group.queryByTestId("critical-glyph", { includeHiddenElements: true })).toBeNull();
  });
  it("keeps work and night as independently tappable rows with their own duty overviews", async () => {
    const duties = Array.from({ length: 6 }, (_, index) => ({
      ...shift(
        `series-${index}`,
        `2026-11-0${index + 2}`,
        index >= 2 ? "Nacht" : "Tag",
        index >= 2 ? "21:00" : "08:00",
        index >= 2 ? "07:00" : "16:00",
      ),
      type: index >= 2 ? ("NIGHT" as const) : ("DAY" as const),
    }));
    const following = shift("following", "2026-11-09", "Tag danach", "08:00", "16:00");
    const work: ComplianceIssue = {
      id: "work-series",
      date: "2026-11-07",
      kind: "PLANNING",
      severity: "info",
      rule: "PLANNING_7_DAYS",
      title: "6 Diensttage in Folge",
      description: "Original der Dienstfolge",
      relatedShiftIds: duties.map((duty) => duty.id),
      facts: { rule: "PLANNING_7_DAYS", count: 6 },
    };
    const night: ComplianceIssue = {
      ...work,
      id: "night-series",
      rule: "PLANNING_NIGHT_SERIES",
      title: "4 Nächte in Folge",
      description: "Original der Nachtfolge",
      relatedShiftIds: [...duties.slice(2).map((duty) => duty.id), following.id],
      facts: {
        rule: "PLANNING_NIGHT_SERIES",
        count: 4,
        nightSequence: {
          policyVersion: PLANNING_NIGHT_POLICY.version,
          firstNight: "2026-11-04",
          lastNight: "2026-11-07",
          countIsMinimum: false,
          recoveryStatus: "under48",
          restMinutes: 1500,
          lastShiftId: duties[5].id,
          nextShiftId: following.id,
        },
      },
    };
    const screen = await render(
      <ComplianceDetails
        compliance={{ ...compliance, month: "2026-11", issues: [night, work] }}
        shifts={[...duties, following]}
        embedded
        hideEmptyLegal
        timeZone="UTC"
      />,
    );
    expect(screen.getAllByTestId(/^planning-hint-card-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^planning-hint-row-/)).toHaveLength(2);
    expect(screen.getByText("6 Diensttage in Folge")).toBeVisible();
    expect(screen.getByText("4 Nächte in Folge")).toBeVisible();
    expect(screen.queryByText("2 Prüfpunkte")).toBeNull();
    expect(screen.queryByText(work.description)).toBeNull();
    expect(screen.queryByText(night.description)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Details ansehen: 6 Diensttage in Folge" }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
    );
    expect(
      screen.getByRole("link", {
        name: "BAuA: Arbeitszeitgestaltung – Handbuch zur Gefährdungsbeurteilung",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "BGW: Nacht- und Schichtarbeit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dienste anzeigen/ })).toBeNull();
    expect(screen.getByTestId("check-shift-series-0")).toBeVisible();
    expect(screen.queryByTestId("check-shift-following")).toBeNull();
    expect(screen.getAllByLabelText(/^Nacht,/)).toHaveLength(4);
    await fireEvent.press(screen.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(screen.queryByTestId("planning-hint-detail-content")).toBeNull());
    await fireEvent.press(
      screen.getByRole("button", { name: "Details ansehen: 4 Nächte in Folge" }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
    );
    expect(screen.getByRole("link", { name: "BGW: Nacht- und Schichtarbeit" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Dienste (anzeigen|ausblenden)/ })).toBeNull();
    expect(screen.getByTestId("check-affected-shifts")).toBeVisible();
  });
  it("uses the supplied profile timezone in planning details across the clock change", async () => {
    const late = {
      ...shift("late", "2026-03-28", "Spät", "13:18", "21:30"),
      type: "LATE" as const,
    };
    const early = {
      ...shift("early", "2026-03-29", "Früh", "07:00", "15:12"),
      type: "EARLY" as const,
    };
    const planning: ComplianceIssue = {
      id: "late-early",
      date: early.date,
      kind: "PLANNING",
      severity: "info",
      rule: "PLANNING_LATE_EARLY",
      title: "Dienstwechsel",
      description: "Original des Dienstwechsels",
      relatedShiftIds: [late.id, early.id],
    };
    const screen = await render(
      <ComplianceDetails
        compliance={{ ...compliance, issues: [planning] }}
        shifts={[late, early]}
        hideEmptyLegal
        timeZone="UTC"
      />,
    );
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Details ansehen: Spät- und Frühdienst direkt nacheinander",
      }),
    );
    expect(screen.getByLabelText("9:30 h arbeitsfreie Zeit")).toBeVisible();
  });
  it("shows scope without warning totals, completion or missing-input setup in the embedded view", async () => {
    const scope = {
      ...compliance.issues[0],
      id: "scope",
      rule: "SPECIAL_DUTY_REVIEW",
      severity: "info" as const,
    };
    const limited = { ...compliance, issues: [scope] };
    const screen = await render(
      <AssessmentSummaryCard compliance={limited} shifts={shifts} expanded onToggle={jest.fn()} />,
    );
    expect(screen.queryByText("Meldung")).toBeNull();
    expect(screen.queryByText("Meldungen")).toBeNull();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Prüfstatus:/ }).props.accessibilityState.expanded,
    ).toBe(false);
    expect(screen.getAllByText("Prüfung eingeschränkt")).toHaveLength(2);
    expect(screen.getByText("Gesetz & Tarif")).toBeVisible();
  });
  it("shows one neutral total whose color carries the severity", async () => {
    const mixedCompliance: MonthlyComplianceResult = {
      ...compliance,
      criticalCount: 2,
      warningCount: 1,
      issues: compliance.issues.map((item, index) => ({
        ...item,
        severity: index === 2 ? "warning" : "critical",
      })),
    };
    const screen = await render(
      <AssessmentSummaryCard
        compliance={mixedCompliance}
        expanded={false}
        onToggle={() => undefined}
        shifts={shifts}
      />,
    );

    expect(screen.getByRole("button", { name: "Dienstplan-Check, 3 Meldungen" })).toBeTruthy();
    expect(screen.getByText("3", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("Meldungen")).toBeTruthy();
    expect(screen.queryByText(/kritisch/i)).toBeNull();
    expect(screen.queryByText(/\+1 Meldung/)).toBeNull();
  });

  it("groups repeated issues and reveals readable case details by rule", async () => {
    const screen = await render(
      <ComplianceDetails compliance={compliance} embedded shifts={shifts} />,
    );

    expect(screen.getAllByText("Ruhezeit unter 10 Stunden")).toHaveLength(1);
    expect(screen.queryByText("+2 Meldungen")).toBeNull();
    expect(screen.queryByText("+1 Meldung")).toBeNull();
    expect(screen.getByText("2", { includeHiddenElements: true })).toHaveStyle({
      fontVariant: ["tabular-nums"],
    });
    expect(screen.queryByText("1", { includeHiddenElements: true })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Dienste überschneiden sich, 1 Meldung" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Tage? betroffen/)).toBeNull();
    expect(screen.queryByText(/ArbZG/)).toBeNull();
    expect(screen.queryByText("Zwischen den Diensten liegen nur 8 h Ruhezeit.")).toBeNull();

    const restGroup = screen.getByRole("button", {
      name: "Ruhezeit unter 10 Stunden, 2 Meldungen",
    });
    expect(restGroup).toHaveStyle({ minHeight: 64 });
    await fireEvent.press(restGroup);

    expect(screen.getByText("Zwischen den Diensten liegen nur 8 h Ruhezeit.")).toBeTruthy();
    expect(screen.getByText("Zwischen den Diensten liegen nur 9 h Ruhezeit.")).toBeTruthy();
    expect(screen.getAllByText(/05\. Aug/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/06\. Aug/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Dienste anzeigen/ })).toBeNull();
    expect(screen.getByText("Spät")).toBeTruthy();
    expect(screen.getAllByText("Früh").length).toBeGreaterThan(0);
    expect(screen.queryByText(/14:00–22:00/)).toBeNull();
    expect(screen.queryByText(/06:00–14:00/)).toBeNull();
    expect(screen.getAllByLabelText(/Spät,.*14:00 bis 22:00/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Früh,.*06:00 bis 14:00/).length).toBeGreaterThan(0);
    await fireEvent.press(
      screen.getByRole("button", { name: "Dienste überschneiden sich, 1 Meldung" }),
    );
    expect(screen.queryByText("Zwischen den Diensten liegen nur 8 h Ruhezeit.")).toBeNull();
    expect(
      screen.getByText("Zwei arbeitszeitrelevante Einträge liegen zeitlich übereinander."),
    ).toBeVisible();
  });
});
