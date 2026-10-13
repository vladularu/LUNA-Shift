import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { CalendarWidgetDiagnosticsCard } from "./calendar-widget-diagnostics-card";
import { inspectCalendarWidget, reloadCalendarWidget } from "./native-calendar-widget";

jest.mock("./native-calendar-widget", () => ({
  inspectCalendarWidget: jest.fn(),
  reloadCalendarWidget: jest.fn(),
}));
jest.mock("@/theme/palette", () => ({
  usePalette: () => ({ text: "black", textMuted: "gray", surface: "white" }),
}));
const inspect = jest.mocked(inspectCalendarWidget);
beforeEach(() => {
  inspect.mockResolvedValue({
    nativeAvailable: true,
    groupAvailable: true,
    entryCount: 15,
    currentState: "ready",
  });
});
describe("widget probe in the internal test lab", () => {
  it("only probes after a tap, shows readback and reloads on an explicit second action", async () => {
    const screen = await render(<CalendarWidgetDiagnosticsCard />);
    expect(inspect).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Widgets prüfen" }));
    await waitFor(() => expect(screen.getByText("Timeline-Einträge: 15")).toBeTruthy());
    expect(screen.getByText("Aktueller Zustand: bereit")).toBeTruthy();
    expect(screen.getByText("Datenformat: altes Kalenderdesign")).toBeTruthy();
    expect(reloadCalendarWidget).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Widgets neu laden" }));
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
    expect(reloadCalendarWidget).toHaveBeenCalledTimes(1);
  });
  it("does not offer a reload when no timeline was written", async () => {
    inspect.mockResolvedValue({
      nativeAvailable: true,
      groupAvailable: true,
      entryCount: 0,
      currentState: null,
    });
    const screen = await render(<CalendarWidgetDiagnosticsCard />);
    await fireEvent.press(screen.getByRole("button", { name: "Widgets prüfen" }));
    await waitFor(() => expect(screen.getByText("Timeline-Einträge: 0")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Widgets neu laden" })).toBeNull();
  });
  it("recovers its controls after an unexpected probe failure", async () => {
    inspect.mockRejectedValue(new Error("Private details"));
    const screen = await render(<CalendarWidgetDiagnosticsCard />);
    await fireEvent.press(screen.getByRole("button", { name: "Widgets prüfen" }));
    await waitFor(() =>
      expect(
        screen.getByText("Die Widget-Prüfung konnte nicht abgeschlossen werden."),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Widgets prüfen" })).toBeEnabled();
    expect(screen.queryByText("Private details")).toBeNull();
  });
});

it("shows the verified calendar metadata and distinguishes old ready timelines", async () => {
  inspect.mockResolvedValue({
    nativeAvailable: true,
    groupAvailable: true,
    entryCount: 15,
    currentState: "ready",
    dataFormat: "calendar",
    weekDayCount: 28,
    monthDayCount: 35,
    themeMode: "light",
    hasPhoto: true,
  });
  const screen = await render(<CalendarWidgetDiagnosticsCard />);
  await fireEvent.press(screen.getByRole("button", { name: "Widgets prüfen" }));
  await waitFor(() =>
    expect(screen.getByText("Datenformat: aktuelles Kalenderdesign")).toBeTruthy(),
  );
  expect(screen.getByText("Wochenraster: 28 Tage")).toBeTruthy();
  expect(screen.getByText("Darstellung: Hell")).toBeTruthy();
  expect(screen.getByText("Kalenderfoto: übernommen")).toBeTruthy();
});
