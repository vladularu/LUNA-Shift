export type CalendarPageWindow = {
  readonly target: string;
  readonly center: string;
  readonly prepared: readonly string[];
};

export function calendarPageTarget(month: string, revision: number, first: string, height: number) {
  return `${month}:${revision}:${first}:${height}`;
}

/** Retain prepared neighbours, but mount only the destination of an external jump. */
export function calendarPageWindow(
  target: string,
  center: string,
  months: readonly string[],
  previous: readonly string[] = [],
): CalendarPageWindow {
  const index = months.indexOf(center);
  const ready = new Set([...previous, center]);
  return {
    target,
    center,
    prepared: months.slice(Math.max(0, index - 2), index + 3).filter((month) => ready.has(month)),
  };
}

export function prepareCalendarPages(window: CalendarPageWindow, months: readonly string[]) {
  const index = months.indexOf(window.center);
  const prepared = months.slice(Math.max(0, index - 2), index + 3);
  return prepared.length === window.prepared.length &&
    prepared.every((month, i) => month === window.prepared[i])
    ? window
    : { ...window, prepared };
}
