import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ReportPeriodPager, reportPeriodOffset } from "./report-period-pager";

let mockReduced = false;
jest.mock("react-native-reanimated", () => ({ useReducedMotion: () => mockReduced }));
const changed = jest.fn();
const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo");
function Pager({
  initial = "2030-12",
  unit = "MONTH",
  enabled = true,
}: {
  initial?: string;
  unit?: "MONTH" | "YEAR";
  enabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ReportPeriodPager
      value={value}
      unit={unit}
      enabled={enabled}
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
      renderPage={(month, move) => (
        <View>
          <Text>{month}</Text>
          <Pressable accessibilityLabel="Vor" onPress={() => move(-1)}>
            <Text>Vor</Text>
          </Pressable>
          <Pressable accessibilityLabel="Weiter" onPress={() => move(1)}>
            <Text>Weiter</Text>
          </Pressable>
        </View>
      )}
    />
  );
}
type Screen = Awaited<ReturnType<typeof render>>;
async function measure(screen: Screen, width = 390) {
  await fireEvent(screen.getByTestId("report-period-pager"), "layout", {
    nativeEvent: { layout: { width, height: 700 } },
  });
}
async function settle(screen: Screen, index: number, width = 390) {
  await fireEvent(screen.getByTestId("report-period-scroll"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: index * width, y: 0 } },
  });
}
beforeEach(() => {
  mockReduced = false;
  changed.mockClear();
  scrollTo.mockClear();
});

describe("native chronological report paging", () => {
  it("prepares previous and next reports before a gesture without selecting them", async () => {
    const screen = await render(<Pager />);
    await measure(screen);
    expect(screen.getByTestId("report-period-scroll").props).toMatchObject({
      horizontal: true,
      pagingEnabled: true,
      directionalLockEnabled: true,
    });
    expect(screen.getByText("2030-12")).toBeTruthy();
    expect(screen.getByText("2030-11", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("2031-01", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText("2030-11")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^\d{4}-\d{2}$/, { includeHiddenElements: true })).toHaveLength(3);
  });
  it.each([
    [13, "2031-01"],
    [11, "2030-11"],
  ])("commits the chronological neighbour at native page %i", async (index, month) => {
    const screen = await render(<Pager />);
    await measure(screen);
    await fireEvent(screen.getByTestId("report-period-scroll"), "scrollBeginDrag");
    await settle(screen, 12.4);
    expect(changed).not.toHaveBeenCalled();
    await settle(screen, index as number);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenLastCalledWith(month);
    expect(screen.getByText(month as string)).toBeTruthy();
  });
  it("cancels a partial drag without changing month or removing prepared neighbours", async () => {
    const screen = await render(<Pager />);
    await measure(screen);
    await settle(screen, 12.3);
    await settle(screen, 12);
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText("2030-12")).toBeTruthy();
  });
  it.each([
    ["Vor", 11, "2030-11"],
    ["Weiter", 13, "2031-01"],
  ])("uses native motion for %s and commits only when settled", async (label, index, month) => {
    const screen = await render(<Pager />);
    await measure(screen);
    await fireEvent.press(screen.getByLabelText(label as string));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: (index as number) * 390, animated: true });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText("2030-12")).toBeTruthy();
    await settle(screen, index as number);
    expect(screen.getByText(month as string)).toBeTruthy();
  });
  it("retargets repeated taps and prepares the destination without building a route history", async () => {
    const screen = await render(<Pager />);
    await measure(screen);
    await fireEvent.press(screen.getByLabelText("Weiter"));
    await fireEvent.press(screen.getByLabelText("Weiter"));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 14 * 390, animated: true });
    expect(screen.getByText("2031-02", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getAllByText(/^\d{4}-\d{2}$/, { includeHiddenElements: true })).toHaveLength(5);
    await settle(screen, 14);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2031-02")).toBeTruthy();
    expect(screen.getAllByText(/^\d{4}-\d{2}$/, { includeHiddenElements: true })).toHaveLength(3);
  });
  it("uses years in both directions while preserving the month suffix", async () => {
    expect(reportPeriodOffset("2024-02", -1, "YEAR")).toBe("2023-02");
    const screen = await render(<Pager initial="2024-02" unit="YEAR" />);
    await measure(screen);
    await settle(screen, 11);
    expect(screen.getByText("2023-02")).toBeTruthy();
    await settle(screen, 13);
    expect(screen.getByText("2025-02")).toBeTruthy();
  });
  it("ignores hidden screen gestures", async () => {
    const screen = await render(<Pager enabled={false} />);
    await measure(screen);
    expect(screen.getByTestId("report-period-scroll").props.scrollEnabled).toBe(false);
    await settle(screen, 13);
    expect(changed).not.toHaveBeenCalled();
  });
  it("respects reduced motion for arrow navigation", async () => {
    mockReduced = true;
    const screen = await render(<Pager />);
    await measure(screen);
    await fireEvent.press(screen.getByLabelText("Vor"));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 11 * 390, animated: false });
    expect(screen.getByText("2030-11")).toBeTruthy();
  });
  it("preserves the selected month across width changes", async () => {
    const screen = await render(<Pager />);
    await measure(screen);
    await settle(screen, 13);
    await measure(screen, 430);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 13 * 430, animated: false });
    expect(screen.getByText("2031-01")).toBeTruthy();
  });
  it("repositions a distant Today request without publishing a preloaded month", async () => {
    const change = jest.fn();
    const page = (month: string) => <Text>{month}</Text>;
    const screen = await render(
      <ReportPeriodPager value="2030-12" onChange={change} renderPage={page} />,
    );
    await measure(screen);
    await act(async () => {
      await screen.rerender(
        <ReportPeriodPager value="2026-10" onChange={change} renderPage={page} />,
      );
    });
    expect(screen.getByText("2026-10")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });
  it("keeps a Today request authoritative when an old native animation ends late", async () => {
    const change = jest.fn();
    const page = (month: string) => <Text>{month}</Text>;
    const screen = await render(
      <ReportPeriodPager value="2030-12" onChange={change} renderPage={page} />,
    );
    await measure(screen);
    await screen.rerender(
      <ReportPeriodPager value="2030-10" onChange={change} renderPage={page} />,
    );
    await settle(screen, 13);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByText("2030-10")).toBeTruthy();
    await settle(screen, 10);
    expect(change).not.toHaveBeenCalled();
  });
  it("keeps a prepared destination mounted when it becomes the visible report", async () => {
    const mounts = new Map<string, number>();
    function PreparedReport({ month }: { month: string }) {
      useEffect(() => {
        mounts.set(month, (mounts.get(month) ?? 0) + 1);
      }, [month]);
      return <Text>{month}</Text>;
    }
    function Reports() {
      const [month, setMonth] = useState("2030-12");
      return (
        <ReportPeriodPager
          value={month}
          onChange={setMonth}
          renderPage={(value) => <PreparedReport month={value} />}
        />
      );
    }
    const screen = await render(<Reports />);
    await measure(screen);
    expect(mounts.get("2031-01")).toBe(1);
    await settle(screen, 13);
    expect(screen.getByText("2031-01")).toBeTruthy();
    expect(mounts.get("2031-01")).toBe(1);
  });
});
