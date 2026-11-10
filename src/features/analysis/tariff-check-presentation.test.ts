import { describe, expect, it } from "vitest";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import { TARIFF_SCOPE_SOURCE, TARIFF_TIME_POLICIES } from "@/domain/tariff-time-policy";
import { tariffCheckPresentation } from "./tariff-check-presentation";

const evidence = (change: Partial<TariffComplianceEvidence> = {}): TariffComplianceEvidence => ({
  tariffLabel: "TVöD · BT-K",
  ruleId: "TARIFF_FREE_SUNDAY",
  status: "REVIEW",
  period: { from: "2026-11-23", until: "2026-12-06" },
  source: TARIFF_TIME_POLICIES.TVOED_K.freeSource!,
  ruleText:
    "Bei regelmäßiger Sonn- und Feiertagsarbeit soll einer der freien Tage auf einen Sonntag fallen.",
  count: 2,
  recordedDates: ["2026-11-29", "2026-12-06"],
  requirements: [
    "Bestätige den Geltungsbereich.",
    "Die Zuordnung des Bezugszeitraums ist zu bestätigen.",
  ],
  ...change,
});

describe("plain tariff check presentation", () => {
  it("names the Sunday observation while keeping the Soll rule and unknown fortnight honest", () => {
    const source = evidence(),
      before = JSON.stringify(source);
    const copy = tariffCheckPresentation(source, "Alter Titel", "Interne Zuordnung");
    expect(copy.title).toBe("2 Sonntage hintereinander mit Dienst");
    expect(copy.summary).toContain("soll");
    expect(copy.limitation).toContain("gezeigten zwei Wochen");
    expect(copy.limitation).toContain("abweichender betrieblicher Bezugszeitraum");
    expect(copy.constraints.join(" ")).not.toMatch(/nicht hinterlegt|nicht sicher erkennen/);
    expect(copy.status).toBe("observation");
    expect(JSON.stringify(source)).toBe(before);
  });
  it("names recorded week dates without alleging a violation", () => {
    const copy = tariffCheckPresentation(
      evidence({ ruleId: "TARIFF_WEEK_DAYS", count: 7 }),
      "Alt",
      "Alt",
    );
    expect(copy.title).toBe("7 Diensttage in einer Kalenderwoche");
    expect(copy.summary).toContain("fünf Arbeitstage");
    expect(copy.summary).toContain("auch sechs");
    expect(copy.limitation).toContain("Startdatum");
    expect(copy.limitation).toContain("setzt die betrieblichen Gründe");
    expect(`${copy.title} ${copy.summary} ${copy.limitation}`).not.toMatch(
      /Verstoß|unzulässig|verboten/,
    );
  });
  it.each(["REVIEW", "DEVIATION"] as const)(
    "keeps %s as a tariff observation rather than a legal verdict",
    (status) => {
      const copy = tariffCheckPresentation(evidence({ status }), "Alt", "Alt");
      expect(copy.status).toBe(status === "DEVIATION" ? "deviation" : "observation");
      expect(copy.summary).not.toMatch(/Verstoß|rechtswidrig/);
    },
  );
  it("distinguishes a planned or still running period from missing tariff data", () => {
    const planned = tariffCheckPresentation(evidence({ status: "PENDING" }), "Alt", "Alt");
    const unavailable = tariffCheckPresentation(
      evidence({ status: "UNAVAILABLE", source: TARIFF_SCOPE_SOURCE }),
      "Alt",
      "Alt",
    );
    expect(planned.status).toBe("planned");
    expect(planned.summary).toBe(tariffCheckPresentation(evidence(), "Alt", "Alt").summary);
    expect(planned.summary).toContain("soll");
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.title).toBe("Tarifprüfung eingeschränkt");
    expect(unavailable.summary).toContain("Angaben reichen");
  });
  it("retains the TV-H scope and amendment limitations as explanations rather than tasks", () => {
    const copy = tariffCheckPresentation(
      evidence({
        source: TARIFF_TIME_POLICIES.TVH_KR.freeSource!,
        requirements: [
          "Die Zuordnung zum Krankenpflegedienst im Justizvollzug und der abschließende ÄTV-25-Abgleich bleiben zu prüfen.",
        ],
      }),
      "Alt",
      "Alt",
    );
    expect(copy.constraints.join(" ")).toContain("Justizvollzug");
    expect(copy.constraints.join(" ")).toContain("Tarifänderungen");
  });
  it.each([0, -1, 99, Number.NaN])("does not manufacture a work-week count from %s", (count) => {
    const copy = tariffCheckPresentation(
      evidence({ ruleId: "TARIFF_WEEK_DAYS", count }),
      "Tagesverteilung",
      "Originalbeobachtung",
    );
    expect(copy.title).toBe("Tagesverteilung");
  });
  it("preserves an unknown original observation in the closed detail material", () => {
    const copy = tariffCheckPresentation(
      evidence({ ruleId: "UNKNOWN" }),
      "Unbekannter Tarifpunkt",
      "Unveränderte Originalbeobachtung",
    );
    expect(copy.title).toBe("Unbekannter Tarifpunkt");
    expect(copy.originalDescription).toBe("Unveränderte Originalbeobachtung");
  });
  it("retains unmapped original conditions in order without turning them into new instructions", () => {
    const original = [
      "Einzigartige ältere Prüfbedingung A.",
      "Die Zuordnung des tariflichen Zweiwochen-Bezugszeitraums ist zu bestätigen; dieses Fenster ist ein Beobachtungszeitraum.",
      "Bestätige eine unbekannte ältere Bedingung B.",
    ];
    const copy = tariffCheckPresentation(
      evidence({ requirements: original }),
      "Alt",
      "Generische Originalbeobachtung",
    );
    expect(copy.originalRequirements).toEqual([original[0], original[2]]);
    expect(copy.limitation).toContain("gezeigten zwei Wochen");
    expect(copy.constraints.join(" ")).not.toContain("Welche zwei Wochen");
    expect(`${copy.summary} ${copy.limitation}`).not.toContain(original[2]);
    expect(original).toHaveLength(3);
  });
  it("does not mislabel missing LUNA review coverage as a missing tariff choice", () => {
    const coverage = tariffCheckPresentation(
      evidence({
        status: "UNAVAILABLE",
        period: { from: "2027-01-01", until: "2027-01-14" },
        requirements: [
          "Die Tarifregeln sind für diesen Zeitraum noch nicht in dieser Prüffassung geprüft.",
        ],
      }),
      "Alt",
      "Original zur Abdeckung",
    );
    const allocation = tariffCheckPresentation(
      evidence({
        status: "UNAVAILABLE",
        source: TARIFF_SCOPE_SOURCE,
        requirements: ["Die Tarifzuordnung ist für diesen Zeitraum nicht hinreichend bestimmt."],
      }),
      "Alt",
      "Original zur Zuordnung",
    );
    expect(coverage.title).toBe("Tarifprüfung eingeschränkt");
    expect(coverage.summary).toContain("LUNA noch nicht geprüft");
    expect(allocation.summary).toContain("Angaben reichen");
    expect(coverage.summary).not.toBe(allocation.summary);
    expect(coverage.originalDescription).toBe("Original zur Abdeckung");
  });
  it("translates mixed tariffs, training and excluded scope into readable statements", () => {
    const copy = tariffCheckPresentation(
      evidence({
        requirements: [
          "Ein Tarifwechsel innerhalb des Beobachtungszeitraums muss gesondert geprüft werden.",
          "Alter, Schulzeiten und der Beschäftigtentarif des Ausbildenden sind für die Ausbildungsprüfung zu bestätigen.",
          "Der Geltungsbereich wurde in den Arbeitszeitdaten ausgeschlossen; die Tarifzuordnung ist zu klären.",
        ],
      }),
      "Alt",
      "Original",
    );
    const text = copy.constraints.join(" ");
    expect(text).toContain("Tarifzuordnung");
    expect(text).toContain("Auszubildenden");
    expect(text).toContain("ausgeschlossen");
    expect(text).not.toMatch(/Bestätige|Prüfe|zu bestätigen|zu klären/);
    expect(copy.originalDescription).toBe("Original");
  });
  it("labels the TV-UK six-day threshold as a LUNA assumption rather than rewriting the tariff", () => {
    const copy = tariffCheckPresentation(
      evidence({ ruleId: "TARIFF_WEEK_DAYS", count: 7, source: TARIFF_TIME_POLICIES.TVUK.source }),
      "Alt",
      "Alt",
    );
    expect(copy.summary).toContain("durchschnittlich fünf Arbeitstage");
    expect(TARIFF_TIME_POLICIES.TVUK.ruleText).toContain("durchschnittlich");
  });
  it("keeps the TV-UK connected two-day block in the simple rule explanation", () => {
    const copy = tariffCheckPresentation(
      evidence({
        ruleId: "TARIFF_FREE_DAYS",
        count: 13,
        source: TARIFF_TIME_POLICIES.TVUK.freeSource!,
      }),
      "Alt",
      "Alt",
    );
    expect(copy.summary).toContain("zwei zusammenhängende freie Tage");
    expect(copy.title).toBe("13 Tage mit Dienst in zwei Wochen");
  });
  it.each(["REVIEW", "PENDING", "UNAVAILABLE", "DEVIATION"] as const)(
    "uses at most two short direct sentences without impossible confirmation tasks for %s",
    (status) => {
      const copy = tariffCheckPresentation(evidence({ status }), "Alt", "Alt");
      expect(copy.summary.length).toBeLessThan(160);
      expect(copy.limitation.length).toBeLessThan(180);
      expect(`${copy.summary} ${copy.limitation}`).not.toMatch(
        /Nicht beurteilbar|Einordnung prüfen|bestätig|Geltungsbereich.*prüf/i,
      );
      expect(copy.constraints.join(" ")).not.toMatch(/Bestätige|Prüfe|zu bestätigen/);
    },
  );
});
