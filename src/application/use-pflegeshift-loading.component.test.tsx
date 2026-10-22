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
  }, [value]);
  return <Text>{value.ready ? "ready" : "loading"}</Text>;
}
beforeEach(() => {
  list.mockReset();
  record.mockReset();
  jest.mocked(loadPflegeShiftSnapshot).mockReset().mockResolvedValue(snapshot);
});
describe("report readiness while extending the cached year range", () => {
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
