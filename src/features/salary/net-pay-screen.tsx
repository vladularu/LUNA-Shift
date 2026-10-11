import { router, useLocalSearchParams } from "expo-router";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { LoadFailureView } from "@/ui/loading-view";
import { NetPayAutomaticScreen } from "./net-pay-automatic-screen";

/** Legacy links still open the automatic forecast; gross/mode no longer enable a calculator. */
export function NetPayScreen() {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  if (Array.isArray(params.month) || parsed.status !== "valid")
    return (
      <LoadFailureView
        title="Ungültiger Abrechnungsmonat"
        message="Öffne die Netto-Prognose über die Gehaltsauswertung des gewünschten Monats."
        actionLabel="Zurück"
        onRetry={() => router.back()}
      />
    );
  return <NetPayAutomaticScreen key={parsed.value} month={parsed.value} />;
}
