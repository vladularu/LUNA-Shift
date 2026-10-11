import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Alert, Platform } from "react-native";
import { ReportExportButton } from "./report-export-button";
import type { ReportInput } from "./report-data";
import type { ReportDocument } from "./report-document";

const mockShare = jest.fn<(report: ReportDocument, format: string) => Promise<void>>();
const mockBuild = jest.fn<(input: ReportInput) => void>();
const mockLoadNetTimeline = jest.fn<() => Promise<readonly unknown[]>>().mockResolvedValue([]);
jest.mock("expo-sqlite", () => ({ useSQLiteContext: () => ({}) }));
jest.mock("@/infrastructure/database/net-pay-profile-repository", () => ({
  loadNetPayProfileTimeline: () => mockLoadNetTimeline(),
}));
let mockReady = true;
let mockYouth: boolean | null = false;
let mockSchedule: (() => void) | null = null;
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
  shareReport: (report: ReportDocument, format: string) => mockShare(report, format),
}));
jest.mock("./report-data", () => ({
  buildReportSteps: function* (input: ReportInput) {
    mockBuild(input);
    yield;
    return { period: input.period, createdAt: input.createdAt, rows: [] };
  },
}));
jest.mock("@/ui/schedule-idle-work", () => ({
  scheduleIdleWork: (work: () => void) => {
    mockSchedule = work;
    return () => {
      mockSchedule = null;
    };
  },
}));
function choose(format: string) {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const button = buttons?.find((item) => item.text === format);
  if (!button?.onPress) throw new Error("Format fehlt");
  button.onPress();
}
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
  it("bietet PDF und CSV für den gewählten Monat an und blockiert doppelte Exporte", async () => {
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await act(async () => {
      choose("CSV");
      choose("PDF");
    });
    expect(screen.getByRole("button", { name: "Bericht wird erstellt …" })).toBeDisabled();
    await act(async () => {
      mockSchedule?.();
    });
    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({ period: "2026-08", youthProtection: false, netPayTimeline: [] }),
    );
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-08" }), "CSV");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Bericht exportieren" })).toBeEnabled(),
    );
  });
  it("exportiert das gewählte Jahr als PDF", async () => {
    const screen = await render(<ReportExportButton period="2026" />);
    expect(screen.getByText(/Vollständiger Jahresbericht/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Bericht exportieren" }));
    await act(async () => {
      choose("PDF");
    });
    await act(async () => {
      mockSchedule?.();
    });
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ period: "2026" }), "PDF");
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
    await fireEvent.press(screen.getByRole("button"));
    await act(async () => {
      choose("CSV");
    });
    await screen.unmount();
    expect(mockSchedule).toBeNull();
    expect(mockShare).not.toHaveBeenCalled();
  });
  it("zeigt verständliche Fehler und lässt einen erneuten Versuch zu", async () => {
    mockShare.mockRejectedValue(new Error("private path"));
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button"));
    await act(async () => {
      choose("CSV");
    });
    await act(async () => {
      mockSchedule?.();
    });
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith("Export nicht möglich", expect.any(String)),
    );
    expect(screen.getByRole("button")).toBeEnabled();
    expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toContain("private path");
  });
  it("verhindert einen unvollständigen Export wenn Netto-Angaben nicht lesbar sind", async () => {
    mockLoadNetTimeline.mockRejectedValue(new Error("private database path"));
    const screen = await render(<ReportExportButton period="2026-08" />);
    await fireEvent.press(screen.getByRole("button"));
    await act(async () => {
      choose("CSV");
    });
    expect(mockShare).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeEnabled();
    expect(Alert.alert).toHaveBeenLastCalledWith("Export nicht möglich", expect.any(String));
    expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls)).not.toContain(
      "private database path",
    );
  });
});
