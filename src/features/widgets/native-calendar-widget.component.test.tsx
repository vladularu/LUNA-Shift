import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { requireOptionalNativeModule } from "expo";

import widget from "./calendar-widget.ios";
import { buildCalendarWidgetTimeline } from "./calendar-widget-data";
import {
  inspectCalendarWidget,
  publishCalendarWidgetTimeline,
  reloadCalendarWidget,
} from "./native-calendar-widget.ios";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock("./calendar-widget.ios", () => ({
  __esModule: true,
  default: { getTimeline: jest.fn(), updateTimeline: jest.fn(), reload: jest.fn() },
}));
const reloadAll = jest.fn();
const nativeModule = jest.mocked(requireOptionalNativeModule);
const timeline = jest.mocked(widget.getTimeline);
function candidateMonthDayCount() {
  return buildCalendarWidgetTimeline({
    entries: [],
    now: new Date(),
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
    hasProfile: true,
  })[0].props.monthDays.length;
}
beforeEach(() => {
  jest.mocked(widget.updateTimeline).mockReset();
  nativeModule.mockReturnValue({
    widgetsDirectory: "file:///private/shared-group/ExpoWidgets",
    reloadAllWidgets: reloadAll,
  });
  const entry = buildCalendarWidgetTimeline({
    entries: [],
    now: new Date(),
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
    hasProfile: true,
  })[0];
  const candidate = {
    ...entry,
    date: new Date(0),
    props: { ...entry.props, title: "Private shift" },
  };
  timeline.mockResolvedValue([candidate]);
});
describe("native widget support probe", () => {
  it("identifies binaries without the native extension without loading a widget", async () => {
    nativeModule.mockReturnValue(null);
    expect(await inspectCalendarWidget()).toEqual({
      nativeAvailable: false,
      groupAvailable: false,
      entryCount: 0,
      currentState: null,
    });
    reloadCalendarWidget();
    expect(timeline).not.toHaveBeenCalled();
    expect(widget.reload).not.toHaveBeenCalled();
  });
  it("reads the actual native timeline without replacing its data or revealing paths", async () => {
    const result = await inspectCalendarWidget();
    expect(result).toEqual({
      nativeAvailable: true,
      groupAvailable: true,
      entryCount: 1,
      currentState: "ready",
      dataFormat: "calendar",
      weekDayCount: 28,
      monthDayCount: candidateMonthDayCount(),
      themeMode: "system",
      hasPhoto: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/Private|file:/);
    expect(widget.updateTimeline).not.toHaveBeenCalled();
    expect(widget.reload).not.toHaveBeenCalled();
  });
  it("detects missing App Group access and an empty timeline", async () => {
    nativeModule.mockReturnValue({ widgetsDirectory: null });
    timeline.mockResolvedValue([]);
    expect(await inspectCalendarWidget()).toEqual({
      nativeAvailable: true,
      groupAvailable: false,
      entryCount: 0,
      currentState: null,
    });
  });
  it("reports a failed native read without exposing its error message", async () => {
    timeline.mockRejectedValue(new TypeError("Private shift data"));
    expect(await inspectCalendarWidget()).toEqual({
      nativeAvailable: true,
      groupAvailable: true,
      entryCount: 0,
      currentState: null,
      errorClass: "TypeError",
    });
  });
  it("reloads the existing widget on explicit request", () => {
    reloadCalendarWidget();
    expect(reloadAll).toHaveBeenCalledTimes(1);
    expect(widget.updateTimeline).not.toHaveBeenCalled();
  });
});

it("publishes one shared snapshot and refreshes calendar and month kinds", () => {
  const entries = buildCalendarWidgetTimeline({
    entries: [],
    now: new Date(),
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
    hasProfile: true,
  });
  publishCalendarWidgetTimeline(entries);
  const stored = jest.mocked(widget.updateTimeline).mock.calls[0][0];
  expect(stored).toHaveLength(entries.length);
  expect(stored[0].date).toBe(entries[0].date);
  expect(stored[0].props).toMatchObject({
    state: "ready",
    themeMode: entries[0].props.themeMode,
    weekDays: entries[0].props.weekDays,
    monthDays: entries[0].props.monthDays,
  });
  expect(stored[0].props).not.toHaveProperty("backgroundFileName");
  expect(reloadAll).toHaveBeenCalledTimes(1);
});

it("publishes the real nullable calendar payload as property-list-compatible native data", () => {
  function verify(value: unknown): void {
    if (value === null || value === undefined) throw new Error("Not a property list value");
    if (Array.isArray(value)) {
      value.forEach(verify);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(verify);
      return;
    }
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Not a property list number");
  }
  jest
    .mocked(widget.updateTimeline)
    .mockImplementation((entries) => entries.forEach(({ props }) => verify(props)));
  const entries = buildCalendarWidgetTimeline({
    entries: [],
    now: new Date(),
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
    hasProfile: true,
  });
  expect(entries[0].props.backgroundFileName).toBeNull();
  publishCalendarWidgetTimeline(entries);
  expect(entries[0].props.backgroundFileName).toBeNull();
});

it("omits nulls recursively while retaining photo, colors and empty/false settings", () => {
  const entries = buildCalendarWidgetTimeline({
    entries: [],
    now: new Date(),
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
    hasProfile: true,
    themeMode: "light",
    backgroundFileName: "luna-widget-calendar-one.jpg",
  });
  const input = {
    ...entries[0].props,
    nested: {
      symbol: null,
      detail: undefined,
      empty: "",
      zero: 0,
      disabled: false,
      colors: ["red", null, "blue"],
    },
  };
  publishCalendarWidgetTimeline([{ ...entries[0], props: input }]);
  const stored = jest.mocked(widget.updateTimeline).mock.calls[0][0][0].props;
  expect(stored).toMatchObject({
    themeMode: "light",
    backgroundFileName: "luna-widget-calendar-one.jpg",
    nested: { empty: "", zero: 0, disabled: false, colors: ["red", "blue"] },
  });
  expect(stored.light).toEqual(input.light);
  expect(stored.dark).toEqual(input.dark);
  expect(stored).not.toBe(input);
  expect(input.nested.symbol).toBeNull();
});
it("rejects unsupported values before replacing a valid native timeline", () => {
  const entries = buildCalendarWidgetTimeline({
    entries: [],
    now: new Date(),
    timeZone: "Europe/Berlin",
    scheme: "pflegeshift-internal",
    hasProfile: true,
  });
  expect(() =>
    publishCalendarWidgetTimeline([
      { ...entries[0], props: { ...entries[0].props, backgroundOpacity: Number.NaN } },
    ]),
  ).toThrow("unsupported storage");
  expect(widget.updateTimeline).not.toHaveBeenCalled();
  expect(reloadAll).not.toHaveBeenCalled();
});
