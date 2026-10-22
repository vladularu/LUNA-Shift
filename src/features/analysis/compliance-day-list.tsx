import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import type { MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { AnalysisCoverageNote } from "./analysis-coverage-note";
import { PLANNING_HIDDEN_NOTICE, selectVisibleCompliance } from "./check-visibility";
import { ComplianceIssueContent, checkDate, checkDayParts } from "./compliance-issue-content";
import { CheckPrerequisitesCard } from "./check-prerequisites-card";
import { CheckRunnerEgg } from "./check-runner-egg";
const PRIORITY = { critical: 0, warning: 1, info: 2 };

export function ComplianceDayList({
  compliance,
  shifts,
  showPlanning,
  timeZone,
}: {
  readonly compliance: MonthlyComplianceResult;
  readonly shifts: readonly ShiftEntry[];
  readonly showPlanning: boolean;
  readonly timeZone: string;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const visible = selectVisibleCompliance(compliance, showPlanning);
  const limited = (visible.prerequisiteCount ?? 0) > 0;
  const issues = useMemo(
    () =>
      [...selectVisibleCompliance(compliance, showPlanning).issues].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          PRIORITY[a.severity] - PRIORITY[b.severity] ||
          a.id.localeCompare(b.id),
      ),
    [compliance, showPlanning],
  );
  const days = [...new Set(issues.map((issue) => issue.date))];
  return (
    <View style={{ gap: SPACING.lg, flexGrow: issues.length ? undefined : 1 }}>
      {!showPlanning ? <AnalysisCoverageNote message={PLANNING_HIDDEN_NOTICE} /> : null}
      {limited ? <CheckPrerequisitesCard issues={visible.prerequisites} /> : null}
      {!issues.length ? (
        <View
          testID={limited ? "check-limited" : "check-complete"}
          style={{
            flexGrow: 1,
            minHeight: 280,
            justifyContent: "center",
            alignItems: "center",
            gap: SPACING.md,
          }}
        >
          {limited ? (
            <>
              <Ionicons
                name="information-circle-outline"
                color={palette.info}
                size={104}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text
                accessibilityRole="header"
                style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
              >
                Bisher keine Auffälligkeiten
              </Text>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>
                Angaben fehlen noch.
              </Text>
            </>
          ) : (
            <CheckRunnerEgg
              title={showPlanning ? "Prüfung abgeschlossen" : "Gesetzliche Prüfung"}
            />
          )}
        </View>
      ) : null}
      {days.map((date) => {
        const dayIssues = issues.filter((issue) => issue.date === date);
        const [day, month] = checkDayParts(date);
        return (
          <View
            key={date}
            testID={`check-day-group-${date}`}
            style={{ flexDirection: stacked ? "column" : "row", gap: SPACING.sm }}
          >
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={checkDate(date)}
              style={{
                width: stacked ? undefined : 36,
                paddingTop: stacked ? 0 : SPACING.md,
                alignItems: stacked ? "flex-start" : "center",
              }}
            >
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{
                  color: palette.text,
                  ...(stacked ? TYPOGRAPHY.sectionTitle : TYPOGRAPHY.value),
                  fontWeight: "500",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {stacked ? checkDate(date, false) : day}
              </Text>
              {!stacked ? (
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
                >
                  {month}
                </Text>
              ) : null}
            </View>
            <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: SPACING.sm }}>
              {dayIssues.map((issue) => (
                <ComplianceIssueContent
                  key={issue.id}
                  issue={issue}
                  shifts={shifts}
                  timeZone={timeZone}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
