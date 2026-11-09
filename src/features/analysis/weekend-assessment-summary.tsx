import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import {
  PLANNING_WEEKEND_POLICY,
  type PlanningWeekendAssessment,
} from "@/domain/planning-weekend-policy";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { SelectionSheet } from "@/ui/selection-sheet";
import { selectionFeedback } from "@/ui/haptics";
import { CheckDetailDisclosure } from "./check-detail-disclosure";

const date = (value: string) => value.split("-").reverse().join(".");
const statuses = { FREE: "Vollständig frei", OCCUPIED: "Belegt", UNKNOWN: "Offen" } as const;
const reasons = {
  WORK_RECORDED: "Dienst oder bekannte Bereitschaftsbindung erfasst.",
  WORK_NOT_CONFIRMED_COMPLETE: "Nicht alle Beschäftigungszeiten sind als vollständig bestätigt.",
  OUTSIDE_COVERAGE: "Der erfasste Zeitraum deckt dieses Wochenende nicht vollständig ab.",
  UNRESOLVED_DUTY:
    "Dienstzeiten oder Dienstdaten sind noch offen; das kann auch Bereitschaften betreffen.",
  INVALID_DUTY: "Zeitangaben sind nicht eindeutig auswertbar.",
  EMPLOYMENT_CONTEXT_CHANGED:
    "Arbeitsprofil oder Geltungsbereich wechselt im betrachteten Zeitraum.",
} as const;

export function weekendAssessmentOpen(assessment?: PlanningWeekendAssessment): boolean {
  return Boolean(
    assessment &&
    (assessment.unknownCount > 0 ||
      assessment.windows.some((window) => !window.assessmentComplete || window.unknownCount > 0)),
  );
}

export function WeekendAssessmentWindows({
  assessment,
  affectedOnly = false,
}: {
  readonly assessment: PlanningWeekendAssessment;
  readonly affectedOnly?: boolean;
}) {
  const palette = usePalette();
  const windows = affectedOnly
    ? assessment.windows.filter(
        (window) =>
          window.assessmentComplete &&
          window.unknownCount === 0 &&
          window.freeCount < PLANNING_WEEKEND_POLICY.minimumFreeWeekends,
      )
    : assessment.windows;
  if (!windows.length) return null;
  if (affectedOnly) {
    const ordered = [...windows].sort(
      (a, b) =>
        a.freeCount - b.freeCount || b.until.localeCompare(a.until) || b.from.localeCompare(a.from),
    );
    const primary = ordered[0]!,
      additional = ordered.slice(1);
    const body = { color: palette.textMuted, ...TYPOGRAPHY.body };
    return (
      <View style={{ gap: SPACING.sm }}>
        <Text style={body}>
          {date(primary.from)} bis {date(primary.until)}
        </Text>
        {additional.length ? (
          <CheckDetailDisclosure
            title={`Weitere betroffene Zeiträume (${additional.length})`}
            testID="weekend-additional-windows"
          >
            {additional.map((window) => (
              <View key={window.until} style={{ gap: SPACING.xs }}>
                <Text style={body}>
                  {date(window.from)} bis {date(window.until)}
                </Text>
                <Text style={body}>
                  {window.freeCount === 1 ? "1 freies Wochenende" : "Kein freies Wochenende"} in 4
                  Wochen
                </Text>
              </View>
            ))}
          </CheckDetailDisclosure>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: SPACING.md }}>
      <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
        Vier-Wochen-Zeiträume
      </Text>
      {windows.map((window) => (
        <View key={window.until} style={{ gap: SPACING.xs }}>
          <Text style={{ color: palette.text, ...TYPOGRAPHY.small }}>
            {date(window.from)} bis {date(window.until)}
          </Text>
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
            {window.freeCount} von 4 Wochenenden vollständig frei · {window.occupiedCount} belegt
            {!affectedOnly ? ` · ${window.unknownCount} offen` : ""}
          </Text>
          {!window.assessmentComplete || window.unknownCount > 0 ? (
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
              Wegen offener Angaben nicht abschließend beurteilbar.
            </Text>
          ) : null}
        </View>
      ))}
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
        Ein Zeitraum umfasst vier vollständige Wochen von Montag bis Sonntag. Vier Wochen und
        Kalendermonat sind unterschiedliche Zeiträume.
      </Text>
    </View>
  );
}

export function WeekendAssessmentSummary({
  assessment,
  details = false,
}: {
  readonly assessment?: PlanningWeekendAssessment;
  readonly details?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  if (!assessment) return null;
  const stacked = width < 360 || fontScale >= 1.3;
  const values = [
    ["Belegt", "Belegte Wochenenden", assessment.occupiedCount],
    ["Frei", "Vollständig freie Wochenenden", assessment.freeCount],
    ["Offen", "Offene Wochenenden", assessment.unknownCount],
  ] as const;
  return (
    <View
      testID="weekend-assessment-summary"
      style={{ paddingVertical: SPACING.md, gap: SPACING.sm }}
    >
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>Wochenenden im Monat</Text>
      <View
        testID="weekend-assessment-counts"
        style={{ flexDirection: stacked ? "column" : "row", gap: SPACING.sm }}
      >
        {values.map(([label, spoken, value]) => (
          <View
            key={label}
            accessible
            accessibilityLabel={`${spoken}: ${value}`}
            style={{
              flex: stacked ? undefined : 1,
              flexDirection: stacked ? "row" : "column",
              justifyContent: "space-between",
              gap: SPACING.xs,
            }}
          >
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{label}</Text>
            <Text
              style={{ color: palette.text, ...TYPOGRAPHY.body, fontVariant: ["tabular-nums"] }}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      {weekendAssessmentOpen(assessment) ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
          Wochenendprüfung noch offen
        </Text>
      ) : null}
      {details ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Wochenendübersicht ansehen"
          accessibilityHint="Zeigt Samstage, Sonntage und Vier-Wochen-Zeiträume"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            selectionFeedback();
            setOpen(true);
          }}
          style={({ pressed }) => ({
            minHeight: MINIMUM_TOUCH_TARGET,
            justifyContent: "center",
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
            Wochenendübersicht ansehen
          </Text>
        </Pressable>
      ) : null}
      {open ? (
        <SelectionSheet
          title="Wochenendübersicht"
          visible
          cancelLabel="Schließen"
          onClose={() => setOpen(false)}
        >
          {() => (
            <View style={{ paddingHorizontal: SPACING.lg, gap: SPACING.lg }}>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                Frei bedeutet: Samstag und Sonntag sind nach deinen Einträgen vollständig ohne
                Dienst oder bekannte Bereitschaftsbindung. Fehlende oder nicht abschließend
                beurteilbare Angaben bleiben offen. Das bestätigt keine tatsächlich genommene
                Erholung.
              </Text>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                Ein Wochenende zählt zum Monat seines Sonntags.
              </Text>
              {assessment.weekends.map((weekend) => (
                <View key={weekend.sunday} style={{ gap: SPACING.xs }}>
                  <Text style={{ color: palette.text, ...TYPOGRAPHY.small }}>
                    {date(weekend.saturday)} / {date(weekend.sunday)}
                  </Text>
                  <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                    {statuses[weekend.status]}
                  </Text>
                  {weekend.reasons.map((reason) => (
                    <Text key={reason} style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                      {reasons[reason]}
                    </Text>
                  ))}
                </View>
              ))}
              <WeekendAssessmentWindows assessment={assessment} />
            </View>
          )}
        </SelectionSheet>
      ) : null}
    </View>
  );
}
