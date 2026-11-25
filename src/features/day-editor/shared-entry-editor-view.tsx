import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import { Temporal } from "@js-temporal/polyfill";
import { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { sharedCalendarDays } from "@/features/calendar/shared-calendar-display";
import { sharedShiftNetMinutes } from "@/features/calendar/shared-shift-detail";
import { EntryEditOverlayFrame } from "./entry-edit-overlay-frame";
import { EntryEditGroup, EntryEditValueRow } from "./entry-edit-fields";
import { LoadFailureView } from "@/ui/loading-view";
import { SharedShiftSymbol } from "@/ui/shared-shift-symbol";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { accessibleChipBackgroundColor } from "@/theme/color-contrast";

/** Foreign records stay in the read-only overview. */
export function SharedEntryEditorView({
  date,
  calendarId,
  entryId,
}: {
  readonly date: string;
  readonly calendarId: string;
  readonly entryId: string;
}) {
  const palette = usePalette();
  const calendars = useVisibleSharedCalendars();
  const { profile } = usePflegeShiftProfile();
  const [accountId] = useState(calendars[0]?.accountId);
  const timeZone = profile?.timeZone ?? "Europe/Berlin";
  const row =
    accountId === calendars[0]?.accountId
      ? sharedCalendarDays(calendars, timeZone, null)
          .get(date)
          ?.find((item) => item.calendarId === calendarId && item.entry.id === entryId)
      : undefined;
  if (!row)
    return (
      <LoadFailureView
        title="Dienst nicht mehr verfügbar"
        message="Die Freigabe ist nicht mehr verfügbar."
        actionLabel="Schließen"
        onRetry={() => router.back()}
      />
    );
  const { entry } = row;
  const start = Temporal.Instant.from(entry.startsAt).toZonedDateTimeISO(timeZone);
  const end = Temporal.Instant.from(entry.endsAt).toZonedDateTimeISO(timeZone);
  const clock = (value: Temporal.ZonedDateTime) =>
    value.toPlainTime().toString({ smallestUnit: "minute" });
  const endsAnotherDay = !entry.allDay && !start.toPlainDate().equals(end.toPlainDate());
  const endDate = `${String(end.day).padStart(2, "0")}.${String(end.month).padStart(2, "0")}.`;
  const appointment = entry.kind === "APPOINTMENT";
  const durationMinutes =
    appointment && !entry.allDay
      ? Math.round((end.epochMilliseconds - start.epochMilliseconds) / 60_000)
      : sharedShiftNetMinutes(entry);
  const sharedLabel = appointment
    ? "Geteilter Termin"
    : entry.kind === "SHIFT"
      ? "Geteilter Dienst"
      : "Geteilter Eintrag";
  const headerColor = palette.dark ? entry.color : accessibleChipBackgroundColor(entry.color);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <EntryEditOverlayFrame
        busy={false}
        date={date}
        durationMinutes={null}
        error={null}
        headerColor={headerColor}
        headerSubtitle={entry.title}
        headerLeading={<SharedShiftSymbol value={entry.symbol} color={headerColor} size={22} />}
        hideHeaderDuration
        nativePresentation={false}
        onDismiss={() => router.back()}
        onRequestClose={async () => true}
        readOnly
        testIDPrefix="shift-edit"
        cardContent={
          <View style={styles.content}>
            <View style={styles.overview} testID="shared-entry-overview">
              <Text
                accessibilityRole="header"
                style={[TYPOGRAPHY.highlightValue, styles.centered, { color: palette.text }]}
              >
                {entry.allDay ? "Ganztägig" : `${clock(start)} – ${clock(end)}`}
              </Text>
              {endsAnotherDay ? (
                <Text style={[TYPOGRAPHY.small, styles.centered, { color: palette.textMuted }]}>
                  {`Ende am ${endDate}`}
                </Text>
              ) : null}
              {durationMinutes !== null ? (
                <>
                  <Text style={[TYPOGRAPHY.screenTitle, styles.centered, { color: palette.text }]}>
                    {`${Math.floor(durationMinutes / 60)} h ${durationMinutes % 60} min`}
                  </Text>
                  <Text style={[TYPOGRAPHY.small, styles.centered, { color: palette.textMuted }]}>
                    {appointment ? "Dauer" : `Arbeitszeit · ${entry.breakMinutes} Min. Pause`}
                  </Text>
                </>
              ) : null}
            </View>
            <EntryEditGroup testID="shared-edit-calendar-group">
              <EntryEditValueRow label="Kalender" value={row.calendarName} separator={false} />
            </EntryEditGroup>
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
              {`${sharedLabel} · nur ansehen`}
            </Text>
            {entry.note ? (
              <EntryEditGroup testID="shared-edit-note-group">
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>Notizen</Text>
                <Text selectable style={{ ...TYPOGRAPHY.body, color: palette.text }}>
                  {entry.note}
                </Text>
              </EntryEditGroup>
            ) : null}
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACING.md, gap: SPACING.md },
  overview: { paddingVertical: SPACING.sm, gap: SPACING.xs },
  centered: { textAlign: "center", fontVariant: ["tabular-nums"] },
});
