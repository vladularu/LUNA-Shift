import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import type { MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { isCheckLimited, selectVisibleCompliance } from "./check-visibility";
import { ComplianceIssueContent, checkDate, checkDayParts } from "./compliance-issue-content";
import { CheckPrerequisitesCard } from "./check-prerequisites-card";
import { CheckRunnerEgg } from "./check-runner-egg";
import { checkDisplayProjection, groupCheckDisplayIssues } from "./check-display-groups";
import { CHECK_NOT_ASSESSABLE, CHECK_TITLE, SUPPORTED_CHECKS_EMPTY } from "./check-copy";
import { weekendAssessmentOpen } from "./weekend-assessment-summary";
import { PlanningHintList, planningHintGroups } from "./planning-hint-list";

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
  const visible = useMemo(
    () => selectVisibleCompliance(compliance, showPlanning),
    [compliance, showPlanning],
  );
  const limited = isCheckLimited(visible) || weekendAssessmentOpen(compliance.weekendAssessment);
  const display = useMemo(() => checkDisplayProjection(visible), [visible]);
  const planningGroups = useMemo(
    () => planningHintGroups(display.issues, shifts),
    [display.issues, shifts],
  );
  const groups = useMemo(
    () =>
      [
        ...groupCheckDisplayIssues(
          display.issues.filter((issue) => issue.kind !== "PLANNING"),
          shifts,
          timeZone,
        ),
        ...planningGroups,
      ].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          { critical: 0, warning: 1, info: 2 }[a.primary.severity] -
            { critical: 0, warning: 1, info: 2 }[b.primary.severity] ||
          a.id.localeCompare(b.id),
      ),
    [display.issues, shifts, planningGroups, timeZone],
  );
  const days = [...new Set(groups.map((group) => group.date))];
  return (
    <View style={{ gap: SPACING.lg, flexGrow: groups.length ? undefined : 1 }}>
      {display.prerequisites.length || visible.scopeCount ? (
        <CheckPrerequisitesCard
          issues={display.prerequisites}
          scopeIssues={visible.scopeNotes}
          shifts={shifts}
        />
      ) : null}
      {!groups.length ? (
        <View
          testID={limited || display.unavailable ? "check-limited" : "check-complete"}
          style={{
            flexGrow: 1,
            minHeight: 280,
            justifyContent: "center",
            alignItems: "center",
            gap: SPACING.md,
          }}
        >
          {limited || display.unavailable ? (
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
                {CHECK_NOT_ASSESSABLE}
              </Text>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>
                Angaben oder Prüfumfang sind noch offen.
              </Text>
            </>
          ) : (
            <CheckRunnerEgg title={CHECK_TITLE} subtitle={SUPPORTED_CHECKS_EMPTY} />
          )}
        </View>
      ) : null}
      {days.map((date) => {
        const dayGroups = groups.filter((group) => group.date === date);
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
              {dayGroups.map((group, index) =>
                group.primary.kind === "PLANNING" ? (
                  index === dayGroups.findIndex((item) => item.primary.kind === "PLANNING") ? (
                    <PlanningHintList
                      key="planning"
                      groups={planningGroups.filter((item) => item.date === date)}
                      shifts={shifts}
                      timeZone={timeZone}
                    />
                  ) : null
                ) : (
                  <ComplianceIssueContent
                    key={group.id}
                    issue={group.primary}
                    relatedIssues={group.relatedIssues}
                    shifts={shifts}
                    timeZone={timeZone}
                  />
                ),
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
