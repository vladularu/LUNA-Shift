import { useGlobalSearchParams, useSegments } from "expo-router";
import { useSyncExternalStore } from "react";

import { currentMonth } from "@/engine/calendar";
import { useActiveMonth, useActiveMonthCoordinator } from "@/navigation/active-month";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";

/** Load the visible report's data without changing the calendar's selection. */
export function useDataMonth(): string {
  const segments: readonly string[] = useSegments();
  const params = useGlobalSearchParams<{ month?: RouteParam }>();
  const calendarMonth = useActiveMonth();
  const { analysisRequests } = useActiveMonthCoordinator();
  const analysisMonth = useSyncExternalStore(
    analysisRequests.subscribe,
    analysisRequests.getMonth,
    analysisRequests.getMonth,
  );
  if (!segments.includes("(analysis)")) return calendarMonth;
  const routeMonth = parseMonthRouteParam(params.month);
  return routeMonth.status === "valid" ? routeMonth.value : (analysisMonth ?? currentMonth());
}
