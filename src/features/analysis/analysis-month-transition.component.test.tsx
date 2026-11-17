import { expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { AnalysisMonthTransition } from "./analysis-month-transition";

const page = (month: string, ready: boolean, available = true, value = month) => (
  <AnalysisMonthTransition
    month={month}
    ready={ready}
    available={available}
    header={(visible) => <Text>{`Monat ${visible}`}</Text>}
  >
    <Text>{`Werte ${value}`}</Text>
  </AnalysisMonthTransition>
);

it("reports the visible month to a fixed header while retaining pending values", async () => {
  const visible = jest.fn();
  const content = (month: string, ready: boolean) => (
    <AnalysisMonthTransition
      month={month}
      ready={ready}
      available={ready}
      onVisibleMonthChange={visible}
    >
      <Text>{`Werte ${month}`}</Text>
    </AnalysisMonthTransition>
  );
  const screen = await render(content("2026-12", true));
  expect(visible).toHaveBeenLastCalledWith("2026-12");
  await screen.rerender(content("2027-01", false));
  expect(visible).toHaveBeenLastCalledWith("2026-12");
  expect(screen.getByText("Werte 2026-12")).toBeTruthy();
  await screen.rerender(content("2027-01", true));
  expect(visible).toHaveBeenLastCalledWith("2027-01");
  expect(screen.getByText("Werte 2027-01")).toBeTruthy();
});

it("keeps the old header and values together until the requested month has finished loading", async () => {
  const screen = await render(page("2026-12", true));
  await screen.rerender(page("2027-01", false, false, "pending"));
  expect(screen.getByText("Monat 2026-12")).toBeTruthy();
  expect(screen.getByText("Werte 2026-12")).toBeTruthy();
  expect(screen.queryByText("Monat 2027-01")).toBeNull();
  expect(screen.queryByText("Werte pending")).toBeNull();
  await screen.rerender(page("2027-01", true));
  expect(screen.getByText("Monat 2027-01")).toBeTruthy();
  expect(screen.getByText("Werte 2027-01")).toBeTruthy();
  expect(screen.queryByText("Werte 2026-12")).toBeNull();
});

it("uses the latest requested month after quick consecutive navigation and still exposes explicit failures", async () => {
  const screen = await render(page("2026-10", true));
  await screen.rerender(page("2026-11", false));
  await screen.rerender(page("2026-12", false));
  expect(screen.getByText("Monat 2026-10")).toBeTruthy();
  await screen.rerender(page("2026-12", true, true, "Nicht verfügbar"));
  expect(screen.getByText("Monat 2026-12")).toBeTruthy();
  expect(screen.getByText("Werte Nicht verfügbar")).toBeTruthy();
  expect(screen.queryByText("Monat 2026-11")).toBeNull();
});

it("updates the visible month's live values and preserves them during a cancelled navigation", async () => {
  const screen = await render(page("2026-10", true));
  await screen.rerender(page("2026-10", true, true, "aktualisiert"));
  await screen.rerender(page("2026-11", false, false));
  expect(screen.getByText("Werte aktualisiert")).toBeTruthy();
  await screen.rerender(page("2026-10", false, false, "loading"));
  expect(screen.getByText("Werte aktualisiert")).toBeTruthy();
});
