import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Alert, Platform } from "react-native";
import type { ReactNode } from "react";
import { ReportExportButton } from "./report-export-button";
import type { ReportInput } from "./report-data";
import type { ReportDocument, ReportOptions } from "./report-document";
import { ReportExportError } from "./report-export-error";

const mockShare =
  jest.fn<(report: ReportDocument, format: string, options: ReportOptions) => Promise<void>>();
const mockBuild = jest.fn<(input: ReportInput) => void>();
const mockLoadNetTimeline = jest.fn<() => Promise<readonly unknown[]>>().mockResolvedValue([]);
let mockReady = true;
let mockYouth: boolean | null = false;
let mockSchedule: (() => void) | null = null;
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadNetPayProfileTimeline: () => mockLoadNetTimeline(),
}));
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftStatus: () => ({ ready: mockReady, error: null }),
  usePflegeShiftEntries: () => ({ entries: [] }),
  usePflegeShiftProfile: () => ({ profile: { timeZone: "Europe/Berlin" } }),
  usePflegeShiftTariff: () => ({ tariffDecisions: [], workPatternSettings: {} }),
  usePflegeShiftTestData: () => ({ testMonths: [] }),
}));
jest.mock("@/application/rule-catalog-runtime-provider", () => ({
  useRuleCatalogRuntime: () => ({ resolver: {} }),
}));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ youthEnabled: mockYouth }),
}));
jest.mock("./share-report", () => ({
  shareReport: (report: ReportDocument, format: string, options: ReportOptions) =>
    mockShare(report, format, options),
}));
jest.mock("./report-data", () => ({
  buildReportSteps: function* (input: ReportInput) {
    mockBuild(input);
    yield;
    return { period: input.period, createdAt: input.createdAt, rows: [], entries: [] };
  },
}));
jest.mock("@/ui/selection-sheet", () => ({
  SelectionSheet: ({
    visible,
    children,
    onClose,
  }: {
    visible: boolean;
    children: (dismiss: () => void) => ReactNode;
    onClose: () => void;
  }) => (visible ? children(onClose) : null),
}));
jest.mock("@/ui/schedule-idle-work", () => ({
  scheduleIdleWork: (work: () => void) => {
    mockSchedule = work;
    return () => {
      mockSchedule = null;
    };
  },
}));

describe("Exportbedienung", () => {
  beforeEach(() => {
    mockReady = true;
    mockYouth = false;
    mockSchedule = null;
    mockShare.mockResolvedValue(undefined);
    mockLoadNetTimeline.mockResolvedValue([]);
    jest.replaceProperty(Platform, "OS", "ios");
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  it("öffnet PDF mit Standard und Gehalt vorausgewählt und übernimmt die Auswahl", async () => {
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Gehaltsprognose einfügen" })).toBeChecked();
    await fireEvent.press(screen.getByRole("radio", { name: "Kompakt" }));
    await fireEvent.press(screen.getByRole("switch", { name: "Gehaltsprognose einfügen" }));
    await fireEvent.press(screen.getByRole("button", { name: "PDF erstellen und teilen" }));
    expect(mockLoadNetTimeline).not.toHaveBeenCalled();
    await act(async () => {
      mockSchedule?.();
    });
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-08" }), "PDF", {
      layout: "compact",
      includeSalary: false,
    });
  });
  it("öffnet den bestehenden Exportablauf über die Kopfleistenaktion", async () => {
    const screen = await render(<ReportExportButton period="2026-08" variant="icon" />);
    expect(screen.queryByText(/Monatsbericht als PDF/)).toBeNull();
    const action = screen.getByRole("button", { name: "Bericht exportieren" });
    expect(action.props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(action);
    await fireEvent.press(screen.getByRole("radio", { name: "CSV" }));
    await fireEvent.press(screen.getByRole("button", { name: "CSV erstellen und teilen" }));
    await act(async () => {
      mockSchedule?.();
    });
    expect(mockShare).toHaveBeenCalledWith(
      expect.objectContaining({ period: "2026-08" }),
      "CSV",
      expect.any(Object),
    );
  });
  it("exportiert CSV ohne Gehaltsangaben und blockiert doppelte Exporte", async () => {
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await fireEvent.press(screen.getByRole("radio", { name: "CSV" }));
    expect(screen.queryByText("Berichtsumfang")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "CSV erstellen und teilen" }));
    expect(screen.getByRole("button", { name: "Bericht wird erstellt …" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Bericht wird erstellt …" }));
    await act(async () => {
      mockSchedule?.();
    });
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-08" }), "CSV", {
      layout: "standard",
      includeSalary: true,
    });
    expect(mockLoadNetTimeline).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Bericht exportieren" })).toBeEnabled(),
    );
  });
  it("exportiert das gewählte Jahr mit den gespeicherten Netto-Grundlagen", async () => {
    const screen = await render(<ReportExportButton period="2026" />);
    expect(screen.getByText(/Jahresbericht als PDF/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    expect(screen.getByText(/zwölf Monatszeilen/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "PDF erstellen und teilen" }));
    await act(async () => {
      mockSchedule?.();
    });
    expect(mockLoadNetTimeline).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ period: "2026" }), "PDF", {
      layout: "standard",
      includeSalary: true,
    });
  });
  it("wartet auf Daten und Prüfungseinstellungen", async () => {
    mockReady = false;
    const screen = await render(<ReportExportButton period="2026-08" />);
    expect(screen.getByRole("button")).toBeDisabled();
    mockReady = true;
    mockYouth = null;
    await screen.rerender(<ReportExportButton period="2026-08" />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
  it("teilt nach dem Verlassen der Ansicht keinen Bericht", async () => {
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await fireEvent.press(screen.getByRole("button", { name: "PDF erstellen und teilen" }));
    await screen.unmount();
    expect(mockSchedule).toBeNull();
    expect(mockShare).not.toHaveBeenCalled();
  });
  it("zeigt verständliche Fehler und erlaubt einen erneuten Versuch", async () => {
    mockShare.mockRejectedValue(new Error("private path"));
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await fireEvent.press(screen.getByRole("button", { name: "PDF erstellen und teilen" }));
    await act(async () => {
      mockSchedule?.();
    });
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith("Export nicht möglich", expect.any(String)),
    );
    expect(screen.getByRole("button")).toBeEnabled();
    expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toContain("private path");
  });
  it("zeigt die sichere PDF-Fehlerphase statt ausschließlich der allgemeinen Meldung", async () => {
    mockShare.mockRejectedValue(new ReportExportError("iOS hat keine gültige PDF-Datei erstellt."));
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await fireEvent.press(screen.getByRole("button", { name: "PDF erstellen und teilen" }));
    await act(async () => {
      mockSchedule?.();
    });
    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Export nicht möglich",
      "iOS hat keine gültige PDF-Datei erstellt.",
    );
  });
  it("verhindert ein PDF mit Gehalt wenn die gespeicherten Netto-Angaben nicht lesbar sind", async () => {
    mockLoadNetTimeline.mockRejectedValue(new Error("private database path"));
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await fireEvent.press(screen.getByRole("button", { name: "PDF erstellen und teilen" }));
    expect(mockShare).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith("Export nicht möglich", expect.any(String));
    expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toContain(
      "private database path",
    );
  });
});
