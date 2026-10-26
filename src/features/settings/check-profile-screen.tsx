import { router, useLocalSearchParams } from "expo-router";
import { requireRemunerationDate } from "@/domain/remuneration-profile";
import type { RouteParam } from "@/navigation/route-params";
import { LoadFailureView } from "@/ui/loading-view";
import { SettingsEditorScreen } from "./settings-editor-screen";
/** Legacy recovery links open the existing model fields; scope is selected on save. */
export function CheckProfileScreen() {
  const params = useLocalSearchParams<{ questions?: RouteParam; effectiveFrom?: RouteParam }>();
  const validQuestions =
    params.questions === undefined ||
    (typeof params.questions === "string" &&
      params.questions.length > 0 &&
      params.questions.split(",").every((q) => ["work", "night", "sunday", "region"].includes(q)));
  let validPeriod = true;
  if (params.effectiveFrom !== undefined && params.effectiveFrom !== "all")
    try {
      requireRemunerationDate(params.effectiveFrom);
    } catch {
      validPeriod = false;
    }
  if (!validQuestions || !validPeriod)
    return (
      <LoadFailureView
        title="Angaben können nicht geöffnet werden"
        message="Der Link enthält unbekannte Fragen oder keinen gültigen Zeitraum."
        actionLabel="Schließen"
        onRetry={() => router.back()}
      />
    );
  const questions = typeof params.questions === "string" ? params.questions : null;
  const section =
    questions === null ? "EMPLOYMENT" : questions.split(",").includes("region") ? "WORK" : "MODEL";
  return <SettingsEditorScreen sectionOverride={section} />;
}
