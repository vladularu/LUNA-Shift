import type { CalendarWidgetTimelineEntry } from "./calendar-widget-data";
import { NO_CALENDAR_WIDGET, type CalendarWidgetDiagnostics } from "./calendar-widget-diagnostics";

// Android/Web never import expo-widgets or Expo UI's iOS native views.
export function publishCalendarWidgetTimeline(
  _timeline: readonly CalendarWidgetTimelineEntry[],
): void {}
export function calendarWidgetsAvailable(): boolean {
  return false;
}

export async function inspectCalendarWidget(): Promise<CalendarWidgetDiagnostics> {
  return NO_CALENDAR_WIDGET;
}

export function reloadCalendarWidget(): void {}
