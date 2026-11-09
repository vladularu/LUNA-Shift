import { render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ComplianceIssue, MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { PLANNING_NIGHT_POLICY } from "@/domain/planning-night-policy";
import { ComplianceDayList } from "./compliance-day-list";
import { countChecks } from "./check-visibility";

jest.mock("./compliance-issue-content", () => {
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    checkDate: (value: string) => value,
    checkDayParts: (value: string) => [value.slice(8), value.slice(5, 7)],
    ComplianceIssueContent: ({
      issue,
      relatedIssues = [],
    }: {
      issue: ComplianceIssue;
      relatedIssues?: readonly ComplianceIssue[];
    }) => (
      <Native.View
        testID={`group-card-${issue.id}`}
        accessibilityLabel={`${relatedIssues.length + 1} Prüfpunkte`}
      >
        {[issue, ...relatedIssues].map((item) => (
          <Native.Text key={item.id}>{item.title}</Native.Text>
        ))}
      </Native.View>
    ),
  };
});
jest.mock("./check-prerequisites-card", () => {
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CheckPrerequisitesCard: ({
      issues = [],
      scopeIssues = [],
    }: {
      issues?: readonly ComplianceIssue[];
      scopeIssues?: readonly ComplianceIssue[];
    }) => (
      <Native.View testID="status-card">
        <Native.Text>
          {issues.length} Angaben, {scopeIssues.length} Umfang
        </Native.Text>
      </Native.View>
    ),
  };
});
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);
let mockWidth = 390;
let mockFontScale = 1;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: mockFontScale }),
}));

const entries: ShiftEntry[] = Array.from({ length: 6 }, (_, index) => ({
  kind: "SHIFT",
  id: `duty-${index}`,
  templateId: null,
  date: `2026-11-0${index + 2}`,
  title: index >= 2 ? "Nacht" : "Tag",
  type: index >= 2 ? "NIGHT" : "DAY",
  startTime: index >= 2 ? "21:00" : "08:00",
  endTime: index >= 2 ? "07:00" : "16:00",
  breakMinutes: 60,
  color: "#123456",
  symbol: "D",
  note: null,
  overtimeMinutes: 0,
  holidayPremiumMode: "WITH_TIME_OFF",
  revision: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
}));
const work: ComplianceIssue = {
  id: "work",
  date: "2026-11-07",
  kind: "PLANNING",
  severity: "warning",
  rule: "PLANNING_7_DAYS",
  title: "6 Diensttage in Folge",
  description: "Erklärung zur Dienstserie.",
  relatedShiftIds: entries.map((entry) => entry.id),
  facts: { rule: "PLANNING_7_DAYS", count: 6 },
};
const night: ComplianceIssue = {
  ...work,
  id: "night",
  rule: "PLANNING_NIGHT_SERIES",
  title: "4 Nächte in Folge",
  description: "Erklärung zur Nachtserie.",
  relatedShiftIds: entries.slice(2).map((entry) => entry.id),
  facts: {
    rule: "PLANNING_NIGHT_SERIES",
    count: 4,
    nightSequence: {
      policyVersion: PLANNING_NIGHT_POLICY.version,
      firstNight: "2026-11-04",
      lastNight: "2026-11-07",
      countIsMinimum: false,
      recoveryStatus: "open",
      restMinutes: null,
      lastShiftId: entries[5].id,
      nextShiftId: null,
    },
  },
};
const legal: ComplianceIssue = {
  ...work,
  id: "legal",
  kind: "LEGAL",
  rule: "ARBZG_4_BREAK",
  title: "Pause zu kurz",
  facts: { rule: "ARBZG_4_BREAK", recordedBreakMinutes: 0, requiredBreakMinutes: 30 },
};
const prerequisite: ComplianceIssue = {
  ...legal,
  id: "jobs",
  rule: "ARBZG_DATA_ALL_EMPLOYMENT",
  title: "Alle Jobs erfasst?",
  facts: undefined,
};
const scope: ComplianceIssue = {
  ...legal,
  id: "scope",
  rule: "SPECIAL_DUTY_REVIEW",
  severity: "info",
  title: "Prüfumfang Bereitschaften",
  facts: undefined,
};
function result(issues: readonly ComplianceIssue[]): MonthlyComplianceResult {
  return {
    month: "2026-11",
    issues,
    affectedDates: [...new Set(issues.map((item) => item.date))],
    ...countChecks(issues),
  };
}
const list = (issues: readonly ComplianceIssue[], showPlanning = true) => (
  <ComplianceDayList
    compliance={result(issues)}
    shifts={entries}
    showPlanning={showPlanning}
    timeZone="Europe/Berlin"
  />
);

describe("Dienstplan check display integration", () => {
  beforeEach(() => {
    mockWidth = 390;
    mockFontScale = 1;
  });

  it("keeps work and night observations as separate rows in one date card without changing raw counts", async () => {
    const source = result([work, night]);
    const before = JSON.stringify(source);
    const screen = await render(
      <ComplianceDayList
        compliance={source}
        shifts={entries}
        showPlanning
        timeZone="Europe/Berlin"
      />,
    );
    expect(screen.getAllByLabelText("1 Prüfpunkte")).toHaveLength(2);
    expect(screen.getAllByTestId(/^planning-hint-card-/)).toHaveLength(1);
    expect(screen.getByText(work.title)).toBeTruthy();
    expect(screen.getByText(night.title)).toBeTruthy();
    expect(screen.getByTestId("group-card-night")).toBeTruthy();
    expect(source.warningCount).toBe(2);
    expect(source.issues).toHaveLength(2);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("preserves independent legal cards", async () => {
    const screen = await render(
      list([legal, { ...legal, id: "other-legal", title: "Andere Pausenprüfung" }]),
    );
    expect(screen.getByTestId("group-card-legal")).toBeTruthy();
    expect(screen.getByTestId("group-card-other-legal")).toBeTruthy();
  });

  it("hides the complete recommendation group while keeping legal findings", async () => {
    const screen = await render(list([work, legal, night], false));
    expect(screen.queryByText(work.title)).toBeNull();
    expect(screen.queryByText(night.title)).toBeNull();
    expect(screen.getByTestId("group-card-legal")).toBeTruthy();
  });

  it("retains a readable stacked day group at large text and narrow widths", async () => {
    mockWidth = 320;
    mockFontScale = 2;
    const screen = await render(list([work, night]));
    expect(screen.getByTestId("check-day-group-2026-11-07")).toHaveStyle({
      flexDirection: "column",
    });
    expect(screen.getByRole("header", { name: "2026-11-07" })).toBeTruthy();
    expect(screen.getAllByLabelText("1 Prüfpunkte")).toHaveLength(2);
  });

  it("bounds the empty result to supported checks", async () => {
    const screen = await render(list([]));
    expect(screen.getByText("Keine Auffälligkeiten in den unterstützten Prüfungen.")).toBeTruthy();
    expect(screen.queryByText("Prüfung abgeschlossen")).toBeNull();
  });

  it("does not show an all-clear when required inputs are missing", async () => {
    const screen = await render(list([prerequisite]));
    expect(screen.getByTestId("status-card")).toBeTruthy();
    expect(screen.getByText("Prüfung eingeschränkt")).toBeTruthy();
    expect(screen.queryByText("Prüfung abgeschlossen")).toBeNull();
  });

  it("renders scope-only limitations in the same single status card", async () => {
    const screen = await render(list([scope]));
    expect(screen.getAllByTestId("status-card")).toHaveLength(1);
    expect(screen.getByText("0 Angaben, 1 Umfang")).toBeTruthy();
    expect(screen.queryByTestId("check-scope")).toBeNull();
  });

  it("combines prerequisites and scope limitations without duplicating status UI", async () => {
    const screen = await render(list([prerequisite, scope, legal]));
    expect(screen.getAllByTestId("status-card")).toHaveLength(1);
    expect(screen.getByText("1 Angaben, 1 Umfang")).toBeTruthy();
    expect(screen.queryByTestId("check-scope")).toBeNull();
    expect(screen.getByTestId("group-card-legal")).toBeTruthy();
  });
});
