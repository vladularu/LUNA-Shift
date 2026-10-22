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
import { complianceTimeline, restDuration } from "./compliance-timeline";

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
  issue.kind === "PLANNING" ? "Planung" : "Gesetzlich";
export const issueSeverity = (issue: ComplianceIssue) =>
  issue.severity === "critical" ? "Kritisch" : issue.severity === "warning" ? "Warnung" : "Hinweis";

function compactShiftDate(date: string): string {
  try {
    const day = Temporal.PlainDate.from(date);
    return `${String(day.day).padStart(2, "0")}.${String(day.month).padStart(2, "0")}.${day.year}`;
  } catch {
    return "Datum nicht verfügbar";
  }
}

export function AffectedCheckShifts({ shifts }: { readonly shifts: readonly ShiftEntry[] }) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  return (
    <View testID="check-affected-shifts">
      {shifts.map((shift, index) => {
        const time =
          shift.allDay || !shift.startTime || !shift.endTime
            ? "Ganztägig"
            : `${shift.startTime}–${shift.endTime}`;
        return (
          <View
            key={shift.id}
            testID={`check-shift-${shift.id}`}
            accessible
            accessibilityLabel={`${shift.title}, ${checkDate(shift.date)}, ${time}`}
            style={{
              minHeight: 50,
              paddingVertical: SPACING.sm + SPACING.xxs,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: palette.separator,
              flexDirection: "row",
              alignItems: "center",
              gap: SPACING.sm,
            }}
          >
            <ColorBadge color={shift.color} label={shift.symbol} size={20} />
            <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
              <Text style={{ color: palette.text, ...TYPOGRAPHY.body, fontWeight: "500" }}>
                {shift.title}
              </Text>
              <View
                style={{
                  flexDirection: fontScale >= 1.3 ? "column" : "row",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  gap: SPACING.xs,
                }}
              >
                <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                  {compactShiftDate(shift.date)}
                </Text>
                <Text
                  style={{
                    color: palette.textMuted,
                    ...TYPOGRAPHY.small,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {time}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ComplianceIssueContent({
  issue,
  shifts,
  timeZone,
}: {
  readonly issue: ComplianceIssue;
  readonly shifts: readonly ShiftEntry[];
  readonly timeZone: string;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const [showShifts, setShowShifts] = useState(false);
  const model = complianceTimeline(issue, shifts, timeZone);
  const { rest, series } = model;
  const color =
    issue.severity === "critical"
      ? palette.danger
      : issue.severity === "warning"
        ? palette.warning
        : palette.primary;
  return (
    <View
      testID={`check-details-${issue.id}`}
      style={{
        borderCurve: CORNER_CURVE,
        gap: SPACING.sm,
        backgroundColor: palette.surfaceRaised,
        borderRadius: RADII.card,
        padding: SPACING.lg,
      }}
    >
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
        {issueCategory(issue)}
      </Text>
      <View
        testID={`check-issue-card-heading-${issue.id}`}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm }}
      >
        <Ionicons
          name={
            issue.severity === "critical"
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
          accessibilityLabel={`${model.title}, ${issueCategory(issue)}, ${issueSeverity(issue)}`}
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            flex: 1,
            minWidth: 0,
            color: palette.text,
            ...TYPOGRAPHY.body,
            fontWeight: "500",
          }}
        >
          {model.title}
        </Text>
      </View>
      {rest ? (
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
              <Text accessible={false} style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
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
              Ruhezeit dazwischen
            </Text>
            <Text
              style={{
                color,
                ...TYPOGRAPHY.body,
                fontWeight: "500",
                fontVariant: ["tabular-nums"],
              }}
              accessibilityLabel={`${restDuration(rest.minutes)} Ruhezeit`}
            >
              {restDuration(rest.minutes)}
            </Text>
          </View>
        </View>
      ) : series ? (
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
      {!series ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{model.note}</Text>
      ) : null}
      {model.missing ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
          Einige zugehörige Dienste sind nicht mehr verfügbar.
        </Text>
      ) : null}
      {model.related.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dienste ansehen: ${issue.title}, ${model.related.length} Dienste`}
          accessibilityHint="Öffnet die betroffenen Dienste in einem Fenster von unten"
          onPress={() => {
            selectionFeedback();
            setShowShifts(true);
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
            Dienste ansehen
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={palette.textMuted}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      ) : null}
      {showShifts ? (
        <SelectionSheet
          title="Betroffene Dienste"
          visible={showShifts}
          cancelLabel="Schließen"
          titleWeight="500"
          onClose={() => setShowShifts(false)}
        >
          {() => (
            <View style={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm }}>
              <AffectedCheckShifts shifts={model.related} />
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
