import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/ui/text";
import { SelectionSheet } from "@/ui/selection-sheet";
import { CardSeparator, RowButton, SurfaceCard } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import { CALENDAR_METRICS, CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { calendarChipPalette } from "@/theme/color-contrast";
import { formatDateTitle } from "@/engine/calendar";
import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import type { CalendarEntry } from "@/domain/types";
import { router } from "expo-router";
import { dayEditorRoute, quickAddRoute } from "@/navigation/routes";

/** A separate touch target; opening it cannot invoke the own-day editor or stamp. */
export function SharedCalendarDayMark({
  date,
  entries,
  onPress,
}: {
  readonly date: string;
  readonly entries: readonly SharedCalendarDayEntry[];
  readonly onPress: (date: string) => void;
}) {
  const palette = usePalette();
  const first = entries[0];
  if (!first) return null;
  const color = calendarChipPalette(first.entry.color, palette.dark);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entries.length} geteilte Einträge am ${formatDateTitle(date)}, ${entries
        .slice(0, 3)
        .map((row) => `${row.calendarName}: ${row.entry.title}, ${row.when}`)
        .join("; ")}`}
      accessibilityHint="Öffnet schreibgeschützte Kalenderdetails."
      testID={`shared-calendar-day-${date}`}
      onPress={(event) => {
        event.stopPropagation();
        onPress(date);
      }}
      style={({ pressed }) => ({
        minHeight: 34,
        justifyContent: "center",
        marginHorizontal: CALENDAR_METRICS.chipHorizontalInset,
        paddingHorizontal: CALENDAR_METRICS.chipHorizontalInset,
        borderRadius: RADII.small,
        borderCurve: CORNER_CURVE,
        borderLeftWidth: 3,
        borderLeftColor: first.calendarColor,
        backgroundColor: color.detail,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{
          fontSize: CALENDAR_METRICS.entryFontSize,
          color: color.onDetail,
          fontWeight: "500",
        }}
      >
        {first.entry.title}
      </Text>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: CALENDAR_METRICS.entryFontSize, color: color.onDetail }}
      >
        {first.entry.allDay ? "GT" : first.when.split("–")[0]}
        {entries.length > 1 ? ` +${entries.length - 1}` : ""}
      </Text>
    </Pressable>
  );
}
export function SharedCalendarDaySheet({
  date,
  entries,
  onClose,
  ownEntries = [],
}: {
  readonly date: string | null;
  readonly entries: readonly SharedCalendarDayEntry[];
  readonly onClose: () => void;
  readonly ownEntries?: readonly CalendarEntry[];
}) {
  const palette = usePalette();
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [date]);
  const lastPage = Math.max(0, Math.ceil(entries.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageEntries = entries.slice(currentPage * 25, currentPage * 25 + 25);
  return (
    <SelectionSheet
      visible={date !== null}
      title={date ? formatDateTitle(date) : "Geteilter Kalender"}
      closeInHeader
      onClose={onClose}
    >
      {() => (
        <View style={{ gap: SPACING.md }}>
          <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
            Dein Tag · geteilte Dienste nur ansehen
          </Text>
          {ownEntries.map((entry) => (
            <SurfaceCard key={entry.id}>
              <RowButton
                title={entry.title}
                subtitle={`Du · ${entry.allDay ? "Ganztägig" : `${entry.startTime}–${entry.endTime}`}`}
                onPress={() => {
                  onClose();
                  router.push(dayEditorRoute(entry.date, entry.kind, entry.id));
                }}
              />
            </SurfaceCard>
          ))}
          {entries.length === 0 ? (
            <Text style={{ ...TYPOGRAPHY.body, color: palette.text }}>
              Für diesen Tag sind keine geteilten Einträge verfügbar.
            </Text>
          ) : (
            pageEntries.map((row, index) => (
              <SurfaceCard key={`${row.calendarId}:${row.entry.id}:${index}`}>
                <View style={{ padding: SPACING.md, gap: SPACING.sm }}>
                  <Text style={{ ...TYPOGRAPHY.caption, color: palette.textSecondary }}>
                    {row.calendarName}
                  </Text>
                  <Text style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}>
                    {row.entry.title}
                  </Text>
                  <Text style={{ ...TYPOGRAPHY.body, color: palette.text }}>{row.when}</Text>
                  <CardSeparator />
                  <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                    Stand:{" "}
                    {new Date(row.fetchedAt).toLocaleString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </Text>
                </View>
              </SurfaceCard>
            ))
          )}
          {lastPage > 0 ? (
            <SurfaceCard>
              <View style={{ padding: SPACING.md }}>
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  {currentPage * 25 + 1}–{Math.min(entries.length, currentPage * 25 + 25)} von{" "}
                  {entries.length} Einträgen
                </Text>
              </View>
              {currentPage > 0 ? (
                <RowButton title="Vorherige Einträge" onPress={() => setPage(currentPage - 1)} />
              ) : null}
              {currentPage < lastPage ? (
                <RowButton title="Weitere Einträge" onPress={() => setPage(currentPage + 1)} />
              ) : null}
            </SurfaceCard>
          ) : null}
          {date ? (
            <RowButton
              title="Eigenen Dienst hinzufügen"
              onPress={() => {
                onClose();
                router.push(quickAddRoute(date));
              }}
            />
          ) : null}
        </View>
      )}
    </SelectionSheet>
  );
}
