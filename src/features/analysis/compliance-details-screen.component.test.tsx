import { render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";

import type { MonthlyComplianceResult } from "@/domain/types";
import { ComplianceDetailsScreen } from "@/features/analysis/compliance-details-screen";

const mockCompliance: MonthlyComplianceResult = {
  month: "2026-08",
  criticalCount: 2,
  warningCount: 1,
  infoCount: 0,
  affectedDates: [],
  issues: [0, 1, 2].map((index) => ({
    id: String(index),
    kind: index === 2 ? "PLANNING" : "LEGAL",
    severity: index === 2 ? "warning" : "critical",
    rule: "TEST",
    title: "Hinweis",
    description: "Test",
    date: "2026-08-01",
    relatedShiftIds: [],
  })),
};
let mockPlanning = true;
let mockResult: MonthlyComplianceResult | null = mockCompliance;
let mockArea: string | undefined;
let mockWorkplaceCount = 0;
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ enabled: mockPlanning, error: null }),
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ month: "2026-08", area: mockArea }),
}));

jest.mock("@/features/workplace/panel", () => {
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    WorkplacePanel: ({ children }: { children?: (count: number) => ReactNode }) => (
      <>
        {children?.(mockWorkplaceCount)}
        {mockWorkplaceCount > 0 ? <Text>Betrieblicher Testhinweis</Text> : null}
      </>
    ),
  };
});

jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftProfile: () => ({
    profile: {
      federalState: "NW",
      weeklyMinutes: 2_400,
      timeZone: "Europe/Berlin",
      tariff: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  }),
  usePflegeShiftStatus: () => ({ error: null, ready: true, reload: jest.fn() }),
}));

jest.mock("@/application/rule-catalog-runtime-provider", () => {
  const { bundledRuleResolver } =
    jest.requireActual<typeof import("@/rules/rule-resolver")>("@/rules/rule-resolver");
  return { useRuleCatalogRuntime: () => ({ resolver: bundledRuleResolver }) };
});

jest.mock("@/features/analysis/use-monthly-compliance", () => ({
  useDeferredMonthlyCompliance: () => ({
    error: null,
    result: mockResult,
    retry: jest.fn(),
  }),
}));

describe("ComplianceDetailsScreen", () => {
  beforeEach(() => {
    mockPlanning = true;
    mockResult = mockCompliance;
    mockArea = undefined;
    mockWorkplaceCount = 0;
  });

  it.each([
    ["legal", true, false, false],
    ["planning", false, true, false],
    ["workplace", false, false, true],
    ["unknown", true, true, true],
  ])("limits the detail list to %s when available", async (area, legal, planning, workplace) => {
    mockArea = area;
    mockWorkplaceCount = 1;
    const screen = await render(<ComplianceDetailsScreen />);
    expect(Boolean(screen.queryByRole("header", { name: "Gesetz & Tarif" }))).toBe(legal);
    expect(Boolean(screen.queryByRole("header", { name: "Hinweise & Empfehlungen" }))).toBe(
      planning,
    );
    expect(Boolean(screen.queryByText("Betrieblicher Testhinweis"))).toBe(workplace);
    expect(screen.queryByRole("button", { name: "Prüfungs-Dino" })).toBeNull();
  });

  it("falls back to the available findings when the selected area is hidden", async () => {
    mockArea = "planning";
    mockPlanning = false;
    const screen = await render(<ComplianceDetailsScreen />);
    expect(screen.getByRole("header", { name: "Gesetz & Tarif" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Prüfungs-Dino" })).toBeNull();
  });
  it("filters the detail summary but keeps legal critical findings", async () => {
    mockPlanning = false;
    const screen = await render(<ComplianceDetailsScreen />);
    expect(screen.queryByRole("header", { name: /Meldungen/ })).toBeNull();
    expect(screen.queryByText("Hinweise & Empfehlungen")).toBeNull();
    expect(screen.queryByText(/Planungshinweise ausgeblendet/)).toBeNull();
  });
  it("shows the exact month and two inbox sections", async () => {
    const screen = await render(<ComplianceDetailsScreen />);

    expect(screen.queryByRole("header", { name: /Meldungen/ })).toBeNull();
    expect(screen.queryByText("0 Hinweise")).toBeNull();
    expect(screen.getByRole("header", { name: "Gesetz & Tarif" })).toBeVisible();
    expect(screen.getByText(/1\.?.*31\. August 2026/)).toBeVisible();
    expect(screen.getByRole("header", { name: "Hinweise & Empfehlungen" })).toBeVisible();
  });

  it("shows a single quiet legal status for a planning-only result", async () => {
    mockResult = {
      ...mockCompliance,
      issues: mockCompliance.issues.filter((issue) => issue.kind === "PLANNING"),
    };
    const screen = await render(<ComplianceDetailsScreen />);
    expect(screen.queryByRole("header", { name: "1 Meldung" })).toBeNull();
    expect(screen.queryByRole("header", { name: "Gesetz & Tarif" })).toBeNull();
    expect(screen.getByRole("header", { name: "Hinweise & Empfehlungen" })).toBeVisible();
  });

  it("keeps explanations behind one details action without a general info section", async () => {
    const screen = await render(<ComplianceDetailsScreen />);
    expect(screen.queryByText("Über die Prüfung")).toBeNull();
    expect(screen.queryByText(/keine Rechtsberatung/)).toBeNull();
    expect(screen.queryByText("Warum dieser Hinweis?")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Details ansehen:/ })).toHaveLength(3);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Zurück zur Auswertung" })).toBeVisible();
  });

  it("does not announce a clear check before the calculation has completed", async () => {
    mockResult = null;
    const screen = await render(<ComplianceDetailsScreen />);
    expect(screen.queryByText("Keine Meldungen")).toBeNull();
    expect(screen.queryByText("Keine Auffälligkeiten")).toBeNull();
    expect(screen.queryByText("Keine Auffälligkeiten in den unterstützten Prüfungen.")).toBeNull();
    expect(screen.queryByText("Keine sichtbaren Auffälligkeiten")).toBeNull();
    expect(screen.queryByRole("button", { name: "Prüfungs-Dino" })).toBeNull();
    mockResult = { ...mockCompliance, issues: [] };
    await screen.rerender(<ComplianceDetailsScreen />);
    expect(screen.getByRole("button", { name: "Prüfungs-Dino" })).toBeVisible();
  });
});
