import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Share, Platform } from "react-native";
import { shareReport } from "./share-report.native";
import type { ReportDocument } from "./report-document";

const mockFiles = new Map<string, string>();
const mockPrint = jest.fn<() => Promise<{ uri: string; numberOfPages: number }>>();
let mockWriteFailure = false;
let mockMoveFailure = false;
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
jest.mock("expo-print", () => ({ printToFileAsync: () => mockPrint() }));
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache/" } },
  File: class {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = (typeof parent === "string" ? parent : parent.uri) + (name ?? "");
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    create() {
      mockFiles.set(this.uri, "");
    }
    write(text: string) {
      if (mockWriteFailure) throw new Error("write");
      mockFiles.set(this.uri, text);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    move(target: { uri: string }) {
      if (mockMoveFailure) throw new Error("move");
      mockFiles.set(target.uri, mockFiles.get(this.uri) ?? "");
      mockFiles.delete(this.uri);
      this.uri = target.uri;
    }
  },
}));
const report: ReportDocument = {
  period: "2026-08",
  createdAt: "2026-08-15",
  rows: [
    {
      section: "Notizen",
      period: "2026-08",
      record: "Dienst",
      field: "note",
      label: "Notiz",
      value: "Übergabe",
      unit: "",
    },
  ],
};
describe("lokaler Berichtsexport", () => {
  beforeEach(() => {
    mockFiles.clear();
    mockWriteFailure = false;
    mockMoveFailure = false;
    jest.replaceProperty(Platform, "OS", "ios");
    mockPrint.mockImplementation(async () => {
      mockFiles.set("file:///cache/printed.pdf", "PDF");
      return { uri: "file:///cache/printed.pdf", numberOfPages: 1 };
    });
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
  });
  it("hält die CSV bis zum Ende des Teilen-Dialogs und entfernt sie danach", async () => {
    let finish: (() => void) | undefined;
    jest.spyOn(Share, "share").mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { action: Share.sharedAction };
    });
    const exportPromise = shareReport(report, "CSV");
    expect(mockFiles.get("file:///cache/LUNA-Shift-Bericht-2026-08-uuid.csv")).toContain(
      "Übergabe",
    );
    expect(Share.share).toHaveBeenCalledWith(
      { url: "file:///cache/LUNA-Shift-Bericht-2026-08-uuid.csv" },
      { subject: "LUNA Shift Bericht 2026-08" },
    );
    finish?.();
    await exportPromise;
    expect(mockFiles.size).toBe(0);
  });
  it("räumt auch bei abgebrochenem Teilen auf", async () => {
    jest.spyOn(Share, "share").mockResolvedValue({ action: Share.dismissedAction });
    await shareReport(report, "CSV");
    expect(mockFiles.size).toBe(0);
  });
  it("räumt bei Schreibfehlern auf", async () => {
    mockWriteFailure = true;
    await expect(shareReport(report, "CSV")).rejects.toThrow("write");
    expect(Share.share).not.toHaveBeenCalled();
    expect(mockFiles.size).toBe(0);
  });
  it("teilt ein benanntes PDF und räumt sämtliche temporären Dateien auf", async () => {
    await shareReport(report, "PDF");
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(Share.share).toHaveBeenCalledWith(
      { url: "file:///cache/LUNA-Shift-Bericht-2026-08-uuid.pdf" },
      { subject: "LUNA Shift Bericht 2026-08" },
    );
    expect(mockFiles.size).toBe(0);
  });
  it("entfernt das gerenderte PDF, wenn die Umbenennung fehlschlägt", async () => {
    mockMoveFailure = true;
    await expect(shareReport(report, "PDF")).rejects.toThrow("move");
    expect(mockFiles.size).toBe(0);
    expect(Share.share).not.toHaveBeenCalled();
  });
  it("entfernt das PDF, wenn Teilen fehlschlägt", async () => {
    jest.spyOn(Share, "share").mockRejectedValue(new Error("share"));
    await expect(shareReport(report, "PDF")).rejects.toThrow("share");
    expect(mockFiles.size).toBe(0);
  });
  it("beendet Fehler des PDF-Moduls ohne leere Dateien zu teilen", async () => {
    mockPrint.mockRejectedValue(new Error("native module"));
    await expect(shareReport(report, "PDF")).rejects.toThrow("native module");
    expect(mockFiles.size).toBe(0);
    expect(Share.share).not.toHaveBeenCalled();
  });
  it("blockiert Plattformen außerhalb des freigegebenen iPhone-Scopes", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await expect(shareReport(report, "CSV")).rejects.toThrow("iPhone");
    expect(mockFiles.size).toBe(0);
  });
});
