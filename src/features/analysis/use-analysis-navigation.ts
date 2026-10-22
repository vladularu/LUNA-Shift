import { Temporal } from "@js-temporal/polyfill";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { currentMonth } from "@/engine/calendar";
import { useActiveMonthCoordinator } from "@/navigation/active-month";
import {
  parseEnumRouteParam,
  parseMonthRouteParam,
  type RouteParam,
} from "@/navigation/route-params";
import { analysisPeriodRoute } from "@/navigation/routes";

type Selection = { readonly month: string; readonly period: "MONTH" | "YEAR" };

export function useAnalysisNavigation(timeZone?: string) {
  const coordinator = useActiveMonthCoordinator();
  const params = useLocalSearchParams<{ month?: RouteParam; period?: RouteParam }>();
  const parsedMonth = parseMonthRouteParam(params.month);
  const routeMonth = parsedMonth.status === "valid" ? parsedMonth.value : null;
  const parsedPeriod = parseEnumRouteParam(params.period, ["MONTH", "YEAR"] as const);
  const routePeriod = parsedPeriod.status === "valid" ? parsedPeriod.value : null;
  const [month, setMonth] = useState(
    () => routeMonth ?? coordinator.analysisRequests.getMonth() ?? currentMonth(timeZone),
  );
  const [period, setPeriod] = useState<Selection["period"]>(
    () => routePeriod ?? coordinator.analysisRequests.getPeriod(),
  );
  const focused = useIsFocused();
  const revision = useSyncExternalStore(
    coordinator.analysisRequests.subscribe,
    coordinator.analysisRequests.getRevision,
    coordinator.analysisRequests.getRevision,
  );
  const handledRequest = useRef(revision);
  const returnTarget = useRef<Selection | null>(null);
  const pendingRoute = useRef<Selection | null>(null);
  const current = useRef({ month, period, focused });
  useLayoutEffect(() => {
    current.current = { month, period, focused };
  }, [focused, month, period]);
  const apply = useCallback(
    (next: Selection) => {
      current.current = { ...current.current, month: next.month, period: next.period };
      coordinator.analysisRequests.setMonth(next.month);
      coordinator.analysisRequests.setPeriod(next.period);
      setMonth(next.month);
      setPeriod(next.period);
    },
    [coordinator],
  );
  useEffect(() => {
    if (!routeMonth || handledRequest.current !== revision) return;
    const next = { month: routeMonth, period: routePeriod ?? current.current.period };
    if (!current.current.focused) {
      pendingRoute.current = next;
      return;
    }
    pendingRoute.current = null;
    apply(next);
  }, [apply, revision, routeMonth, routePeriod]);
  useFocusEffect(
    useCallback(() => {
      // A reselect first pops the native stack. Its reset must win over old history.
      if (handledRequest.current !== coordinator.analysisRequests.getRevision()) return;
      const next = returnTarget.current ??
        pendingRoute.current ?? {
          month: current.current.month,
          period: current.current.period,
        };
      returnTarget.current = null;
      pendingRoute.current = null;
      apply(next);
    }, [apply, coordinator]),
  );
  useEffect(() => {
    if (!focused || handledRequest.current === revision) return;
    handledRequest.current = revision;
    returnTarget.current = null;
    pendingRoute.current = null;
    const present = currentMonth(timeZone);
    const mode = coordinator.analysisRequests.getPeriod();
    const selectedMonth = coordinator.analysisRequests.getMonth() ?? current.current.month;
    const next = {
      month: mode === "YEAR" ? `${present.slice(0, 4)}-${selectedMonth.slice(5, 7)}` : present,
      period: mode,
    };
    apply(next);
    router.setParams(next);
  }, [apply, coordinator, focused, revision, timeZone]);

  function open(next: Selection) {
    if (!current.current.focused) return;
    returnTarget.current = { month, period };
    coordinator.analysisRequests.setPeriod(next.period);
    router.push(analysisPeriodRoute(next.month, next.period));
  }
  function selectMonth(next: string) {
    if (!current.current.focused) return;
    const selection = { month: next, period };
    apply(selection);
    router.setParams(selection);
  }
  return {
    month,
    period,
    year: Number(month.slice(0, 4)),
    routeMonth,
    selectMonth,
    changePeriod: (next: Selection["period"]) => {
      if (next !== period) open({ month, period: next });
    },
    moveMonth: (delta: number) =>
      selectMonth(
        Temporal.PlainDate.from(`${month}-01`).add({ months: delta }).toString().slice(0, 7),
      ),
    moveYear: (delta: number) =>
      selectMonth(`${Number(month.slice(0, 4)) + delta}-${month.slice(5, 7)}`),
  };
}
