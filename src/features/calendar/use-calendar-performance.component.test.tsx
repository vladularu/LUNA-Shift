import { act, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it } from "@jest/globals";
import { calendarPerformance } from "@/application/calendar-performance";
import { useCalendarPerformance } from "./use-calendar-performance";
describe("calendar commit markers", () => {
  afterEach(() => calendarPerformance.clear());
  it("records focus and month commits without duplicating the app-wide probe", async () => {
    function Probe({ active }: { active: boolean }) {
      useCalendarPerformance(active, "2026-01", "MONTH");
      return null;
    }
    const screen = await render(<Probe active />);
    expect(calendarPerformance.report().events).toEqual([]);
    await act(async () => calendarPerformance.start(true));
    await screen.rerender(<Probe active />);
    await screen.rerender(<Probe active={false} />);
    expect(calendarPerformance.report().events.map((event) => event.values)).toEqual([
      { month: 202601, mode: 1, state: 1 },
      { month: 202601, mode: 1, state: 0 },
    ]);
    await screen.unmount();
  });
});
