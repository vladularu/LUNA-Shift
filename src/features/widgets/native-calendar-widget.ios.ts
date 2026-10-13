import { requireOptionalNativeModule } from "expo";
import type { CalendarWidgetProps, CalendarWidgetTimelineEntry } from "./calendar-widget-data";
import {
  NO_CALENDAR_WIDGET,
  widgetDiagnosticErrorClass,
  widgetTimelineDiagnostics,
  type CalendarWidgetDiagnostics,
} from "./calendar-widget-diagnostics";

export function calendarWidgetsAvailable(): boolean {
  return requireOptionalNativeModule("ExpoWidgets") !== null;
}

function nativeCalendarWidget(): typeof import("./calendar-widget.ios").default {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Existing iOS binaries may not contain ExpoWidgets.
  return require("./calendar-widget.ios").default;
}

// SDK 57 persists this tree directly in UserDefaults, not as a JSON blob.
// Optional Codable fields must be omitted: NSNull is not a property-list value.
function propertyListValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map(propertyListValue).filter((item) => item !== undefined);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const stored = propertyListValue(item);
        return stored === undefined ? [] : [[key, stored]];
      }),
    );
  }
  throw new Error("Widget snapshot contains an unsupported storage value.");
}

export function publishCalendarWidgetTimeline(
  timeline: readonly CalendarWidgetTimelineEntry[],
): void {
  if (!calendarWidgetsAvailable()) return;
  // Demand loading keeps existing binaries without the module usable.
  const widget = nativeCalendarWidget();
  widget.updateTimeline(
    timeline.map(({ date, props }) => ({
      date,
      props: propertyListValue(props) as CalendarWidgetProps,
    })),
  );
  requireOptionalNativeModule<{ reloadAllWidgets(): void }>("ExpoWidgets")?.reloadAllWidgets();
}

// Internal support probe: no shift data, paths or error messages are returned.
export async function inspectCalendarWidget(): Promise<CalendarWidgetDiagnostics> {
  const module = requireOptionalNativeModule<{ readonly widgetsDirectory: string | null }>(
    "ExpoWidgets",
  );
  if (module === null) return NO_CALENDAR_WIDGET;
  let groupAvailable = false;
  try {
    const directory = module.widgetsDirectory;
    groupAvailable = typeof directory === "string" && directory.length > 0;
    const widget = nativeCalendarWidget();
    const entries = await widget.getTimeline();
    return {
      nativeAvailable: true,
      groupAvailable,
      ...widgetTimelineDiagnostics(entries, new Date()),
    };
  } catch (error) {
    return {
      nativeAvailable: true,
      groupAvailable,
      entryCount: 0,
      currentState: null,
      errorClass: widgetDiagnosticErrorClass(error),
    };
  }
}

export function reloadCalendarWidget(): void {
  if (!calendarWidgetsAvailable()) return;
  requireOptionalNativeModule<{ reloadAllWidgets(): void }>("ExpoWidgets")?.reloadAllWidgets();
}
