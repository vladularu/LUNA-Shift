import { fireEvent, render, within } from "@testing-library/react-native";
import { describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import type { ComplianceIssue } from "@/domain/types";
import { TARIFF_SCOPE_SOURCE } from "@/domain/tariff-time-policy";
import { CheckPrerequisitesCard } from "./check-prerequisites-card";
import { tariffCheckPresentation } from "./tariff-check-presentation";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual<{ default: object }>("react-native-safe-area-context/jest/mock").default,
);

const work: ComplianceIssue = {
  id: "work",
  date: "2026-11-01",
  rule: "ARBZG_DATA_ALL_EMPLOYMENT",
  kind: "LEGAL",
  severity: "warning",
  title: "Arbeitszeiten aus allen Jobs erfasst?",
  description:
    "Für eine vollständige Prüfung müssen die Arbeitszeiten aus allen Jobs erfasst sein.",
  relatedShiftIds: [],
};
const scope: ComplianceIssue = {
  ...work,
  id: "scope",
  rule: "SPECIAL_DUTY_REVIEW",
  severity: "info",
  title: "Prüfumfang Bereitschaften",
  description: "Besondere Voraussetzungen sind nicht abschließend geprüft.",
};
const tariff: ComplianceIssue = {
  ...work,
  id: "tariff",
  rule: "TARIFF_SCOPE",
  title: "Tarifgrundlage prüfen",
  description: "Der persönliche Tarifbereich ist noch nicht ausreichend belegt.",
  tariff: {
    tariffLabel: "TVöD · BT-K",
    ruleId: "TARIFF_SCOPE",
    status: "UNAVAILABLE",
    period: { from: "2026-11-01", until: "2026-11-30" },
    source: TARIFF_SCOPE_SOURCE,
    ruleText: "Der persönliche Geltungsbereich ist offen.",
    requirements: ["Den hinterlegten Tarifbereich bestätigen."],
  },
};

describe("compact check status", () => {
  it("describes an unavailable tariff as a scope limit without pretending an editable input is missing", async () => {
    const screen = await render(<CheckPrerequisitesCard issues={[tariff]} />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Prüfstatus: Tarifprüfung eingeschränkt" }),
    );
    expect(screen.queryByText(/Angabe offen/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
  });
  it("does not turn a pending observation into a missing profile input", async () => {
    const pending = { ...tariff, tariff: { ...tariff.tariff!, status: "PENDING" as const } };
    const screen = await render(<CheckPrerequisitesCard issues={[pending]} />);
    await fireEvent.press(screen.getByRole("button", { name: /^Prüfstatus:/ }));
    expect(screen.queryByText(/Angabe offen/)).toBeNull();
    expect(screen.queryByText("Prüfung eingeschränkt")).toBeNull();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
  });
  it("shows the same real missing input only once and offers its concrete profile question", async () => {
    const screen = await render(
      <CheckPrerequisitesCard issues={[work, { ...work, id: "work-again", date: "2026-11-20" }]} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Prüfstatus: 1 Angabe offen" }));
    expect(screen.getAllByText(work.description)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Angaben ergänzen" })).toBeVisible();
  });
  it("keeps unfamiliar prerequisites reachable without a generic nonfunctional profile action", async () => {
    const unfamiliar = { ...work, rule: "UNKNOWN_PREREQUISITE" };
    const screen = await render(<CheckPrerequisitesCard issues={[unfamiliar]} />);
    await fireEvent.press(screen.getByRole("button", { name: /^Prüfstatus:/ }));
    expect(screen.getByText(unfamiliar.description)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
  });
  it("combines missing inputs and restricted scope in one initially compact status", async () => {
    const screen = await render(<CheckPrerequisitesCard issues={[work]} scopeIssues={[scope]} />);
    const button = screen.getByRole("button", {
      name: "Prüfstatus: 1 Angabe offen · Prüfumfang eingeschränkt",
      expanded: false,
    });
    expect(button).toHaveStyle({ minHeight: 44 });
    expect(screen.getByText("Prüfstatus")).toBeVisible();
    expect(screen.queryByText(work.description)).toBeNull();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
    expect(screen.queryByTestId("check-scope-details")).toBeNull();

    await fireEvent.press(button);
    const details = screen.getByTestId("check-status-details");
    expect(within(details).getByText("Prüfung eingeschränkt")).toBeVisible();
    expect(within(details).getByText(work.description)).toBeVisible();
    expect(within(details).queryByTestId("check-scope-details")).toBeNull();
    await fireEvent.press(
      within(details).getByRole("button", { name: "Prüfgrenzen", expanded: false }),
    );
    expect(within(details).getByTestId("check-scope-details")).toBeVisible();
    await fireEvent.press(within(details).getByRole("button", { name: "Angaben ergänzen" }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/check-profile",
      params: { questions: "work" },
    });
    expect(screen.queryByTestId("check-status-details")).toBeNull();
  });

  it("explains readiness limits without asking for irrelevant profile inputs", async () => {
    const screen = await render(<CheckPrerequisitesCard issues={[]} scopeIssues={[scope]} />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Prüfstatus: Prüfumfang eingeschränkt" }),
    );
    expect(
      screen.queryByText(/Besondere Voraussetzungen und Ausnahmen für Bereitschaften/),
    ).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Prüfgrenzen", expanded: false }));
    expect(
      screen.getByText(/Besondere Voraussetzungen und Ausnahmen für Bereitschaften/),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
  });

  it("retains unavailable tariff explanations and their source inside the same status sheet", async () => {
    const screen = await render(<CheckPrerequisitesCard issues={[tariff]} />);
    expect(screen.queryByText(tariff.title)).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Prüfstatus: Tarifprüfung eingeschränkt" }),
    );
    const presentation = tariffCheckPresentation(tariff.tariff!, tariff.title, tariff.description);
    await fireEvent.press(
      screen.getByRole("button", { name: `Details ansehen: ${presentation.title}` }),
    );
    expect(screen.getByText("Details zur Tarifprüfung")).toBeVisible();
    expect(screen.getByText(presentation.summary)).toBeVisible();
    expect(screen.queryByText(tariff.tariff!.requirements[0])).toBeNull();
    expect(screen.queryByRole("link", { name: TARIFF_SCOPE_SOURCE.title })).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Quelle & Berechnung", expanded: false }),
    );
    expect(screen.getByRole("link", { name: TARIFF_SCOPE_SOURCE.title })).toBeVisible();
    await fireEvent.press(screen.getByRole("button", { name: "Zurück zum Prüfstatus" }));
    expect(screen.getByTestId("check-status-details")).toBeVisible();
  });

  it("supports aggregate yearly limitations without pretending to have individual findings", async () => {
    const screen = await render(
      <CheckPrerequisitesCard
        aggregatePrerequisiteCount={3}
        aggregateTariffCount={2}
        aggregateScopeCount={1}
      />,
    );
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Prüfstatus: 1 Angabe offen · Tarifprüfung eingeschränkt · Prüfumfang eingeschränkt",
      }),
    );
    expect(screen.getByText("Tarifgrundlagen unvollständig")).toBeVisible();
    expect(screen.getByText("Einzelheiten findest du in den Monatsprüfungen.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Prüfgrenzen", expanded: false }));
    expect(screen.getByTestId("check-scope-details")).toBeVisible();
  });

  it("renders no empty status card when neither limitations nor inputs are pending", async () => {
    const screen = await render(<CheckPrerequisitesCard issues={[]} scopeIssues={[]} />);
    expect(screen.queryByText("Prüfstatus")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
