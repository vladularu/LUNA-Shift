import { router, useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useActiveMonthCoordinator } from "./active-month";

/** Only a confirmed visible page publishes its month; preloaded reports stay local. */
export function useReportMonth(routeMonth: string | null) {
  const coordinator = useActiveMonthCoordinator();
  const focused = useIsFocused();
  const [month, setMonth] = useState(() => routeMonth ?? coordinator.getMonth());
  useEffect(() => {
    if (focused && routeMonth) {
      coordinator.setMonth(routeMonth);
      setMonth(routeMonth);
    }
  }, [coordinator, focused, routeMonth]);
  useFocusEffect(
    useCallback(() => {
      const next = routeMonth ?? coordinator.getMonth();
      coordinator.setMonth(next);
      setMonth(next);
    }, [coordinator, routeMonth]),
  );
  const selectMonth = useCallback(
    (next: string) => {
      if (!focused) return;
      coordinator.setMonth(next);
      setMonth(next);
      router.setParams({ month: next });
    },
    [coordinator, focused],
  );
  return { month, selectMonth, focused };
}
