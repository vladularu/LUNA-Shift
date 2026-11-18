import { Text } from "@/ui/text";
import { useEffect, useRef } from "react";
import Ionicons from "@/ui/icon";
import { Alert, Pressable, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Temporal } from "@js-temporal/polyfill";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import type { PlanningWeekendWindow } from "@/domain/planning-weekend-policy";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { selectionFeedback } from "@/ui/haptics";
import {
  createCheckIssueSession,
  invalidateCheckIssueSession,
  releaseCheckIssueSession,
  type CheckIssueInput,
} from "@/navigation/check-issue-session";
import { PlanningHintDetails } from "./planning-hint-details";
import { planningHintPresentation } from "./planning-hint-presentation";
import {
  affectedWeekendWindows,
  planningWeekendWindowsForIssue,
  weekendHintTitle,
} from "./weekend-assessment-summary";
import { TariffCheckDetails, tariffCheckStatus } from "./tariff-check-details";
import { complianceTimeline, restDuration } from "./compliance-timeline";
import {
  checkAppearance,
  checkCategory,
  checkCategoryLabel,
  planningCardSummary,
} from "./check-presentation";
import { LegalCheckDetails } from "./legal-check-details";
import { legalCheckPresentation } from "./legal-check-presentation";
import { tariffCheckPresentation } from "./tariff-check-presentation";
import { CheckDetailDisclosure } from "./check-detail-disclosure";
import { CheckDutyOverview } from "./check-duty-overview";
import {
  CheckDetailCard,
  CheckDetailStack,
  planningHintIcon,
  useCheckReferenceDetail,
} from "./check-detail-layout";
import { checkPeriodLabel } from "./check-period-label";
import { CheckRestTimeline, formatCheckRestDuration } from "./check-rest-timeline";

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
export function checkDate(date: string, includeYear = true): string {
  try {
    const day = Temporal.PlainDate.from(date);
    return String(day.day) + ". " + MONTHS[day.month - 1] + (includeYear ? " " + day.year : "");
  } catch {
    return "Datum nicht verfügbar";
  }
}
export function checkDayParts(date: string): readonly [string, string] {
  const months = [
    "Jan.",
    "Feb.",
    "März",
    "Apr.",
    "Mai",
    "Juni",
    "Juli",
    "Aug.",
    "Sept.",
    "Okt.",
    "Nov.",
    "Dez.",
  ];
  try {
    const day = Temporal.PlainDate.from(date);
    return [String(day.day), months[day.month - 1]];
  } catch {
    return ["—", ""];
  }
}
export const issueCategory = (issue: ComplianceIssue) =>
  checkCategory(issue) === "tariff" && issue.tariff?.status === "DEVIATION"
    ? "Tarifprüfung · Abweichung erkannt"
    : checkCategoryLabel(issue);
export const issueSeverity = (issue: ComplianceIssue) =>
  issue.kind === "PLANNING"
    ? "Hinweis"
    : issue.tariff
      ? tariffCheckStatus(issue.tariff.status)
      : issue.severity === "critical"
        ? "Kritisch"
        : issue.severity === "warning"
          ? "Warnung"
          : "Hinweis";

function compactCheckPeriod(period?: {
  readonly from: string;
  readonly until: string;
}): string | null {
  if (!period) return null;
  try {
    const from = Temporal.PlainDate.from(period.from),
      until = Temporal.PlainDate.from(period.until);
    if (Temporal.PlainDate.compare(from, until) > 0) return null;
    const part = (day: Temporal.PlainDate, year: boolean) =>
      `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.${year ? day.year : ""}`;
    return `${part(from, from.year !== until.year)}–${part(until, true)}`;
  } catch {
    return null;
  }
}

export function AffectedCheckShifts({
  shifts,
  timeZone,
  weekendPeriod,
}: {
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone?: string;
  readonly weekendPeriod?: { readonly from: string; readonly until: string };
}) {
  const palette = usePalette();
  if (!weekendPeriod)
    return <CheckDutyOverview shifts={shifts} timeZone={timeZone} testID="check-affected-shifts" />;
  const label = compactCheckPeriod(weekendPeriod);
  if (!label) return null;
  const selected = shifts.filter((shift) => {
    if (
      shift.deletedAt !== null ||
      shift.date < weekendPeriod.from ||
      shift.date > weekendPeriod.until
    )
      return false;
    try {
      return Temporal.PlainDate.from(shift.date).dayOfWeek >= 6;
    } catch {
      return false;
    }
  });
  return (
    <View testID="weekend-duty-overview" style={{ gap: SPACING.sm }}>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{label}</Text>
      <CheckDutyOverview
        shifts={selected}
        dates={[...new Set(selected.map((shift) => shift.date))]}
        timeZone={timeZone}
        testID="check-affected-shifts"
      />
    </View>
  );
}

function WeekendDuties({
  window,
  shifts,
}: {
  readonly window: PlanningWeekendWindow;
  readonly shifts: readonly ShiftEntry[];
}) {
  const reference = useCheckReferenceDetail();
  return (
    <View testID="weekend-duty-overview" style={{ gap: SPACING.md }}>
      {window.weekends.map((weekend) => {
        const ids = new Set(weekend.relatedShiftIds);
        const duties = shifts.filter(({ id }) => ids.has(id));
        const status = weekend.status === "FREE" ? "Frei" : "Belegt";
        return (
          <View key={weekend.saturday} testID={`check-weekend-${weekend.saturday}`}>
            <Text style={{ ...TYPOGRAPHY.small, fontWeight: "600", color: reference?.text }}>
              {checkPeriodLabel(weekend.saturday, weekend.sunday)} · {status}
            </Text>
            {duties.length ? (
              <CheckDutyOverview shifts={duties} testID="check-affected-shifts" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Each observed window keeps its own dated duty overview. */
export function TariffObservationDetails({
  issues,
  shifts,
  embedded = false,
  timeZone,
}: {
  readonly issues: readonly ComplianceIssue[];
  readonly shifts: readonly ShiftEntry[];
  readonly embedded?: boolean;
  readonly timeZone?: string;
}) {
  const byId = new Map<string, ShiftEntry | null>();
  for (const shift of shifts) byId.set(shift.id, byId.has(shift.id) ? null : shift);
  const members = issues.map((issue) => {
    const ids = [...new Set(issue.relatedShiftIds)];
    const related = ids
      .map((id) => byId.get(id))
      .filter((shift): shift is ShiftEntry => !!shift && shift.deletedAt === null);
    return { issue, related, missing: related.length !== ids.length };
  });
  const original = (member: (typeof members)[number]) =>
    member.issue.tariff ? (
      <View key={member.issue.id} testID={`check-original-issue-${member.issue.id}`}>
        <TariffCheckDetails
          evidence={member.issue.tariff}
          title={member.issue.title}
          description={member.issue.description}
          missing={member.missing}
          embedded={embedded}
          shifts={member.related}
          timeZone={timeZone}
        />
      </View>
    ) : null;
  return (
    <View style={{ gap: SPACING.md }}>
      {members[0] ? original(members[0]) : null}
      {members.length > 1 ? (
        <CheckDetailStack embedded={embedded}>
          <CheckDetailCard>
            <CheckDetailDisclosure title={`Weitere Zeiträume (${members.length - 1})`}>
              {members.slice(1).map(original)}
            </CheckDetailDisclosure>
          </CheckDetailCard>
        </CheckDetailStack>
      ) : null}
    </View>
  );
}

function checkIssueContext({ issue, relatedIssues = [], shifts, timeZone }: CheckIssueInput) {
  const unique = new Map<string, ComplianceIssue>();
  for (const member of [issue, ...relatedIssues])
    if (!unique.has(member.id)) unique.set(member.id, member);
  const members = [...unique.values()].map((member) => {
    const timeline = complianceTimeline(member, shifts, timeZone);
    return {
      issue: member,
      model: timeline,
      hint: member.kind === "PLANNING" ? planningHintPresentation(member, timeline.title) : null,
    };
  });
  const grouped = members.length > 1;
  const shareDutyOverview =
    grouped && !members.some((member) => member.hint?.weekendPeriod || member.model.rest);
  const groupedTariff = grouped && members.every((member) => !!member.issue.tariff);
  const groupLabel = groupedTariff
    ? `${members.length} betroffene Zeiträume`
    : `${members.length} Prüfpunkte`;
  const allRelated = [
    ...new Map(
      members.flatMap((member) => member.model.related).map((shift) => [shift.id, shift]),
    ).values(),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.id.localeCompare(b.id),
  );
  return { members, grouped, shareDutyOverview, groupLabel, allRelated };
}

export interface CheckIssueOccurrence {
  readonly key: string;
  readonly issue: ComplianceIssue;
  readonly period: { readonly from: string; readonly until: string };
  readonly weekend?: PlanningWeekendWindow;
}

export function checkIssueOccurrences(input: CheckIssueInput): CheckIssueOccurrence[] {
  const { members } = checkIssueContext(input);
  return members.flatMap<CheckIssueOccurrence>(({ issue, model }) => {
    const weekends = planningWeekendWindowsForIssue(issue);
    if (weekends.length)
      return weekends.map((weekend) => ({
        key: `${issue.id}/${weekend.until}`,
        issue,
        period: weekend,
        weekend,
      }));
    const { rest, series } = model;
    const period =
      issue.tariff?.period ??
      (rest
        ? { from: rest.endDate, until: rest.startDate }
        : series?.from && series.until
          ? { from: series.from, until: series.until }
          : { from: issue.date, until: issue.date });
    return [
      {
        key: issue.id,
        issue,
        period,
      },
    ];
  });
}

export function openCheckIssueDetails(input: CheckIssueInput) {
  const request = createCheckIssueSession(input);
  if (!request) return null;
  try {
    router.push({ pathname: "/check-issue", params: { session: request.id } });
    return request.id;
  } catch {
    releaseCheckIssueSession(request.id);
    Alert.alert("Details nicht geöffnet", "Versuche es bitte erneut.");
    return null;
  }
}

export function ComplianceIssueDetails(input: CheckIssueInput) {
  const reference = useCheckReferenceDetail();
  const { issue, shifts, timeZone, weekend } = input;
  const { members, grouped, shareDutyOverview, allRelated } = checkIssueContext(input);
  const tariff = issue.kind === "LEGAL" ? issue.tariff : null;
  return (
    <View style={{ gap: SPACING.md }}>
      {shareDutyOverview && !tariff && allRelated.length ? (
        <View style={{ paddingHorizontal: SPACING.lg }}>
          <AffectedCheckShifts shifts={allRelated} timeZone={timeZone} />
        </View>
      ) : null}
      {tariff ? (
        <TariffObservationDetails
          issues={members.map((member) => member.issue)}
          shifts={shifts}
          timeZone={timeZone}
        />
      ) : (
        members.map((member) => {
          const selectedWeekend = reference
            ? (weekend ??
              affectedWeekendWindows(member.hint?.weekendAssessment).find(
                ({ until }) => until === member.hint?.weekendPeriod?.until,
              ))
            : undefined;
          const sequence = reference ? member.model.nightSequence : null;
          const nights = sequence
            ? member.model.related.filter(
                ({ date }) => date >= sequence.firstNight && date <= sequence.lastNight,
              )
            : [];
          const startsAt = nights[0]?.startTime ?? undefined;
          const nightPhase =
            sequence && nights.length > 1
              ? {
                  period: checkPeriodLabel(sequence.firstNight, sequence.lastNight),
                  time:
                    startsAt && nights.every(({ startTime }) => startTime === startsAt)
                      ? startsAt
                      : undefined,
                }
              : undefined;
          const children = selectedWeekend ? (
            <WeekendDuties window={selectedWeekend} shifts={member.model.related} />
          ) : member.model.rest ? (
            <View style={{ gap: SPACING.sm }}>
              <CheckRestTimeline
                rest={member.model.rest}
                planning={!!member.hint}
                nightPhase={nightPhase}
              />
              {member.model.related.length > 2 && reference ? (
                <AffectedCheckShifts
                  shifts={member.model.related.filter(
                    ({ id }) =>
                      id !== member.model.rest?.previous.id && id !== member.model.rest?.next.id,
                  )}
                  timeZone={timeZone}
                />
              ) : member.model.related.length > 2 ? (
                <CheckDetailDisclosure title="Betroffene Dienste">
                  <AffectedCheckShifts shifts={member.model.related} timeZone={timeZone} />
                </CheckDetailDisclosure>
              ) : null}
            </View>
          ) : !shareDutyOverview && (member.model.related.length || member.hint?.weekendPeriod) ? (
            <AffectedCheckShifts
              shifts={member.model.related}
              timeZone={timeZone}
              weekendPeriod={member.hint?.weekendPeriod}
            />
          ) : null;
          return member.issue.tariff ? (
            <TariffCheckDetails
              key={member.issue.id}
              evidence={member.issue.tariff}
              title={member.model.title}
              description={member.issue.description}
              missing={member.model.missing}
              shifts={member.model.related}
              timeZone={timeZone}
            />
          ) : member.hint ? (
            <PlanningHintDetails
              key={member.issue.id}
              hint={member.hint}
              icon={planningHintIcon(member.issue.rule)}
              rest={member.model.rest}
              series={member.model.series}
              nightSequence={sequence}
              weekend={selectedWeekend}
              missing={
                selectedWeekend
                  ? selectedWeekend.weekends.some(({ relatedShiftIds }) =>
                      relatedShiftIds.some(
                        (id) => !member.model.related.some((shift) => shift.id === id),
                      ),
                    )
                  : member.model.missing
              }
              originalDescription={member.issue.description}
            >
              {children}
            </PlanningHintDetails>
          ) : (
            <LegalCheckDetails
              key={member.issue.id}
              issue={member.issue}
              title={member.model.title}
              missing={member.model.missing}
              shifts={grouped ? undefined : member.model.related}
              timeZone={timeZone}
            >
              {children}
            </LegalCheckDetails>
          );
        })
      )}
    </View>
  );
}

export function ComplianceIssueContent({
  issue,
  relatedIssues = [],
  occurrence,
  shifts,
  timeZone,
  compact = false,
  inbox = false,
}: {
  readonly issue: ComplianceIssue;
  readonly relatedIssues?: readonly ComplianceIssue[];
  readonly occurrence?: CheckIssueOccurrence;
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone: string;
  readonly compact?: boolean;
  readonly inbox?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const openedSession = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (openedSession.current) invalidateCheckIssueSession(openedSession.current);
    },
    [],
  );
  const openDetails = () => {
    const id = openCheckIssueDetails({
      issue,
      relatedIssues,
      shifts,
      timeZone,
      weekend: occurrence?.weekend,
    });
    if (id) openedSession.current = id;
  };
  const { members, grouped, groupLabel } = checkIssueContext({
    issue,
    relatedIssues,
    shifts,
    timeZone,
  });
  const model = members[0].model;
  const planning = issue.kind === "PLANNING";
  const appearance = checkAppearance(issue, palette);
  const hint = members[0].hint;
  const tariff = issue.kind === "LEGAL" ? issue.tariff : null;
  const needsTariffReview = tariff && tariff.status !== "DEVIATION";
  const tariffPresentation = tariff
    ? tariffCheckPresentation(tariff, issue.title, issue.description)
    : null;
  const title = hint?.title ?? tariffPresentation?.title ?? model.title;
  const { rest, series } = model;
  const compactPlanning = compact && planning;
  const rowTitle =
    inbox && rest && issue.rule === "ARBZG_5_REST_10H"
      ? "Kurze Ruhezeit"
      : occurrence?.weekend
        ? weekendHintTitle(occurrence.weekend.freeCount)
        : (hint?.compactTitle ?? title);
  const rowPeriod =
    hint?.weekendPeriod ??
    (issue.rule === "PLANNING_7_DAYS" && series?.from && series.until
      ? { from: series.from, until: series.until }
      : undefined);
  const rowSummary =
    compactCheckPeriod(rowPeriod) ??
    hint?.compactSummary ??
    (hint ? planningCardSummary(issue, hint).join(" ") : model.note);
  const color =
    planning || needsTariffReview
      ? palette.textMuted
      : issue.severity === "critical"
        ? palette.danger
        : issue.severity === "warning"
          ? palette.warning
          : palette.primary;
  if (inbox) {
    const category = checkCategory(issue);
    const accent =
      category === "legal"
        ? palette.legalCheckBorder
        : category === "tariff"
          ? palette.tariffCheckBorder
          : palette.textMuted;
    const period =
      occurrence?.weekend ??
      tariff?.period ??
      hint?.weekendPeriod ??
      (rest ? { from: rest.endDate, until: rest.startDate } : undefined) ??
      (series?.from && series.until ? { from: series.from, until: series.until } : undefined);
    const recoveryStatus = model.nightSequence?.recoveryStatus;
    const showRest =
      rest && (!recoveryStatus || recoveryStatus === "under24" || recoveryStatus === "under48");
    const subtitle = [
      category === "legal"
        ? "Gesetz"
        : category === "tariff"
          ? tariff?.status === "DEVIATION"
            ? issueCategory(issue)
            : "Tarif"
          : null,
      showRest ? formatCheckRestDuration(rest.minutes) : null,
      compactCheckPeriod(period) ?? checkDate(issue.date, false),
      grouped ? groupLabel : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Pressable
        testID={`check-details-${occurrence?.key ?? issue.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Details ansehen: ${rowTitle}${grouped ? `, ${groupLabel}` : ""}`}
        accessibilityHint={`${issueCategory(issue)}. ${issueSeverity(issue)}.`}
        accessibilityValue={{ text: subtitle }}
        onPress={() => {
          selectionFeedback();
          openDetails();
        }}
        style={({ pressed }) => ({
          minHeight: 67,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.sm,
          borderLeftWidth: 3,
          borderLeftColor: category === "planning" ? "transparent" : accent,
          backgroundColor: pressed ? palette.surfaceMuted : palette.surface,
        })}
      >
        <View
          style={{
            width: 35,
            height: 35,
            borderRadius: RADII.control,
            backgroundColor: palette.surfaceMuted,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Ionicons
            name={
              category === "legal"
                ? rest
                  ? "time-outline"
                  : "alert-circle-outline"
                : category === "tariff"
                  ? "document-text-outline"
                  : planningHintIcon(issue.rule)
            }
            size={18}
            color={accent}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
          <Text style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}>{rowTitle}</Text>
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{subtitle}</Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={palette.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
    );
  }
  return (
    <View
      testID={`check-details-${issue.id}`}
      style={
        compactPlanning
          ? undefined
          : {
              borderCurve: CORNER_CURVE,
              gap: SPACING.sm,
              backgroundColor: palette.surfaceRaised,
              borderRadius: RADII.card,
              padding: SPACING.lg,
              ...appearance.cardStyle,
            }
      }
    >
      {compactPlanning ? (
        <Pressable
          testID={`planning-hint-row-${issue.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Details ansehen: ${rowTitle}`}
          accessibilityValue={{ text: rowSummary }}
          accessibilityHint={`${issueCategory(issue)}. Zeigt die Erklärung, zugehörige Dienste und verfügbare Quellen`}
          onPress={() => {
            selectionFeedback();
            openDetails();
          }}
          style={({ pressed }) => ({
            minHeight: MINIMUM_TOUCH_TARGET,
            flexDirection: "row",
            alignItems: "center",
            gap: SPACING.sm,
            paddingVertical: SPACING.md,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <View style={{ flex: 1, minWidth: 0, gap: SPACING.xs }}>
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ color: palette.text, ...TYPOGRAPHY.body, fontWeight: "500" }}
            >
              {rowTitle}
            </Text>
            {rowSummary ? (
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}
              >
                {rowSummary}
              </Text>
            ) : null}
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={palette.textMuted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      ) : (
        <>
          <Text style={{ color: appearance.labelColor, ...TYPOGRAPHY.caption }}>
            {issueCategory(issue)}
          </Text>
          <View
            testID={`check-issue-card-heading-${issue.id}`}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm }}
          >
            <Ionicons
              name={
                planning
                  ? planningHintIcon(issue.rule)
                  : !needsTariffReview && issue.severity === "critical"
                    ? "alert-circle-outline"
                    : !needsTariffReview && issue.severity === "warning"
                      ? "warning-outline"
                      : "information-circle-outline"
              }
              size={18}
              color={color}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text
              accessibilityLabel={`${title}, ${checkCategoryLabel(issue)}, ${issueSeverity(issue)}${grouped ? `, ${groupLabel}` : ""}`}
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{
                flex: 1,
                minWidth: 0,
                color: palette.text,
                ...TYPOGRAPHY.body,
                fontWeight: "500",
              }}
            >
              {title}
            </Text>
          </View>
          {!planning && !tariff && rest ? (
            <View style={{ gap: SPACING.sm }} testID={`check-timeline-${issue.id}`}>
              <View
                style={{
                  flexDirection: stacked ? "column" : "row",
                  flexWrap: "wrap",
                  alignItems: stacked ? "stretch" : "center",
                  gap: SPACING.xs,
                }}
              >
                <TimelineEndpoint
                  shift={rest.previous}
                  date={rest.endDate}
                  time={rest.previous.endTime!}
                  action="endet"
                  includeYear={rest.endDate.slice(0, 4) !== rest.startDate.slice(0, 4)}
                  showDate={rest.endDate !== issue.date || rest.startDate !== issue.date}
                />
                {!stacked ? (
                  <Text
                    accessible={false}
                    style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}
                  >
                    →
                  </Text>
                ) : null}
                <TimelineEndpoint
                  shift={rest.next}
                  date={rest.startDate}
                  time={rest.next.startTime!}
                  action="beginnt"
                  includeYear={rest.endDate.slice(0, 4) !== rest.startDate.slice(0, 4)}
                  showDate={rest.endDate !== issue.date || rest.startDate !== issue.date}
                />
              </View>
              <View
                style={{
                  flexDirection: stacked ? "column" : "row",
                  justifyContent: "space-between",
                  gap: SPACING.xs,
                }}
              >
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                  {model.nightSequence ? "Arbeitsfreie Zeit danach" : "Ruhezeit dazwischen"}
                </Text>
                <Text
                  style={{
                    color,
                    ...TYPOGRAPHY.body,
                    fontWeight: "500",
                    fontVariant: ["tabular-nums"],
                  }}
                  accessibilityLabel={`${restDuration(rest.minutes)} ${model.nightSequence ? "arbeitsfreie Zeit" : "Ruhezeit"}`}
                >
                  {restDuration(rest.minutes)}
                </Text>
              </View>
            </View>
          ) : !planning && !tariff && series ? (
            <View style={{ gap: SPACING.sm }} testID={`check-series-${issue.id}`}>
              {series.from && series.until ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    gap: SPACING.sm,
                  }}
                >
                  <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                    {checkDate(series.from, series.from.slice(0, 4) !== series.until.slice(0, 4))}
                  </Text>
                  <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                    {checkDate(series.until, series.from.slice(0, 4) !== series.until.slice(0, 4))}
                  </Text>
                </View>
              ) : (
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                  Zeitraum nicht vollständig verfügbar.
                </Text>
              )}
            </View>
          ) : null}
          {members.map((member, index) => (
            <View
              key={member.issue.id}
              testID={`check-observation-${member.issue.id}`}
              style={{ gap: SPACING.xs }}
            >
              {index > 0 ? (
                <Text style={{ color: palette.text, ...TYPOGRAPHY.body, fontWeight: "500" }}>
                  {member.hint?.title ?? member.model.title}
                </Text>
              ) : null}
              {member.hint ? (
                planningCardSummary(member.issue, member.hint).map((text) => (
                  <Text key={text} style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                    {text}
                  </Text>
                ))
              ) : member.issue.tariff ? null : (
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                  {member.model.rest
                    ? member.model.note
                    : legalCheckPresentation(member.issue).summary}
                </Text>
              )}
            </View>
          ))}
          {tariff ? (
            <View style={{ gap: SPACING.sm }}>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                {tariff.tariffLabel}
              </Text>
              <Text style={{ color, ...TYPOGRAPHY.small, fontWeight: "500" }}>
                {tariffPresentation?.summary}
              </Text>
            </View>
          ) : null}
          {grouped ? (
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>{groupLabel}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Details ansehen: ${title}${grouped ? `, ${groupLabel}` : ""}`}
            accessibilityHint={"Zeigt die Erklärung, zugehörige Dienste und verfügbare Quellen"}
            onPress={() => {
              selectionFeedback();
              openDetails();
            }}
            style={({ pressed }) => ({
              minHeight: MINIMUM_TOUCH_TARGET,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: SPACING.sm,
              borderTopWidth: 1,
              borderTopColor: palette.separator,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
              Details ansehen
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={palette.textMuted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        </>
      )}
    </View>
  );
}

function TimelineEndpoint({
  shift,
  date,
  time,
  action,
  includeYear,
  showDate,
}: {
  readonly shift: ShiftEntry;
  readonly date: string;
  readonly time: string;
  readonly action: "endet" | "beginnt";
  readonly includeYear: boolean;
  readonly showDate: boolean;
}) {
  const palette = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={`${shift.title} ${action}, ${time}, ${checkDate(date)}`}
      style={{ flexShrink: 1, gap: SPACING.xxs }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: SPACING.xs,
        }}
      >
        <Text style={{ flexShrink: 1, color: palette.textMuted, ...TYPOGRAPHY.small }}>
          {shift.title} {action}
        </Text>
        <Text
          style={{ color: palette.textMuted, ...TYPOGRAPHY.small, fontVariant: ["tabular-nums"] }}
        >
          {time}
        </Text>
      </View>
      {showDate ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
          {checkDate(date, includeYear)}
        </Text>
      ) : null}
    </View>
  );
}
