import { WorkingTimeTargetOverview } from "./working-time-target-overview";
import { router, useLocalSearchParams } from "expo-router";
import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import { currentMonth } from "@/engine/calendar";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { LoadingView, LoadFailureView } from "@/ui/loading-view";
import { useWorkingTimeTargetSettings } from "./use-working-time-target-settings";

export function WorkingTimeProfileScreen() {
  const status = usePflegeShiftStatus(),
    { profile, refreshWorkingTimeTarget } = usePflegeShiftProfile();
  const params = useLocalSearchParams<{ origin?: string; month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const month = parsed.status === "valid" ? parsed.value : currentMonth(profile?.timeZone);
  const settings = useWorkingTimeTargetSettings(
    status.ready && !status.error && profile !== null,
    refreshWorkingTimeTarget,
  );
  if (status.ready && status.error)
    return <LoadFailureView message={status.error} onRetry={() => void status.reload()} />;
  if (settings.status === "error")
    return (
      <LoadFailureView
        message="Die Sollzeitangaben konnten nicht geladen werden."
        onRetry={settings.reload}
      />
    );
  if (!profile || !settings.snapshot || settings.status !== "ready") return <LoadingView />;
  if (parsed.status === "invalid")
    return (
      <LoadFailureView
        message="Der Link enthält keinen gültigen Monat."
        onRetry={() => router.back()}
      />
    );
  return (
    <WorkingTimeTargetOverview snapshot={settings.snapshot} month={month} origin={params.origin} />
  );
}
