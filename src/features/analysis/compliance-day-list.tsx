import Ionicons from "@/ui/icon";
import { useMemo } from "react";
import { View } from "react-native";
import type { MonthlyComplianceResult, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, SurfaceCard } from "@/ui/design-system";
import { Text } from "@/ui/text";
import { isCheckLimited, selectVisibleCompliance } from "./check-visibility";
import { checkIssueOccurrences, ComplianceIssueContent } from "./compliance-issue-content";
import { CheckPrerequisitesCard } from "./check-prerequisites-card";
import { CheckRunnerEgg } from "./check-runner-egg";
import {
  checkDisplayProjection,
  groupCheckDisplayIssues,
  type CheckDisplayGroup,
} from "./check-display-groups";
import {
  CHECK_NOT_ASSESSABLE,
  CHECK_TITLE,
  LEGAL_TARIFF_TITLE,
  SUPPORTED_CHECKS_EMPTY,
} from "./check-copy";
import { weekendAssessmentOpen } from "./weekend-assessment-summary";
import { planningHintGroups } from "./planning-hint-list";
import { PLANNING_TITLE } from "./check-presentation";

const severityOrder = { critical: 0, warning: 1, info: 2 };

export function ComplianceDayList({
  compliance,
  shifts,
  showPlanning,
  timeZone,
  hasWorkplaceFindings = false,
}: {
  readonly compliance: MonthlyComplianceResult;
  readonly shifts: readonly ShiftEntry[];
  readonly showPlanning: boolean;
  readonly timeZone: string;
  readonly hasWorkplaceFindings?: boolean;
}) {
  const palette = usePalette();
  const visible = useMemo(
    () => selectVisibleCompliance(compliance, showPlanning),
    [compliance, showPlanning],
  );
  const display = useMemo(() => checkDisplayProjection(visible), [visible]);
  const sections = useMemo(() => {
    const rowsFor = (groups: readonly CheckDisplayGroup[]) =>
      groups
        .flatMap(({ primary, relatedIssues }) =>
          checkIssueOccurrences({ issue: primary, relatedIssues, shifts, timeZone }),
        )
        .sort(
          (a, b) =>
            a.period.from.localeCompare(b.period.from) ||
            a.period.until.localeCompare(b.period.until) ||
            severityOrder[a.issue.severity] - severityOrder[b.issue.severity] ||
            a.key.localeCompare(b.key),
        );
    return [
      {
        title: LEGAL_TARIFF_TITLE,
        id: "check-inbox-legal",
        rows: rowsFor(
          groupCheckDisplayIssues(
            display.issues.filter((issue) => issue.kind !== "PLANNING"),
            shifts,
            timeZone,
          ),
        ),
      },
      {
        title: PLANNING_TITLE,
        id: "check-inbox-planning",
        rows: rowsFor(planningHintGroups(display.issues, shifts)),
      },
    ].filter(({ rows }) => rows.length > 0);
  }, [display.issues, shifts, timeZone]);
  const limited =
    isCheckLimited(visible) ||
    weekendAssessmentOpen(compliance.weekendAssessment) ||
    display.unavailable;

  return (
    <View
      style={{ gap: SPACING.lg, flexGrow: sections.length || hasWorkplaceFindings ? undefined : 1 }}
    >
      {sections.map(({ title, id, rows }) => (
        <View key={id} testID={id} style={{ gap: SPACING.xs }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ ...TYPOGRAPHY.small, fontWeight: "600", color: palette.textMuted }}
          >
            {title}
          </Text>
          <SurfaceCard style={{ overflow: "hidden" }}>
            {rows.map((occurrence, index) => (
              <View key={occurrence.key}>
                {index ? <CardSeparator /> : null}
                <ComplianceIssueContent
                  inbox
                  issue={occurrence.issue}
                  occurrence={occurrence}
                  shifts={shifts}
                  timeZone={timeZone}
                />
              </View>
            ))}
          </SurfaceCard>
        </View>
      ))}
      {!sections.length && limited ? (
        <SurfaceCard testID="check-limited" style={{ padding: SPACING.lg, gap: SPACING.sm }}>
          <Ionicons
            name="information-circle-outline"
            color={palette.info}
            size={24}
            accessibilityElementsHidden
          />
          <Text
            accessibilityRole="header"
            style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
          >
            {display.prerequisites.length
              ? "Angabe fehlt"
              : visible.scopeCount
                ? "Angaben zum Prüfumfang"
                : CHECK_NOT_ASSESSABLE}
          </Text>
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>
            Angaben oder Prüfumfang sind noch offen.
          </Text>
        </SurfaceCard>
      ) : null}
      {!sections.length && !limited && !hasWorkplaceFindings ? (
        <View
          testID="check-complete"
          style={{ flexGrow: 1, minHeight: 280, justifyContent: "center", alignItems: "center" }}
        >
          <CheckRunnerEgg title={CHECK_TITLE} subtitle={SUPPORTED_CHECKS_EMPTY} />
        </View>
      ) : null}
      {display.prerequisites.length || visible.scopeCount ? (
        <CheckPrerequisitesCard
          compact
          issues={display.prerequisites}
          scopeIssues={visible.scopeNotes}
          shifts={shifts}
        />
      ) : null}
    </View>
  );
}
