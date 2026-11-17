import { useLayoutEffect } from "react";
import { calendarWidgetDeferral } from "@/application/calendar-widget-deferral";

export function useCalendarWidgetDeferral(active: boolean) {
  useLayoutEffect(() => {
    if (active) return calendarWidgetDeferral.begin();
  }, [active]);
}
