import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import type { ShiftEntry } from "@/domain/types";
import type { WorkplaceData } from "@/domain/workplace-rules";
import { NativeRouteHost } from "@/features/analysis/check-issue-route.test";
import { CheckListCard } from "@/features/analysis/dashboard-cards";
import { WorkplaceCheckSummary } from "./check-summary";
import { WorkplacePanel } from "./panel";
import { WorkplaceDatabase, WorkplaceDataContext } from "./store";
let mockEntries: ShiftEntry[] = [];
jest.mock("@/application/pflegeshift-provider", () => ({
  usePflegeShiftEntries: () => ({ entries: mockEntries }),
  usePflegeShiftProfile: () => ({ profile: { timeZone: "Europe/Berlin" } }),
}));
function setup(seed?: WorkplaceData) {
  let row: { value: string } | null = seed ? { value: JSON.stringify(seed) } : null;
  const db = {
    getFirstAsync: async () => row,
    execAsync: async () => {},
    runAsync: async (_sql: string, _key: string, value: string) => {
      row = { value };
    },
  } as unknown as SQLiteDatabase;
  return function renderPanel(period?: string) {
    return (
      <WorkplaceDatabase.Provider value={db}>
        <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
          <NativeRouteHost>
            {period && seed && (
              <WorkplaceDataContext.Provider value={seed}>
                <WorkplaceCheckSummary period={period}>
                  {(count) => (
                    <CheckListCard
                      workplaceCount={count}
                      counts={{ criticalCount: 0, warningCount: 0, infoCount: 0 }}
                      showPlanning={false}
                      onPress={() => {}}
                    />
                  )}
                </WorkplaceCheckSummary>
              </WorkplaceDataContext.Provider>
            )}
            <WorkplacePanel period={period} />
          </NativeRouteHost>
        </SafeAreaInsetsContext.Provider>
      </WorkplaceDatabase.Provider>
    );
  };
}

describe("Betriebsregeln beim ersten Dienstplan-Check", () => {
  it("uses a previously saved nine-hour agreement without another confirmation", async () => {
    const panel = setup({
      handled: true,
      exceptions: [],
      history: [
        {
          from: "0001-01-01",
          rules: {
            rest: {
              mode: "rest",
              source: "agreed",
              onRequest: false,
              minutes: 540,
              duty: "regular",
              basis: "",
              compensation: "",
            },
          },
        },
      ],
    });
    const s = await render(panel());
    await fireEvent.press(await s.findByText("Sonderregelungen in deinem Betrieb"));
    expect(await s.findByText("Mindestens 9 Stunden · Ausgleich offen")).toBeVisible();
    await fireEvent.press(s.getByText("Ruhezeit zwischen Diensten"));
    expect(s.queryByText(/Erlaubt eure Betriebs- oder Dienstvereinbarung/)).toBeNull();
    expect(s.getByText("Kennst du die Regel zum Ausgleich?")).toBeVisible();
    await fireEvent.press(s.getByText("Weitere Angaben (freiwillig)"));
    expect(s.getByText("Wo ist das vereinbart? (falls bekannt)")).toBeVisible();
    expect(s.queryByText("So wird die kürzere Ruhezeit ausgeglichen (falls bekannt)")).toBeNull();
    await fireEvent.press(s.getByText("Änderung speichern"));
    expect(await s.findByText("Mindestens 9 Stunden · Ausgleich offen")).toBeVisible();
    await fireEvent.press(s.getByText("Ruhezeit zwischen Diensten"));
    expect(s.getByRole("radio", { name: "Ja, das ist vereinbart", checked: true })).toBeTruthy();
  });
  it("opens an ordinary weekend finding from either check and returns to the list", async () => {
    mockEntries = ["2026-11-14", "2026-11-21"].map(
      (date) =>
        ({
          kind: "SHIFT",
          id: date,
          date,
          title: "Frühdienst",
          type: "EARLY",
          color: "#336699",
          symbol: "sun",
          startTime: "06:00",
          endTime: "14:00",
          breakMinutes: 30,
          revision: 1,
          deletedAt: null,
        }) as ShiftEntry,
    );
    try {
      const panel = setup({
        handled: true,
        exceptions: [],
        history: [
          {
            from: "2026-01-01",
            rules: {
              weekend: { mode: "alternate", anchor: null, onRequest: false, source: "agreed" },
            },
          },
        ],
      });
      for (const period of ["2026-11", "2026"]) {
        const s = await render(panel(period));
        expect(await s.findByLabelText("Betriebsregeln: 1 Hinweis")).toBeTruthy();
        expect(s.getByLabelText("Dienstplan-Check, 1 Meldung")).toBeTruthy();
        await fireEvent.press(await s.findByText("Zwei Wochenenden hintereinander mit Dienst"));
        expect(await s.findByText("Einordnung")).toBeVisible();
        expect(s.getByTestId("check-weekend-2026-11-14")).toBeVisible();
        expect(s.getByTestId("check-weekend-2026-11-21")).toBeVisible();
        expect(s.getAllByText("06:00–14:00")).toHaveLength(2);
        await fireEvent.press(s.getByText("Prüfgrundlage"));
        expect(s.getByText(/Deine Angabe unter/)).toBeVisible();
        await fireEvent.press(s.getByRole("button", { name: "Zurück" }));
        expect(s.queryByTestId("check-issue-scroll")).toBeNull();
        await s.unmount();
      }
    } finally {
      mockEntries = [];
    }
  });
  it("adjusts a weekly limit in whole days and disables the buttons at the bounds", async () => {
    const s = await render(setup()());
    await fireEvent.press(await s.findByText("Sonderregelungen in deinem Betrieb"));
    await fireEvent.press(s.getByText("Arbeitstage pro Woche"));
    await fireEvent.press(s.getByText("Feste Höchstzahl von Montag bis Sonntag"));
    await fireEvent.press(s.getByText("Weiter"));
    await fireEvent.press(s.getByLabelText("Anzahl erhöhen"));
    expect(s.getByDisplayValue("1")).toBeVisible();
    expect(s.getByLabelText("Anzahl verringern")).toBeDisabled();
    await fireEvent.changeText(s.getByLabelText("Anzahl Tage"), "6");
    await fireEvent.press(s.getByLabelText("Anzahl erhöhen"));
    expect(s.getByDisplayValue("7")).toBeVisible();
    expect(s.getByLabelText("Anzahl erhöhen")).toBeDisabled();
    await fireEvent.press(s.getByLabelText("Anzahl verringern"));
    expect(s.getByDisplayValue("6")).toBeVisible();
  });
  it("skips once and can later edit a single rule under Mehr", async () => {
    const panel = setup(),
      first = await render(panel("2026-11"));
    expect(await first.findByText("Welche Regeln gelten bei euch im Betrieb?")).toBeVisible();
    await fireEvent.press(first.getByText("Direkt zum Dienstplan-Check"));
    await waitFor(() => expect(first.queryByText("Fragen starten")).toBeNull());
    await first.unmount();
    const s = await render(panel("2026"));
    await s.rerender(panel());
    await fireEvent.press(await s.findByText("Sonderregelungen in deinem Betrieb"));
    for (const group of ["Dienstplanung", "Nachtarbeit", "Arbeits- und Ruhezeit"])
      expect(s.getByText(group)).toBeVisible();
    await fireEvent.press(s.getByText("Arbeitstage pro Woche"));
    await fireEvent.press(s.getByText("Beispiel aus der Pflege"));
    await fireEvent.press(await s.findByText("Beispiel als eigene Regel übernehmen"));
    await fireEvent.press(s.getByText("Ja, das ist vereinbart"));
    await fireEvent.press(s.getByText("Änderung speichern"));
    expect(await s.findByText("Ø 5 Tage über 4 Wochen")).toBeVisible();
    await fireEvent.press(s.getByText("Arbeitstage pro Woche"));
    expect(s.getByDisplayValue("5")).toBeVisible();
    expect(s.getByDisplayValue("4")).toBeVisible();
    await fireEvent.press(s.getByLabelText("Zurück"));
    expect(s.getAllByText("Noch offen")).toHaveLength(7);
  });
  it("offers short rest as an ordinary answer and requires no legal details", async () => {
    const s = await render(setup()());
    await fireEvent.press(await s.findByText("Sonderregelungen in deinem Betrieb"));
    await fireEvent.press(s.getByText("Ruhezeit zwischen Diensten"));
    await fireEvent.press(
      s.getByText("Krankenhaus oder Pflegeeinrichtung · verkürzt auf 10 Stunden mit Ausgleich"),
    );
    await fireEvent.press(s.getByText("Weiter"));
    expect(s.queryByText("Wo ist das vereinbart? (falls bekannt)")).toBeNull();
    await fireEvent.press(s.getByText("So wird bei uns üblicherweise geplant"));
    await fireEvent.press(s.getByText("Für den gesamten Zeitraum"));
    expect(s.queryByLabelText("Gültig ab")).toBeNull();
    await fireEvent.press(s.getByText("Änderung speichern"));
    expect(await s.findByText("Mindestens 10 Stunden")).toBeVisible();
    await fireEvent.press(s.getByText("Ruhezeit zwischen Diensten"));
    expect(s.getByRole("radio", { name: "Für den gesamten Zeitraum", checked: true })).toBeTruthy();
  });
  it("shows six topics, bypasses recovery for non-night workers and completes into the check", async () => {
    const panel = setup(),
      s = await render(panel("2026-11"));
    await fireEvent.press(await s.findByText("Fragen starten"));
    for (const option of ["Weiß ich nicht", "Keine feste Regel", "Weiß ich nicht"]) {
      await fireEvent.press(s.getByText(option));
      await fireEvent.press(s.getByText("Weiter"));
    }
    await fireEvent.press(s.getByText("Ich arbeite keine Nachtdienste"));
    await fireEvent.press(s.getByText("Weiter"));
    await fireEvent.press(s.getByText("So wird bei uns üblicherweise geplant"));
    await fireEvent.press(s.getByText("Weiter"));
    expect(await s.findByText("Thema 5 von 6 · Ruhezeit zwischen Diensten")).toBeVisible();
    for (const option of ["Keine betriebliche Sonderregel", "Weiß ich nicht"]) {
      await fireEvent.press(s.getByText(option));
      await fireEvent.press(s.getByText("Weiter"));
    }
    await fireEvent.press(s.getByText("Weiß ich nicht"));
    await fireEvent.press(s.getByText("Zum Dienstplan-Check"));
    await waitFor(() => expect(s.queryByText("Fragen starten")).toBeNull());
    expect(s.queryByText("Sonderregelungen in deinem Betrieb")).toBeNull();
  });
});
