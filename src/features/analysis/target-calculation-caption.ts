import type { MonthlyWorkingTimeTarget } from "@/domain/working-time-target";

const BASES: Readonly<Record<string, string>> = {
  LEGACY_WORK_MODEL_UNKNOWN: "Grundlage: 5-Tage-Woche (Mo–Fr). Arbeitszeitmodell ergänzen.",
  WORK_MODEL_UNKNOWN: "Arbeitszeitmodell noch offen.",
  WORK_PROFILE_MISSING: "Arbeitszeitprofil für diesen Zeitraum ergänzen.",
  HOLIDAY_REGION_UNKNOWN: "Bundesland für die Feiertagsberechnung ergänzen.",
  HOLIDAY_REGION_UNSUPPORTED: "Feiertagsdaten für dein Bundesland fehlen.",
  TARIFF_SCOPE_UNCONFIRMED: "Tarifzuordnung noch nicht bestätigt.",
  TARIFF_VERSION_UNREVIEWED: "Tarifgrundlage noch nicht geprüft.",
  TARIFF_UNSUPPORTED: "Tarifgrundlage für die Sollzeit ergänzen.",
  SEVEN_DAY_PLAN_UNCONFIRMED: "Dienstplan für die 7-Tage-Woche noch nicht bestätigt.",
  CUSTOM_ROTATING_REFERENCE: "Mit der hinterlegten Referenz für dein Arbeitszeitmodell berechnet.",
  TARGET_RULE_FORECAST: "Mit der hinterlegten Sollzeitregel berechnet.",
  CONDITIONAL_ROSTER_FREE_FORECAST: "Dienstplanangaben für die Sollzeit ergänzen.",
};

export function targetCalculationCaption(
  target: MonthlyWorkingTimeTarget | null | undefined,
): string | undefined {
  if (!target || target.status !== "PROVISIONAL") return undefined;
  const notices = target.notices.filter(
    (item) => item.affectsTarget && item.code !== "CONTRACTUAL_TARGET_FORECAST",
  );
  const notice = notices.find(
    (item) => item.code !== "TARGET_RULE_FORECAST" && item.code !== "CUSTOM_ROTATING_REFERENCE",
  );
  if (notice)
    return BASES[notice.code] ?? "Berechnungsannahmen in deinem Arbeitszeitprofil prüfen.";
  if (
    target.adjustments.some((item) => item.status === "PENDING" || item.status === "PLAN_ESTIMATE")
  ) {
    return "Dienstplanangaben für die Feiertagsberechnung noch offen.";
  }
  if (notices.length) return BASES[notices[0].code];
  return "Aus deinem Arbeitszeitprofil berechnet.";
}
