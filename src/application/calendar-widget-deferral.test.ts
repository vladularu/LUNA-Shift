import { expect, it, vi } from "vitest";
import { calendarWidgetDeferral } from "./calendar-widget-deferral";

it("retains deferral until every editing owner releases and ignores duplicate cleanup", () => {
  const changed = vi.fn();
  const unsubscribe = calendarWidgetDeferral.subscribe(changed);
  const first = calendarWidgetDeferral.begin();
  const second = calendarWidgetDeferral.begin();
  try {
    expect(calendarWidgetDeferral.getSnapshot()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    first();
    first();
    expect(calendarWidgetDeferral.getSnapshot()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    second();
    expect(calendarWidgetDeferral.getSnapshot()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    const next = calendarWidgetDeferral.begin();
    next();
    expect(changed).toHaveBeenCalledTimes(2);
  } finally {
    first();
    second();
    unsubscribe();
  }
});
