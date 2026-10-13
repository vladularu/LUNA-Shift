import { describe, expect, it } from "vitest";

import {
  widgetDiagnosticErrorClass,
  widgetTimelineDiagnostics,
} from "./calendar-widget-diagnostics";

const now = new Date("2026-10-12T10:00:00Z");
describe("widget support diagnostics", () => {
  it("selects the latest applicable entry rather than a future or unsorted entry", () => {
    const entries = [
      { date: new Date("2026-10-13T00:00:00Z"), props: { state: "expired" } },
      { date: new Date("2026-10-12T00:00:00Z"), props: { state: "ready" } },
      { date: new Date("2026-10-11T00:00:00Z"), props: { state: "setup" } },
    ];
    expect(widgetTimelineDiagnostics(entries, now)).toEqual({
      entryCount: 3,
      currentState: "ready",
    });
    expect(entries[0].props.state).toBe("expired");
  });
  it.each(["ready", "setup", "expired"] as const)(
    "reports %s without returning any private props",
    (state) => {
      const props = { state, title: "Private service", note: "Private note" };
      expect(widgetTimelineDiagnostics([{ date: now, props }], now)).toEqual({
        entryCount: 1,
        currentState: state,
      });
    },
  );
  it("distinguishes an empty, future-only, invalid or unknown timeline", () => {
    expect(widgetTimelineDiagnostics([], now)).toEqual({ entryCount: 0, currentState: null });
    for (const entry of [
      { date: new Date("2026-10-13T00:00:00Z"), props: { state: "ready" } },
      { date: new Date(NaN), props: { state: "ready" } },
      { date: now, props: { state: "private unexpected state" } },
    ])
      expect(widgetTimelineDiagnostics([entry], now)).toEqual({
        entryCount: 1,
        currentState: null,
      });
  });
  it("only exposes a safe error class, never the underlying message", () => {
    expect(widgetDiagnosticErrorClass(new TypeError("Private data"))).toBe("TypeError");
    expect(widgetDiagnosticErrorClass({ name: "Private data" })).toBe("UnknownError");
    const error = new Error("Private data");
    error.name = "Private data with spaces";
    expect(widgetDiagnosticErrorClass(error)).toBe("UnknownError");
  });
});

it("verifies the current calendar metadata without disclosing dates, titles, paths or colors", () => {
  const props = {
    state: "ready",
    weekDays: Array.from({ length: 28 }, () => ({ date: "private", title: "private" })),
    monthDays: Array.from({ length: 35 }, () => ({ date: "private" })),
    themeMode: "light",
    backgroundFileName: "luna-widget-calendar-private.jpg",
  };
  const result = widgetTimelineDiagnostics([{ date: now, props }], now);
  expect(result).toEqual({
    entryCount: 1,
    currentState: "ready",
    dataFormat: "calendar",
    weekDayCount: 28,
    monthDayCount: 35,
    themeMode: "light",
    hasPhoto: true,
  });
  expect(JSON.stringify(result)).not.toContain("private");
});
it("handles a current snapshot without a photo and an invalid appearance safely", () => {
  expect(
    widgetTimelineDiagnostics(
      [{ date: now, props: { state: "ready", weekDays: [], monthDays: [], themeMode: "private" } }],
      now,
    ),
  ).toMatchObject({ dataFormat: "calendar", themeMode: null, hasPhoto: false });
});
