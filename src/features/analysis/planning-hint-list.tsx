import { View } from "react-native";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { groupCheckDisplayIssues, type CheckDisplayGroup } from "./check-display-groups";
import { ComplianceIssueContent, checkDate } from "./compliance-issue-content";
import { PLANNING_TITLE } from "./check-presentation";

const nightRule = (issue: ComplianceIssue) =>
  issue.rule === "PLANNING_NIGHT_SERIES" || issue.rule === "PLANNING_NIGHT_RECOVERY";
const priority = (issue: ComplianceIssue) =>
  issue.rule === "PLANNING_7_DAYS" ? 0 : nightRule(issue) ? 1 : 2;

/** Work is always a distinct point; only validated observations of one night phase may share a row. */
export function planningHintGroups(
  issues: readonly ComplianceIssue[],
  shifts: readonly ShiftEntry[],
): readonly CheckDisplayGroup[] {
  const planning = issues.filter((issue) => issue.kind === "PLANNING");
  return [
    ...planning
      .filter((issue) => !nightRule(issue))
      .map((primary) => ({ id: primary.id, date: primary.date, primary, relatedIssues: [] })),
    ...groupCheckDisplayIssues(planning.filter(nightRule), shifts),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      priority(a.primary) - priority(b.primary) ||
      a.id.localeCompare(b.id),
  );
}

export function PlanningHintList({
  groups,
  shifts,
  timeZone,
  showDates = false,
}: {
  readonly groups: readonly CheckDisplayGroup[];
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone: string;
  readonly showDates?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: SPACING.md }}>
      {[...new Set(groups.map((group) => group.date))].map((date) => (
        <View key={date} style={{ gap: SPACING.sm }}>
          {showDates ? (
            <Text
              accessibilityRole="header"
              style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}
            >
              {checkDate(date)}
            </Text>
          ) : null}
          <View
            testID={`planning-hint-card-${date}`}
            style={{
              backgroundColor: palette.surfaceRaised,
              borderWidth: 0,
              borderRadius: RADII.card,
              borderCurve: CORNER_CURVE,
              paddingHorizontal: SPACING.lg,
            }}
          >
            <Text
              style={{
                color: palette.textMuted,
                ...TYPOGRAPHY.caption,
                paddingTop: SPACING.lg,
                paddingBottom: SPACING.xs,
              }}
            >
              {PLANNING_TITLE}
            </Text>
            {groups
              .filter((group) => group.date === date)
              .map((group, index) => (
                <View
                  key={group.id}
                  style={{ borderTopWidth: index ? 1 : 0, borderTopColor: palette.separator }}
                >
                  <ComplianceIssueContent
                    issue={group.primary}
                    shifts={shifts}
                    timeZone={timeZone}
                    compact
                  />
                </View>
              ))}
          </View>
        </View>
      ))}
    </View>
  );
}
