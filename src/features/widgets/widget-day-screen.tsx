import { Redirect, useLocalSearchParams } from "expo-router";
import { parseLocalDateRouteParam, type RouteParam } from "@/navigation/route-params";
import { dayDetailsRoute } from "@/navigation/routes";
import { useEffect, useState } from "react";
import { useActiveMonthCoordinator } from "@/navigation/active-month";

export function WidgetCalendarRedirect() {
  const { date } = useLocalSearchParams<{ date?: RouteParam }>();
  const parsed = parseLocalDateRouteParam(date);
  const coordinator = useActiveMonthCoordinator();
  const target = parsed.status === "valid" ? parsed.value : null;
  const [prepared, setPrepared] = useState<string | null>(null);
  useEffect(() => {
    if (target) coordinator.setMonth(target.slice(0, 7));
    setPrepared(target);
  }, [coordinator, target]);
  if (target && prepared !== target) return null;
  return <Redirect href={parsed.status === "valid" ? dayDetailsRoute(parsed.value) : "/"} />;
}
