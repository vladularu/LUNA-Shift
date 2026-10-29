import { act, fireEvent, render } from "@testing-library/react-native";
import { afterEach, expect, it, jest } from "@jest/globals";
import { useLayoutEffect, useState } from "react";
import { Text } from "react-native";
import { CalendarStablePager } from "./calendar-stable-pager";
import { createMonthWindow } from "./month-window";

const mockIdle = jest.fn<(work: () => void) => () => void>(() => () => {});
jest.mock("@/ui/schedule-idle-work", () => ({
  scheduleIdleWork: (work: () => void) => mockIdle(work),
}));

const months = createMonthWindow("2026-09", 24, 36);
const noop = () => {};
const offset = (page: number) => ({
  nativeEvent: { contentOffset: { x: 0, y: page * 700 }, velocity: { y: 0 } },
});
function createWorkCounter() {
  const work = { mounted: 0, unmounted: 0 };
  return {
    work,
    record: (mounted: boolean) => {
      if (mounted) work.mounted++;
      else work.unmounted++;
    },
  };
}
function Month({ month, record }: { month: string; record: (mounted: boolean) => void }) {
  useLayoutEffect(() => {
    record(true);
    return () => {
      record(false);
    };
  }, [record]);
  return <Text testID={`month-${month}`}>{month}</Text>;
}
function Harness({ record }: { record: (mounted: boolean) => void }) {
  const [month, setMonth] = useState("2026-09");
  return (
    <CalendarStablePager
      month={month}
      months={months}
      height={700}
      enabled
      revision={0}
      onBeginDrag={noop}
      onSettled={(event) => setMonth(months[Math.round(event.nativeEvent.contentOffset.y / 700)])}
      renderMonth={(key) => <Month month={key} record={record} />}
    />
  );
}
afterEach(() => {
  mockIdle.mockReset().mockImplementation(() => () => {});
});

it("does not build or remove month bodies while crossing a page threshold repeatedly", async () => {
  const { work, record } = createWorkCounter();
  const screen = await render(<Harness record={record} />);
  const pager = screen.getByTestId("calendar-month-pager");
  const september = screen.getByTestId("month-2026-09", { includeHiddenElements: true });
  work.mounted = work.unmounted = 0;
  await fireEvent(pager, "scrollBeginDrag");
  for (const page of [24.6, 24.4, 24.6, 24.4]) await fireEvent.scroll(pager, offset(page));
  expect(work).toEqual({ mounted: 0, unmounted: 0 });
  expect(screen.getByTestId("month-2026-09", { includeHiddenElements: true })).toBe(september);
});

it("prepares the next offscreen month only after native settlement and idle delivery", async () => {
  const { work, record } = createWorkCounter();
  const screen = await render(<Harness record={record} />);
  const pager = screen.getByTestId("calendar-month-pager");
  work.mounted = work.unmounted = 0;
  await fireEvent(pager, "scrollBeginDrag");
  await fireEvent.scroll(pager, offset(24.8));
  expect(work).toEqual({ mounted: 0, unmounted: 0 });
  expect(mockIdle).not.toHaveBeenCalled();
  await fireEvent(pager, "momentumScrollEnd", offset(25));
  expect(screen.queryByTestId("month-2026-12", { includeHiddenElements: true })).toBeNull();
  expect(work.mounted).toBe(0);
  await act(async () => mockIdle.mock.calls.at(-1)?.[0]());
  expect(screen.getByTestId("month-2026-12", { includeHiddenElements: true })).toBeTruthy();
  expect(work).toEqual({ mounted: 1, unmounted: 1 });
  expect(screen.getAllByTestId(/month-2026-/, { includeHiddenElements: true })).toHaveLength(5);
});

it("cancels queued preparation when another gesture starts, including already delivered callbacks", async () => {
  const cancel = jest.fn();
  mockIdle.mockImplementation(() => cancel);
  const { work, record } = createWorkCounter();
  const screen = await render(<Harness record={record} />);
  const pager = screen.getByTestId("calendar-month-pager");
  await fireEvent(pager, "scrollBeginDrag");
  await fireEvent(pager, "momentumScrollEnd", offset(25));
  const stale = mockIdle.mock.calls.at(-1)?.[0];
  expect(stale).toBeDefined();
  work.mounted = work.unmounted = 0;
  await fireEvent(pager, "scrollBeginDrag");
  expect(cancel).toHaveBeenCalled();
  await act(async () => stale?.());
  await fireEvent.scroll(pager, offset(25.7));
  expect(work).toEqual({ mounted: 0, unmounted: 0 });
  await fireEvent(pager, "momentumScrollEnd", offset(26));
  await act(async () => mockIdle.mock.calls.at(-1)?.[0]());
  expect(screen.getByTestId("month-2027-01", { includeHiddenElements: true })).toBeTruthy();
});

it("keeps rapid consecutive destinations available while idle preparation is starved", async () => {
  const { work, record } = createWorkCounter();
  const screen = await render(<Harness record={record} />);
  const pager = screen.getByTestId("calendar-month-pager");
  for (const page of [25, 26, 27, 28, 29, 30, 29, 28, 27, 26, 25]) {
    await fireEvent(pager, "scrollBeginDrag");
    expect(
      screen.getByTestId(`month-${months[page]}`, { includeHiddenElements: true }),
    ).toBeTruthy();
    work.mounted = work.unmounted = 0;
    await fireEvent.scroll(pager, offset(page));
    expect(work).toEqual({ mounted: 0, unmounted: 0 });
    await fireEvent(pager, "momentumScrollEnd", offset(page));
    expect(
      screen.getAllByTestId(/^month-/, { includeHiddenElements: true }).length,
    ).toBeLessThanOrEqual(5);
    expect(pager.props.scrollEnabled).toBe(true);
  }
});
