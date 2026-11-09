import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { Temporal } from "@js-temporal/polyfill";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type {
  ComplianceIssue,
  ComplianceSeverity,
  MonthlyComplianceResult,
  ShiftEntry,
} from "@/domain/types";
import { isCheckLimited, selectVisibleCompliance } from "./check-visibility";
import { CheckClearStatus } from "./check-summary-card";
import { CheckPrerequisitesCard } from "./check-prerequisites-card";
import { usePalette } from "@/theme/palette";
import { MOTION } from "@/theme/motion";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { CardSeparator } from "@/ui/design-system";
import { selectionFeedback } from "@/ui/haptics";
import {
  AffectedCheckShifts,
  TariffObservationDetails,
  issueCategory,
} from "./compliance-issue-content";
import { PLANNING_TITLE, checkAppearance } from "./check-presentation";
import { TariffCheckDetails } from "./tariff-check-details";
import { LegalCheckDetails } from "./legal-check-details";
import { legalCheckPresentation } from "./legal-check-presentation";
import { CHECK_TITLE, LEGAL_TARIFF_TITLE } from "./check-copy";
import { weekendAssessmentOpen } from "./weekend-assessment-summary";
import { PlanningHintList, planningHintGroups } from "./planning-hint-list";
import { checkDisplayProjection, groupCheckDisplayIssues } from "./check-display-groups";
import { tariffCheckPresentation } from "./tariff-check-presentation";

interface ComplianceIssueGroup {
  readonly rule: string;
  readonly title: string;
  readonly severity: ComplianceSeverity;
  readonly issues: readonly ComplianceIssue[];
}

const COMPLIANCE_SEVERITY_PRIORITY: Readonly<Record<ComplianceSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const COMPLIANCE_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function groupComplianceIssues(
  issues: readonly ComplianceIssue[],
): readonly ComplianceIssueGroup[] {
  const issuesByRule = new Map<string, ComplianceIssue[]>();
  for (const issue of issues) {
    const group = issuesByRule.get(issue.rule) ?? [];
    group.push(issue);
    issuesByRule.set(issue.rule, group);
  }
  return [...issuesByRule.entries()]
    .map(([rule, groupIssues]) => {
      const orderedIssues = [...groupIssues].sort(
        (left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
      );
      const representative = orderedIssues[0];
      const severity = orderedIssues.reduce<ComplianceSeverity>(
        (highest, issue) =>
          COMPLIANCE_SEVERITY_PRIORITY[issue.severity] < COMPLIANCE_SEVERITY_PRIORITY[highest]
            ? issue.severity
            : highest,
        representative.severity,
      );
      return {
        rule,
        title: representative.tariff
          ? tariffCheckPresentation(
              representative.tariff,
              representative.title,
              representative.description,
            ).title
          : representative.title,
        severity,
        issues: orderedIssues,
      };
    })
    .sort(
      (left, right) =>
        COMPLIANCE_SEVERITY_PRIORITY[left.severity] -
          COMPLIANCE_SEVERITY_PRIORITY[right.severity] ||
        right.issues.length - left.issues.length ||
        left.title.localeCompare(right.title, "de-DE"),
    );
}

function formatComplianceDate(date: string): string {
  const value = Temporal.PlainDate.from(date);
  return COMPLIANCE_DATE_FORMATTER.format(
    new Date(Date.UTC(value.year, value.month - 1, value.day)),
  );
}

function formatComplianceGroupTitle(group: ComplianceIssueGroup): string {
  return group.title;
}

export function ComplianceDetails({
  compliance,
  shifts,
  embedded = false,
  showPlanning = true,
  hideEmptyLegal = false,
  timeZone = "Europe/Berlin",
}: {
  readonly compliance: MonthlyComplianceResult;
  readonly heading?: string;
  readonly shifts: readonly ShiftEntry[];
  readonly embedded?: boolean;
  readonly showPlanning?: boolean;
  readonly hideEmptyLegal?: boolean;
  readonly timeZone?: string;
}) {
  const rawLegal = selectVisibleCompliance(compliance, false);
  const display = checkDisplayProjection(rawLegal);
  const legal = { ...rawLegal, issues: display.issues };
  const planning = selectVisibleCompliance(
    { ...compliance, issues: compliance.issues.filter((issue) => issue.kind === "PLANNING") },
    true,
  );
  if (
    hideEmptyLegal &&
    legal.issues.length === 0 &&
    !isCheckLimited(legal) &&
    !display.unavailable &&
    !weekendAssessmentOpen(compliance.weekendAssessment) &&
    showPlanning &&
    planning.issues.length === 0
  )
    return null;
  return (
    <View style={{ gap: SPACING.xl }}>
      {display.prerequisites.length || legal.scopeCount ? (
        <CheckPrerequisitesCard
          issues={display.prerequisites}
          scopeIssues={legal.scopeNotes}
          shifts={shifts}
        />
      ) : null}
      {legal.issues.length > 0 ||
      !hideEmptyLegal ||
      weekendAssessmentOpen(compliance.weekendAssessment) ||
      display.unavailable ? (
        <ComplianceIssueList
          compliance={legal}
          heading={LEGAL_TARIFF_TITLE}
          shifts={shifts}
          embedded={embedded}
          timeZone={timeZone}
          weekendLimited={
            weekendAssessmentOpen(compliance.weekendAssessment) || display.unavailable
          }
        />
      ) : null}
      {showPlanning && planning.issues.length > 0 ? (
        <ComplianceIssueList
          compliance={planning}
          heading={PLANNING_TITLE}
          shifts={shifts}
          embedded={embedded}
          timeZone={timeZone}
        />
      ) : null}
    </View>
  );
}

function ComplianceIssueList({
  compliance,
  heading,
  shifts,
  embedded = false,
  timeZone,
  weekendLimited = false,
}: {
  readonly compliance: MonthlyComplianceResult;
  readonly heading?: string;
  readonly shifts: readonly ShiftEntry[];
  readonly embedded?: boolean;
  readonly timeZone: string;
  readonly weekendLimited?: boolean;
}) {
  const palette = usePalette();
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const groups = useMemo(() => groupComplianceIssues(compliance.issues), [compliance.issues]);
  const planning =
    compliance.issues.length > 0 && compliance.issues.every((issue) => issue.kind === "PLANNING");
  const displayGroups = useMemo(
    () => planningHintGroups(compliance.issues, shifts),
    [compliance.issues, shifts],
  );
  const shiftsById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  if (compliance.issues.length === 0) {
    return (
      <DetailContainer embedded={embedded}>
        <CheckClearStatus
          title={
            weekendLimited && !isCheckLimited(compliance)
              ? CHECK_TITLE
              : (heading ?? "Arbeitszeitregeln")
          }
          limited={isCheckLimited(compliance) || weekendLimited}
        />
      </DetailContainer>
    );
  }
  if (planning)
    return (
      <DetailContainer embedded={embedded}>
        <PlanningHintList groups={displayGroups} shifts={shifts} timeZone={timeZone} showDates />
      </DetailContainer>
    );
  return (
    <DetailContainer embedded={embedded}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
      >
        {heading ?? (embedded ? "Arbeitszeitregeln" : "Prüfung")}
      </Text>
      <View style={{ gap: SPACING.sm }}>
        {groups.map((group) => {
          const expanded = expandedRule === group.rule;
          const appearance = checkAppearance(group.issues[0], palette);
          const tariffDeviation = group.issues.some((item) => item.tariff?.status === "DEVIATION");
          const tariffReview =
            !tariffDeviation &&
            group.issues.some((item) => item.tariff && item.tariff.status !== "DEVIATION");
          const accent =
            planning || tariffReview
              ? palette.textMuted
              : group.severity === "critical"
                ? palette.danger
                : group.severity === "warning"
                  ? palette.warning
                  : palette.primary;
          const displayTitle = formatComplianceGroupTitle(group);
          const tariffOnly = group.issues.every((item) => !!item.tariff);
          const tariffGroups = tariffOnly
            ? groupCheckDisplayIssues(group.issues, shifts, timeZone)
            : [];
          const accessibleCountLabel = tariffOnly
            ? `${group.issues.length} betroffene Zeiträume`
            : `${group.issues.length} ${
                planning
                  ? group.issues.length === 1
                    ? "Hinweis"
                    : "Hinweise"
                  : group.issues.length === 1
                    ? "Meldung"
                    : "Meldungen"
              }`;
          return (
            <Animated.View
              key={group.rule}
              testID={`check-rule-card-${group.rule}`}
              layout={LinearTransition.duration(MOTION.duration.normal).reduceMotion(
                MOTION.reduceMotion,
              )}
              style={{
                overflow: "hidden",
                borderColor: palette.separator,
                borderRadius: embedded ? 0 : RADII.card,
                borderCurve: CORNER_CURVE,
                backgroundColor: embedded ? "transparent" : palette.surface,
                ...appearance.cardStyle,
              }}
            >
              <Pressable
                accessibilityLabel={`${displayTitle}, ${accessibleCountLabel}`}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityHint={
                  tariffDeviation
                    ? "Abweichung in den erfassten Daten. Öffnet die betroffenen Dienste."
                    : planning || tariffReview
                      ? "Hinweis. Öffnet die betroffenen Dienste."
                      : group.severity === "critical"
                        ? "Kritische Meldung. Öffnet die betroffenen Dienste."
                        : group.severity === "warning"
                          ? "Warnung. Öffnet die betroffenen Dienste."
                          : "Hinweis. Öffnet die betroffenen Dienste."
                }
                onPress={() => {
                  setExpandedRule((current) => (current === group.rule ? null : group.rule));
                  selectionFeedback();
                }}
                style={({ pressed }) => ({
                  minHeight: 64,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACING.sm,
                  backgroundColor: pressed ? palette.surfaceMuted : "transparent",
                  opacity: pressed ? 0.78 : 1,
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.lg,
                })}
              >
                <Ionicons
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  color={accent}
                  name={
                    planning || tariffReview
                      ? "information-circle-outline"
                      : group.severity === "critical"
                        ? "alert-circle-outline"
                        : group.severity === "warning"
                          ? "warning-outline"
                          : "information-circle-outline"
                  }
                  size={20}
                />
                <View style={{ minWidth: 0, flex: 1 }}>
                  <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                    {issueCategory(
                      group.issues.find((item) => item.tariff?.status === "DEVIATION") ??
                        group.issues[0],
                    )}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    selectable
                    style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                  >
                    {displayTitle}
                  </Text>
                  {group.issues.length === 1 || tariffOnly ? (
                    <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                      {group.issues[0].tariff
                        ? tariffCheckPresentation(
                            group.issues[0].tariff,
                            group.issues[0].title,
                            group.issues[0].description,
                          ).summary
                        : legalCheckPresentation(group.issues[0]).summary}
                    </Text>
                  ) : null}
                  <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                    Details ansehen
                  </Text>
                </View>
                {group.issues.length > 1 ? (
                  <Text
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={{
                      color: palette.textMuted,
                      ...TYPOGRAPHY.label,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {group.issues.length}
                  </Text>
                ) : null}
                <Ionicons
                  accessibilityElementsHidden
                  color={palette.textMuted}
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={18}
                />
              </Pressable>
              {expanded ? (
                <Animated.View
                  entering={FadeIn.duration(MOTION.duration.fast).reduceMotion(MOTION.reduceMotion)}
                  exiting={FadeOut.duration(MOTION.duration.instant).reduceMotion(
                    MOTION.reduceMotion,
                  )}
                >
                  <CardSeparator inset={SPACING.lg} />
                  <View style={{ paddingHorizontal: SPACING.lg }}>
                    {tariffOnly
                      ? tariffGroups.map((displayGroup) => (
                          <TariffObservationDetails
                            key={displayGroup.id}
                            issues={[displayGroup.primary, ...displayGroup.relatedIssues]}
                            shifts={shifts}
                            embedded
                          />
                        ))
                      : group.issues.map((item, index) => {
                          const relatedShifts = item.relatedShiftIds
                            .map((id) => shiftsById.get(id))
                            .filter((shift): shift is ShiftEntry => shift !== undefined);
                          return (
                            <View
                              key={item.id}
                              style={{
                                gap: SPACING.sm,
                                borderTopWidth: index > 0 ? 1 : 0,
                                borderTopColor: palette.separator,
                                paddingVertical: SPACING.md,
                              }}
                            >
                              <Text
                                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                                selectable
                                style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                              >
                                {formatComplianceDate(item.date)}
                              </Text>
                              {item.tariff ? (
                                <TariffCheckDetails
                                  evidence={item.tariff}
                                  title={item.title}
                                  description={item.description}
                                  missing={item.relatedShiftIds.some((id) => !shiftsById.has(id))}
                                  embedded
                                >
                                  {relatedShifts.length ? (
                                    <AffectedCheckShifts shifts={relatedShifts} />
                                  ) : null}
                                </TariffCheckDetails>
                              ) : (
                                <LegalCheckDetails
                                  issue={item}
                                  title={item.title}
                                  missing={item.relatedShiftIds.some((id) => !shiftsById.has(id))}
                                  embedded
                                >
                                  {relatedShifts.length ? (
                                    <AffectedCheckShifts shifts={relatedShifts} />
                                  ) : null}
                                </LegalCheckDetails>
                              )}
                            </View>
                          );
                        })}
                  </View>
                </Animated.View>
              ) : null}
            </Animated.View>
          );
        })}
      </View>
    </DetailContainer>
  );
}

function DetailContainer({
  embedded,
  children,
}: {
  readonly embedded: boolean;
  readonly children: ReactNode;
}) {
  return (
    <View style={{ gap: SPACING.md, ...(embedded ? { padding: SPACING.lg } : {}) }}>
      {children}
    </View>
  );
}
