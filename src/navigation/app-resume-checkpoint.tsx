import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useGlobalSearchParams, usePathname, useRootNavigationState } from "expo-router";
import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import { useActiveMonthCoordinator } from "./active-month";
import { appResumeHref } from "./app-resume-state";
import { appResumeStore } from "./app-resume-storage";

export function AppResumeCheckpoint() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const navigation = useRootNavigationState();
  const coordinator = useActiveMonthCoordinator();
  const { ready, error } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    void appResumeStore.load().then(() => {
      if (mounted) setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const query = JSON.stringify(params);
  useEffect(() => {
    if (!loaded || !navigation?.key || !ready || error) return;
    if (!profile) {
      void appResumeStore.clear();
      return;
    }
    const record = () => {
      const values = JSON.parse(query);
      if (pathname === "/") values.month = coordinator.getMonth();
      if (pathname === "/analysis") {
        values.month = coordinator.analysisRequests.getMonth() ?? values.month;
        values.period = coordinator.analysisRequests.getPeriod();
      }
      const href = appResumeHref(pathname, values);
      if (href) void appResumeStore.record(href);
    };
    record();
    const month = coordinator.subscribeMonths(record);
    const analysis = coordinator.analysisRequests.subscribe(record);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "inactive" || state === "background") {
        record();
        void appResumeStore.flush();
      }
    });
    return () => {
      month();
      analysis();
      subscription.remove();
    };
  }, [coordinator, error, loaded, navigation?.key, pathname, profile, query, ready]);
  return null;
}
