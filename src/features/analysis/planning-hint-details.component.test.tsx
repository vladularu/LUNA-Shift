import { describe, expect, it, jest } from "@jest/globals";
import { render } from "./check-issue-route.test";
import { fireEvent } from "@testing-library/react-native";
import type { ComplianceIssue } from "@/domain/types";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { PlanningHintDetails } from "./planning-hint-details";
import { planningHintPresentation } from "./planning-hint-presentation";
import { AffectedCheckShifts, ComplianceIssueContent } from "./compliance-issue-content";
import { calculateMonthlyCompliance } from "@/engine/compliance";

const work: ComplianceIssue = {
  id: "work",
  kind: "PLANNING",
  severity: "info",
  rule: "PLANNING_7_DAYS",
  date: "2026-10-08",
  title: "Originaltitel",
  description: "Doppelter Originaltext der Dienstserie",
  relatedShiftIds: [],
  facts: { rule: "PLANNING_7_DAYS", count: 7 },
};

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);

describe("single concise planning detail explanation", () => {
  it("keeps an unknown critical compact row short and its original explanation fully reachable", async () => {
    const original =
      "Erster kritischer Originalsatz. Zweite wichtige Angabe. Dritter unveränderter Sachverhalt.";
    const issue: ComplianceIssue = {
      ...work,
      rule: "UNKNOWN_RULE",
      facts: undefined,
      severity: "critical",
      title: "Kritischer Originalhinweis",
      description: original,
    };
    const before = JSON.stringify(issue);
    const screen = await render(
      <ComplianceIssueContent issue={issue} shifts={[]} timeZone="Europe/Berlin" compact />,
    );
    expect(screen.getByText(issue.title)).toBeVisible();
    expect(screen.queryByText(original)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Details ansehen: Kritischer Originalhinweis" }),
    );
    expect(
      screen.getByText("Für diesen Hinweis sind die Angaben nicht eindeutig auswertbar."),
    ).toBeVisible();
    expect(screen.queryByText(original)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));
    expect(screen.getByText(original)).toBeVisible();
    expect(JSON.stringify(issue)).toBe(before);
  });
  it("keeps a long unknown original complete behind a usable initially closed disclosure", async () => {
    const original =
      "Erster unbekannter Sachverhalt. Zweiter ursprünglicher Hinweis. Dritte wichtige Originalangabe.";
    const hint = planningHintPresentation({
      ...work,
      rule: "UNKNOWN_RULE",
      facts: undefined,
      description: original,
    });
    const screen = await render(
      <PlanningHintDetails hint={hint} rest={null} series={null} missing={false}>
        {null}
      </PlanningHintDetails>,
    );
    expect(
      screen.getByText("Für diesen Hinweis sind die Angaben nicht eindeutig auswertbar."),
    ).toBeVisible();
    expect(screen.queryByText(original)).toBeNull();
    const details = screen.getByRole("button", { name: "Weitere Angaben", expanded: false });
    expect(details).toHaveStyle({ minHeight: 44 });
    await fireEvent.press(details);
    expect(screen.getByText(original)).toBeVisible();
    expect(screen.getByRole("button", { name: "Weitere Angaben", expanded: true })).toBeVisible();
  });
  it("shows affected weekend periods once without any passing general overview", async () => {
    const duties = ["2026-09-19", "2026-09-26", "2026-10-03"].map((date) =>
      forecastShift({ id: date, date, type: "DAY", startTime: "08:00", endTime: "16:00" }),
    );
    const result = calculateMonthlyCompliance("2026-10", duties, "Europe/Berlin", {
      allEmploymentWorkRecorded: true,
    });
    const issue = result.issues.find((value) => value.rule === "PLANNING_WEEKEND_RECOVERY")!;
    expect(issue).toBeDefined();
    const hint = planningHintPresentation(issue);
    const screen = await render(
      <PlanningHintDetails
        hint={hint}
        rest={null}
        series={null}
        missing={false}
        originalDescription={issue.description}
      >
        {null}
      </PlanningHintDetails>,
    );
    expect(screen.getAllByText("14.09.2026 bis 11.10.2026")).toHaveLength(1);
    expect(screen.queryByText("07.09.2026 bis 04.10.2026")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Weitere betroffene Zeiträume (1)", expanded: false }),
    );
    expect(screen.getByText("07.09.2026 bis 04.10.2026")).toBeVisible();
    expect(screen.queryByText("28.09.2026 bis 25.10.2026")).toBeNull();
    expect(screen.queryByText("Wochenenden im Monat")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wochenendübersicht ansehen" })).toBeNull();
  });
  it("shows one structured explanation, source and immediately visible duty overview", async () => {
    const hint = planningHintPresentation(work);
    const duties = Array.from({ length: 7 }, (_, index) =>
      forecastShift({ id: "duty-" + index, date: "2026-10-" + String(index + 2).padStart(2, "0") }),
    );
    const screen = await render(
      <PlanningHintDetails
        hint={hint}
        rest={null}
        series={{ count: 7, unit: "Diensttage", from: "2026-10-02", until: "2026-10-08" }}
        missing={false}
        originalDescription={work.description}
      >
        <AffectedCheckShifts shifts={duties} />
      </PlanningHintDetails>,
    );
    expect(screen.getAllByText(hint.explanation)).toHaveLength(1);
    expect(screen.getAllByText(hint.recommendation!)).toHaveLength(1);
    expect(screen.queryByText(work.description)).toBeNull();
    expect(screen.queryByText("Weitere Angaben zum Prüfpunkt")).toBeNull();
    expect(screen.getByText(hint.explanation)).toHaveStyle({ fontSize: 16 });
    expect(screen.queryByText("Warum dieser Hinweis?")).toBeNull();
    expect(screen.queryByRole("link", { name: hint.sources[0]!.title })).toBeNull();
    expect(screen.queryByText(hint.policyNote!)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
    );
    expect(screen.getAllByRole("link", { name: hint.sources[0]!.title })).toHaveLength(1);
    expect(screen.getByText(hint.policyNote!)).toBeVisible();
    expect(screen.queryByText(/Dies ist eine arbeitswissenschaftliche Empfehlung/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Dienste anzeigen/ })).toBeNull();
    expect(screen.getByTestId("check-shift-duty-0")).toBeVisible();
  });
  it.each<["under24" | "under48", number, string, string]>([
    ["under24", 1380, "23 Std.", "48"],
    ["under48", 2850, "47 Std. 30 Min.", "24"],
  ])(
    "keeps the %s observation and applicable recovery recommendation once",
    async (recoveryStatus, restMinutes, duration, excluded) => {
      const issue: ComplianceIssue = {
        ...work,
        id: "recovery",
        rule: "PLANNING_NIGHT_RECOVERY",
        facts: {
          rule: "PLANNING_NIGHT_RECOVERY",
          count: 3,
          nightSequence: {
            policyVersion: "2026-11-07",
            firstNight: "2026-10-01",
            lastNight: "2026-10-03",
            countIsMinimum: false,
            recoveryStatus,
            restMinutes,
            lastShiftId: "last",
            nextShiftId: "next",
          },
        },
      };
      const hint = planningHintPresentation(issue);
      const previous = forecastShift({
        id: "last",
        date: "2026-10-03",
        type: "NIGHT",
        startTime: "21:00",
        endTime: "07:30",
      });
      const next = forecastShift({
        id: "next",
        date: recoveryStatus === "under24" ? "2026-10-05" : "2026-10-06",
        startTime: recoveryStatus === "under24" ? "06:30" : "07:00",
      });
      const screen = await render(
        <PlanningHintDetails
          hint={hint}
          rest={{
            previous,
            next,
            endDate: "2026-10-04",
            startDate: next.date,
            minutes: restMinutes,
          }}
          series={null}
          missing={false}
          originalDescription={work.description}
        >
          {null}
        </PlanningHintDetails>,
      );
      expect(screen.getAllByText(new RegExp(duration))).toHaveLength(1);
      expect(screen.getAllByText(hint.recommendation!)).toHaveLength(1);
      expect(hint.recommendation).not.toContain(excluded);
      expect(screen.queryByText(work.description)).toBeNull();
      expect(screen.queryByRole("link", { name: hint.sources[0]!.title })).toBeNull();
      await fireEvent.press(
        screen.getByRole("button", { name: "Quelle und Prüfgrenzen", expanded: false }),
      );
      expect(screen.getAllByRole("link", { name: hint.sources[0]!.title })).toHaveLength(1);
    },
  );
  it("does not invent a start date from a structured work count when duties are unavailable", async () => {
    const screen = await render(
      <PlanningHintDetails
        hint={planningHintPresentation(work)}
        rest={null}
        series={{ count: 7, unit: "Diensttage", from: null, until: null }}
        missing
        originalDescription={work.description}
      >
        {null}
      </PlanningHintDetails>,
    );
    expect(screen.queryByText("Dienstbeginn-Tage")).toBeNull();
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).toBeNull();
    expect(screen.getByText("Einige zugehörige Dienste sind nicht mehr verfügbar.")).toBeVisible();
  });
  it("preserves additional unstructured legacy information", async () => {
    const hint = {
      ...planningHintPresentation({ ...work, rule: "LEGACY", facts: undefined }),
      explanation: "Frühere Einordnung",
    };
    const screen = await render(
      <PlanningHintDetails
        hint={hint}
        rest={null}
        series={null}
        missing={false}
        originalDescription="Erhaltene Zusatzangabe"
      >
        {null}
      </PlanningHintDetails>,
    );
    expect(screen.queryByText("Erhaltene Zusatzangabe")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Weitere Angaben", expanded: false }));
    expect(screen.getByText("Erhaltene Zusatzangabe")).toBeVisible();
    expect(screen.getByText("Frühere Einordnung")).toBeVisible();
    expect(screen.queryByText("Weitere Angaben zum Prüfpunkt")).toBeNull();
  });
});
