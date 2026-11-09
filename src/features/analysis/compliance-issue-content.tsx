import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Temporal } from "@js-temporal/polyfill";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { ColorBadge } from "@/ui/design-system";
import { selectionFeedback } from "@/ui/haptics";
import { SelectionSheet } from "@/ui/selection-sheet";
import { PlanningHintDetails } from "./planning-hint-details";
import { planningHintPresentation } from "./planning-hint-presentation";
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

function compactShiftDate(date: string, includeYear = false): string {
  try {
    const day = Temporal.PlainDate.from(date);
    return `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.${includeYear ? String(day.year).slice(-2) : ""}`;
  } catch {
    return "Datum nicht verfügbar";
  }
}

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

export function AffectedCheckShifts({ shifts }: { readonly shifts: readonly ShiftEntry[] }) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const largeText = fontScale >= 1.3;
  const includeYear = new Set(shifts.map((shift) => shift.date.slice(0, 4))).size > 1;
  const label = `${shifts.length} ${shifts.length === 1 ? "Dienst" : "Dienste"} ${expanded ? "ausblenden" : "anzeigen"}`;
  return (
    <View testID="check-affected-shifts">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={() => {
          selectionFeedback();
          setExpanded((value) => !value);
        }}
        style={({ pressed }) => ({
          minHeight: MINIMUM_TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: SPACING.sm,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500", flex: 1 }}>
          {label}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={palette.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {expanded ? (
        <View>
          {!largeText ? (
            <View style={{ flexDirection: "row", gap: SPACING.sm, paddingBottom: SPACING.xs }}>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption, width: 58 }}>
                Datum
              </Text>
              <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption, flex: 1 }}>
                Dienst
              </Text>
              <Text
                style={{
                  color: palette.textMuted,
                  ...TYPOGRAPHY.caption,
                  width: 112,
                  textAlign: "right",
                }}
              >
                Uhrzeit
              </Text>
            </View>
          ) : null}
          {shifts.map((shift, index) => {
            let endDate: string | null = null;
            let dayOffset = 0;
            if (!shift.allDay && shift.startTime && shift.endTime) {
              try {
                const offset =
                  shift.specialDuty?.endDay ?? (shift.endTime <= shift.startTime ? 1 : 0);
                if (Number.isSafeInteger(offset) && offset >= 0 && offset <= 14) {
                  dayOffset = offset;
                  endDate = Temporal.PlainDate.from(shift.date).add({ days: offset }).toString();
                }
              } catch {
                // Keep invalid dates/times readable without inventing an end date.
              }
            }
            const splitDuty = shift.specialDuty?.kind === "SPLIT";
            const timeWindow = shift.allDay
              ? "Ganztägig"
              : !shift.startTime || !shift.endTime
                ? "Zeit fehlt"
                : `${shift.startTime}–${shift.endTime}${dayOffset ? ` +${dayOffset}` : ""}`;
            const time = `${timeWindow}${splitDuty ? " · Teilzeiten" : ""}`;
            const spokenTime =
              endDate && shift.startTime && shift.endTime
                ? `${shift.startTime} bis ${dayOffset ? `${checkDate(endDate)}, ` : ""}${shift.endTime}`
                : timeWindow;
            return (
              <View
                key={shift.id}
                testID={`check-shift-${shift.id}`}
                accessible
                accessibilityLabel={`${shift.title}, ${checkDate(shift.date)}, ${splitDuty ? `eingetragenes Zeitfenster ${spokenTime}, mit Teilzeiten` : spokenTime}`}
                style={{
                  minHeight: 40,
                  paddingVertical: SPACING.sm,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: palette.separator,
                  flexDirection: largeText ? "column" : "row",
                  alignItems: largeText ? "stretch" : "center",
                  gap: largeText ? SPACING.xs : SPACING.sm,
                }}
              >
                <Text
                  style={{
                    color: palette.textMuted,
                    ...TYPOGRAPHY.caption,
                    ...(largeText ? {} : { width: 58 }),
                  }}
                >
                  {compactShiftDate(shift.date, includeYear)}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.xs,
                    minWidth: 0,
                    ...(largeText ? {} : { flex: 1 }),
                  }}
                >
                  <ColorBadge color={shift.color} label={shift.symbol} size={16} />
                  <Text
                    style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500", flex: 1 }}
                  >
                    {shift.title}
                  </Text>
                </View>
                <Text
                  style={{
                    color: palette.textMuted,
                    ...TYPOGRAPHY.small,
                    fontVariant: ["tabular-nums"],
                    ...(largeText ? {} : { width: 112, textAlign: "right" }),
                  }}
                >
                  {time}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Original windows stay available while one shared service list avoids repeated content. */
export function TariffObservationDetails({
  issues,
  shifts,
  embedded = false,
}: {
  readonly issues: readonly ComplianceIssue[];
  readonly shifts: readonly ShiftEntry[];
  readonly embedded?: boolean;
}) {
  const palette = usePalette();
  const byId = new Map<string, ShiftEntry | null>();
  for (const shift of shifts) byId.set(shift.id, byId.has(shift.id) ? null : shift);
  const members = issues.map((issue) => {
    const ids = [...new Set(issue.relatedShiftIds)];
    const related = ids
      .map((id) => byId.get(id))
      .filter((shift): shift is ShiftEntry => !!shift && shift.deletedAt === null);
    return { issue, related, missing: related.length !== ids.length };
  });
  const grouped = members.length > 1;
  const services = [
    ...new Map(
      members.flatMap((member) => member.related).map((shift) => [shift.id, shift]),
    ).values(),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.id.localeCompare(b.id),
  );
  const original = (member: (typeof members)[number]) =>
    member.issue.tariff ? (
      <View key={member.issue.id} testID={`check-original-issue-${member.issue.id}`}>
        <TariffCheckDetails
          evidence={member.issue.tariff}
          title={member.issue.title}
          description={member.issue.description}
          missing={member.missing}
          embedded={embedded}
          hideServices={grouped}
        >
          {!grouped && member.related.length ? (
            <AffectedCheckShifts shifts={member.related} />
          ) : null}
        </TariffCheckDetails>
      </View>
    ) : null;
  return (
    <View style={{ gap: SPACING.md }}>
      {members[0] ? original(members[0]) : null}
      {grouped ? (
        <View style={{ paddingHorizontal: embedded ? 0 : SPACING.lg }}>
          <CheckDetailDisclosure title={`Weitere Zeiträume (${members.length - 1})`}>
            {members.slice(1).map(original)}
          </CheckDetailDisclosure>
          <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
            Zugehörige Dienste
          </Text>
          {services.length ? <AffectedCheckShifts shifts={services} /> : null}
          {members.some((member) => member.missing) ? (
            <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
              Einige zugehörige Dienste sind nicht mehr verfügbar.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ComplianceIssueContent({
  issue,
  relatedIssues = [],
  shifts,
  timeZone,
  compact = false,
}: {
  readonly issue: ComplianceIssue;
  readonly relatedIssues?: readonly ComplianceIssue[];
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone: string;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const [showDetails, setShowDetails] = useState(false);
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
  const model = members[0].model;
  const planning = issue.kind === "PLANNING";
  const tariffCategory = checkCategory(issue) === "tariff";
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
  const rowTitle = hint?.compactTitle ?? title;
  const rowPeriod =
    hint?.weekendPeriod ??
    (issue.rule === "PLANNING_7_DAYS" && series?.from && series.until
      ? { from: series.from, until: series.until }
      : undefined);
  const rowSummary =
    compactCheckPeriod(rowPeriod) ??
    hint?.compactSummary ??
    (hint ? planningCardSummary(issue, hint).join(" ") : model.note);
  const grouped = members.length > 1;
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
  const color =
    planning || needsTariffReview
      ? palette.textMuted
      : issue.severity === "critical"
        ? palette.danger
        : issue.severity === "warning"
          ? palette.warning
          : palette.primary;
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
            setShowDetails(true);
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
                planning || needsTariffReview
                  ? "information-circle-outline"
                  : issue.severity === "critical"
                    ? "alert-circle-outline"
                    : issue.severity === "warning"
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
              setShowDetails(true);
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
      {showDetails ? (
        <SelectionSheet
          title={
            grouped
              ? "Details zu den Prüfpunkten"
              : tariffCategory
                ? "Details zur Tarifprüfung"
                : planning
                  ? "Details zum Hinweis"
                  : "Details zur gesetzlichen Prüfung"
          }
          visible
          cancelLabel="Schließen"
          onClose={() => setShowDetails(false)}
        >
          {() => (
            <View style={{ gap: SPACING.md }}>
              {tariff ? (
                <TariffObservationDetails
                  issues={members.map((member) => member.issue)}
                  shifts={shifts}
                />
              ) : (
                members.map((member) => {
                  const children =
                    !grouped && member.model.related.length ? (
                      <AffectedCheckShifts shifts={member.model.related} />
                    ) : null;
                  return member.issue.tariff ? (
                    <TariffCheckDetails
                      key={member.issue.id}
                      evidence={member.issue.tariff}
                      title={member.model.title}
                      description={member.issue.description}
                      missing={member.model.missing}
                    >
                      {children}
                    </TariffCheckDetails>
                  ) : member.hint ? (
                    <PlanningHintDetails
                      key={member.issue.id}
                      hint={member.hint}
                      rest={member.model.rest}
                      series={member.model.series}
                      missing={member.model.missing}
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
                    >
                      {children}
                    </LegalCheckDetails>
                  );
                })
              )}
              {grouped && !tariff && allRelated.length ? (
                <View style={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}>
                  <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
                    Zugehörige Dienste
                  </Text>
                  <AffectedCheckShifts shifts={allRelated} />
                </View>
              ) : null}
            </View>
          )}
        </SelectionSheet>
      ) : null}
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
