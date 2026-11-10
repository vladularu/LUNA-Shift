import { Temporal } from "@js-temporal/polyfill";
import { ScrollView, View, useWindowDimensions } from "react-native";
import type { ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { ColorBadge } from "@/ui/design-system";
import { Text } from "@/ui/text";

const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const fullWeekdays = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];
const months = [
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
const spokenDate = (date: Temporal.PlainDate) =>
  `${date.day}. ${months[date.month - 1]} ${date.year}`;
interface DutyCell {
  key: string;
  weekday: string;
  label: string;
  spoken: string;
  duties: {
    id: string;
    title: string;
    color: string;
    symbol: string;
    spoken: string;
  }[];
}

/** Shared read-only duty calendar. Only primitive values cross into native views. */
export function CheckDutyOverview({
  shifts,
  dates,
  compact,
  testID = "check-duty-overview",
}: {
  readonly shifts: readonly ShiftEntry[];
  readonly dates?: readonly string[];
  readonly compact?: boolean;
  readonly timeZone?: string;
  readonly testID?: string;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  let cells: DutyCell[], period: string | null;
  try {
    const ordered = shifts
      .filter((shift) => shift.deletedAt === null)
      .slice()
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
          a.id.localeCompare(b.id),
      );
    let keys = [...new Set(dates ?? ordered.map((shift) => shift.date))].sort();
    if (!keys.length) return null;
    const first = Temporal.PlainDate.from(keys[0]),
      last = Temporal.PlainDate.from(keys.at(-1)!);
    const count = last.since(first).days + 1;
    if (!dates && count <= 14)
      keys = Array.from({ length: count }, (_, offset) => first.add({ days: offset }).toString());
    const years = first.year !== last.year;
    const format = (date: Temporal.PlainDate) =>
      `${String(date.day).padStart(2, "0")}.${String(date.month).padStart(2, "0")}.${years ? date.year : ""}`;
    period =
      !dates && keys.length > 3
        ? `${format(first)}–${format(last)}${years ? "" : first.year}`
        : null;
    cells = keys.map((key) => {
      const date = Temporal.PlainDate.from(key);
      const duties = ordered
        .filter((shift) => shift.date === key)
        .map((shift) => {
          const offset =
            shift.specialDuty?.endDay ??
            (shift.startTime && shift.endTime && shift.endTime <= shift.startTime ? 1 : 0);
          const validOffset =
            Number.isSafeInteger(offset) && offset >= 0 && offset <= 14 ? offset : 0;
          const split = shift.specialDuty?.kind === "SPLIT";
          const end = Temporal.PlainDate.from(shift.date).add({ days: validOffset });
          const time = shift.allDay
            ? "Ganztägig"
            : !shift.startTime || !shift.endTime
              ? "Zeit fehlt"
              : `${shift.startTime}–${shift.endTime}${validOffset ? ` +${validOffset}` : ""}${split ? " · Teilzeiten" : ""}`;
          const spokenTime =
            shift.allDay || !shift.startTime || !shift.endTime
              ? time
              : `${shift.startTime} bis ${validOffset ? `${spokenDate(end)}, ` : ""}${shift.endTime}`;
          return {
            id: shift.id,
            title: shift.title,
            color: shift.color,
            symbol: shift.symbol,
            spoken: `${shift.title}, ${spokenDate(Temporal.PlainDate.from(shift.date))}, ${split ? "eingetragenes Zeitfenster " : ""}${spokenTime}${split ? ", mit Teilzeiten" : ""}`,
          };
        });
      return {
        key,
        weekday: fullWeekdays[date.dayOfWeek - 1],
        label: format(date),
        spoken: `${fullWeekdays[date.dayOfWeek - 1]}, ${spokenDate(date)}`,
        duties,
      };
    });
  } catch {
    return null;
  }
  const small = compact ?? cells.length > 3;
  const scroll = fontScale >= 1.3 || width < 340;
  const columns = small ? 7 : Math.min(cells.length, 3);
  const rows = Array.from({ length: Math.ceil(cells.length / columns) }, (_, i) =>
    cells.slice(i * columns, (i + 1) * columns),
  );
  const symbolSize = 18;
  const maxDuties = Math.max(1, ...cells.map((day) => day.duties.length));
  const columnStyle = {
    flex: scroll ? undefined : 1,
    minWidth: scroll ? (small ? 52 : 148) * fontScale : 0,
  };
  const content = (
    <View testID={testID} style={{ gap: SPACING.sm }}>
      {period ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{period}</Text>
      ) : null}
      {rows.map((row) => (
        <View key={row[0].key} style={{ flexDirection: "row", gap: SPACING.xxs }}>
          {row.map((day) => (
            <View
              key={day.key}
              testID={`${testID}-${day.key}`}
              accessible={small}
              accessibilityLabel={
                small
                  ? `${day.spoken}. ${day.duties.map((duty) => duty.spoken).join("; ") || "Kein Dienstbeginn erfasst"}`
                  : undefined
              }
              style={{
                ...columnStyle,
                alignItems: small ? "center" : "stretch",
                gap: SPACING.xs,
                paddingVertical: SPACING.md,
                paddingHorizontal: small ? SPACING.xxs : SPACING.sm,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: RADII.small,
              }}
            >
              <Text
                style={{ color: palette.textMuted, ...TYPOGRAPHY.caption, textAlign: "center" }}
              >
                {small ? weekdays[fullWeekdays.indexOf(day.weekday)] : day.weekday}
              </Text>
              <Text style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong, textAlign: "center" }}>
                {small ? day.label.slice(0, 2).replace(/^0/, "") : day.label}
              </Text>
              {small ? (
                <View
                  style={{
                    alignItems: "center",
                    gap: SPACING.xxs,
                    minHeight: maxDuties * symbolSize + (maxDuties - 1) * SPACING.xxs,
                  }}
                >
                  {day.duties.length ? (
                    day.duties.map((duty, index) => (
                      <View
                        key={`${duty.id}-${index}`}
                        testID={`check-shift-${duty.id}`}
                        accessibilityLabel={duty.spoken}
                      >
                        <View testID={`check-duty-symbol-${day.key}-${duty.id}`}>
                          <ColorBadge color={duty.color} label={duty.symbol} size={symbolSize} />
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>–</Text>
                  )}
                </View>
              ) : day.duties.length ? (
                day.duties.map((duty, index) => (
                  <View
                    key={`${duty.id}-${index}`}
                    testID={`check-shift-${duty.id}`}
                    accessible
                    accessibilityLabel={duty.spoken}
                    style={{ flexDirection: "column", gap: SPACING.xxs, paddingTop: SPACING.xs }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xs }}>
                      <ColorBadge color={duty.color} label={duty.symbol} size={18} />
                      <Text
                        style={{
                          color: palette.text,
                          ...TYPOGRAPHY.small,
                          fontWeight: "500",
                          flex: 1,
                        }}
                      >
                        {duty.title}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text
                  style={{ color: palette.textMuted, ...TYPOGRAPHY.small, textAlign: "center" }}
                >
                  Kein Dienstbeginn
                </Text>
              )}
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, index) => (
            <View
              key={`empty-${index}`}
              testID={`${testID}-spacer-${row[0].key}-${index}`}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={columnStyle}
            />
          ))}
        </View>
      ))}
    </View>
  );
  return scroll ? (
    <ScrollView horizontal accessibilityLabel="Betroffene Tage, horizontal scrollbar">
      {content}
    </ScrollView>
  ) : (
    content
  );
}
