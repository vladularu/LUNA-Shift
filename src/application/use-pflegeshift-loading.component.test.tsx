import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react-native";
import { useCallback, useLayoutEffect, useState } from "react";
import { Text } from "react-native";
import type { CalendarEntry } from "@/domain/types";
import type { PflegeShiftPorts } from "./pflegeshift-ports";
import {
  EMPTY_WORK_PATTERN_SETTINGS,
  loadPflegeShiftSnapshot,
  type PflegeShiftSnapshot,
} from "./pflegeshift-snapshot";
import { usePflegeShiftLoading } from "./use-pflegeshift-loading";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";

jest.mock("./pflegeshift-notifications", () => ({
  reconcileLoadedEntryNotifications: jest.fn(async () => false),
}));
jest.mock("./pflegeshift-snapshot", () => ({
  ...jest.requireActual<typeof import("./pflegeshift-snapshot")>("./pflegeshift-snapshot"),
  loadPflegeShiftSnapshot: jest.fn(),
}));
const list = jest.fn<() => Promise<readonly CalendarEntry[]>>();
const record = jest.fn();
const ports = {
  repository: { listCalendarEntries: list },
  diagnostics: { record },
  notifications: {},
} as unknown as PflegeShiftPorts;
let state: ReturnType<typeof usePflegeShiftLoading>;
let visibleEntries: readonly CalendarEntry[] = [];
let editEntries: (next: readonly CalendarEntry[]) => void;
const snapshot: PflegeShiftSnapshot = {
  profile: null,
  templates: [],
  entries: [],
  tariffDecisions: [],
  workPatternSettings: EMPTY_WORK_PATTERN_SETTINGS,
};
function Page({ month }: { month: string }) {
  const [entries, setEntries] = useState<readonly CalendarEntry[]>([]);
  const apply = useCallback((next: PflegeShiftSnapshot) => setEntries(next.entries), []);
  const value = usePflegeShiftLoading(month, ports, entries, setEntries, apply, record);
  useLayoutEffect(() => {
    state = value;
    visibleEntries = entries;
    editEntries = setEntries;
  }, [value, entries]);
  return <Text>{value.ready ? "ready" : "loading"}</Text>;
}
beforeEach(() => {
  list.mockReset();
  record.mockReset();
  jest.mocked(loadPflegeShiftSnapshot).mockReset().mockResolvedValue(snapshot);
});
describe("report readiness while extending the cached year range", () => {
  it("returns across a year boundary immediately without querying again or dropping the previous lookback", async () => {
    const lookback = forecastShift({ id: "lookback", date: "2025-06-01" });
    const october = forecastShift({ id: "october", date: "2026-10-01" });
    const future = forecastShift({ id: "future", date: "2027-06-01" });
    jest
      .mocked(loadPflegeShiftSnapshot)
      .mockResolvedValue({ ...snapshot, entries: [lookback, october] });
    list.mockResolvedValue([october, future]);
    const screen = await render(<Page month="2026-10" />);
    await waitFor(() => expect(state.ready).toBe(true));
    await screen.rerender(<Page month="2027-06" />);
    await waitFor(() => expect(visibleEntries).toContainEqual(future));
    expect(visibleEntries).toContainEqual(lookback);
    await screen.rerender(<Page month="2026-10" />);
    expect(screen.getByText("ready")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
    expect(jest.mocked(loadPflegeShiftSnapshot)).toHaveBeenCalledTimes(1);
    expect(visibleEntries).toContainEqual(october);
  });
  it("retains local edits/deletions and invalidates all remembered windows on a full reload", async () => {
    const original = forecastShift({ id: "old", date: "2025-06-01" });
    const october = forecastShift({ id: "october", date: "2026-10-01" });
    jest
      .mocked(loadPflegeShiftSnapshot)
      .mockResolvedValue({ ...snapshot, entries: [original, october] });
    list.mockResolvedValue([october]);
    const screen = await render(<Page month="2026-10" />);
    await waitFor(() => expect(state.ready).toBe(true));
    const edited = { ...october, title: "Edited", revision: 2 };
    await act(async () => {
      editEntries([edited]);
      state.recordDeletion(original);
    });
    list.mockResolvedValue([edited]);
    await screen.rerender(<Page month="2027-06" />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await screen.rerender(<Page month="2026-10" />);
    expect(visibleEntries).toEqual([edited]);
    jest.mocked(loadPflegeShiftSnapshot).mockResolvedValue({ ...snapshot, entries: [edited] });
    await act(async () => {
      await state.reload();
    });
    await screen.rerender(<Page month="2027-06" />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(visibleEntries).not.toContainEqual(original);
  });
  it("keeps a cached adjacent year ready while its surrounding range loads", async () => {
    const screen = await render(<Page month="2026-10" />);
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    let finish!: (entries: readonly CalendarEntry[]) => void;
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await screen.rerender(<Page month="2027-01" />);
    expect(list).toHaveBeenCalledWith("2026-01-01", "2028-12-31");
    expect(screen.getByText("ready")).toBeTruthy();
    await act(async () => finish([]));
    expect(screen.getByText("ready")).toBeTruthy();
  });
  it("still waits for a year outside the loaded range", async () => {
    const screen = await render(<Page month="2026-10" />);
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    let finish!: (entries: readonly CalendarEntry[]) => void;
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await screen.rerender(<Page month="2030-01" />);
    expect(screen.getByText("loading")).toBeTruthy();
    await act(async () => finish([]));
    expect(screen.getByText("ready")).toBeTruthy();
  });
  it("does not mark the initial snapshot ready prematurely", async () => {
    let finish!: (value: PflegeShiftSnapshot) => void;
    jest.mocked(loadPflegeShiftSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const screen = await render(<Page month="2026-10" />);
    expect(screen.getByText("loading")).toBeTruthy();
    await act(async () => finish(snapshot));
    expect(screen.getByText("ready")).toBeTruthy();
  });
  it("still clears readiness for an explicit full reload", async () => {
    const screen = await render(<Page month="2026-10" />);
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    let finish!: (value: PflegeShiftSnapshot) => void;
    jest.mocked(loadPflegeShiftSnapshot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = state.reload();
    });
    expect(screen.getByText("loading")).toBeTruthy();
    await act(async () => {
      finish(snapshot);
      await pending;
    });
    expect(screen.getByText("ready")).toBeTruthy();
  });
  it("exposes reload failures instead of silently treating an uncovered year as complete", async () => {
    const screen = await render(<Page month="2026-10" />);
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    list.mockRejectedValue(new Error("database unavailable"));
    await screen.rerender(<Page month="2030-01" />);
    await waitFor(() => expect(state.error).not.toBeNull());
    expect(record).toHaveBeenCalledWith("provider", "LOAD_CALENDAR_FAILED", expect.anything());
  });
});
