import { Redirect, useLocalSearchParams } from "expo-router";
import { parseLocalDateRouteParam, type RouteParam } from "@/navigation/route-params";
import { calendarRoute } from "@/navigation/routes";

export function WidgetCalendarRedirect() {
  const { date } = useLocalSearchParams<{ date?: RouteParam }>();
  const parsed = parseLocalDateRouteParam(date);
  return (
    <Redirect href={parsed.status === "valid" ? calendarRoute(parsed.value.slice(0, 7)) : "/"} />
  );
}
