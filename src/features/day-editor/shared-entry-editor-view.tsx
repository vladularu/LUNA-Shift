import { useState } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { Temporal } from "@js-temporal/polyfill";
import { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { sharedCalendarDays } from "@/features/calendar/shared-calendar-display";
import { EntryEditOverlayFrame } from "./entry-edit-overlay-frame";
import { EntryEditGroup, EntryEditValueRow } from "./entry-edit-fields";
import { LoadFailureView } from "@/ui/loading-view";
import { SharedShiftSymbol } from "@/ui/shared-shift-symbol";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { accessibleChipBackgroundColor } from "@/theme/color-contrast";

/** Same editor frame and fields; foreign records never enter the local editing form. */
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
  const start = Temporal.Instant.from(row.entry.startsAt).toZonedDateTimeISO(
    row.entry.allDay ? row.entry.timeZone : timeZone,
  );
  const end = Temporal.Instant.from(row.entry.endsAt).toZonedDateTimeISO(
    row.entry.allDay ? row.entry.timeZone : timeZone,
  );
  const clock = (value: Temporal.ZonedDateTime) =>
    `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  const headerColor = palette.dark
    ? row.entry.color
    : accessibleChipBackgroundColor(row.entry.color);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <EntryEditOverlayFrame
        busy={false}
        date={date}
        durationMinutes={null}
        error={null}
        headerColor={headerColor}
        headerSubtitle={row.entry.title}
        headerLeading={<SharedShiftSymbol value={row.entry.symbol} color={headerColor} size={22} />}
        onDismiss={() => router.back()}
        onRequestClose={async () => true}
        testIDPrefix="shift-edit"
        cardContent={
          <View style={{ padding: SPACING.md, gap: SPACING.md }}>
            <EntryEditGroup testID="shared-edit-service-group">
              <EntryEditValueRow label="Dienst" value={row.entry.title} separator={false} />
            </EntryEditGroup>
            <EntryEditGroup testID="shift-edit-time-group">
              {row.entry.allDay ? (
                <EntryEditValueRow label="Dauer" value="Ganztägig" separator={false} />
              ) : (
                <>
                  <EntryEditValueRow label="Beginn" value={clock(start)} />
                  <EntryEditValueRow
                    label="Ende"
                    value={
                      clock(end) +
                      (start.toPlainDate().equals(end.toPlainDate())
                        ? ""
                        : ` · ${String(end.day).padStart(2, "0")}.${String(end.month).padStart(2, "0")}.`)
                    }
                    separator={false}
                  />
                </>
              )}
            </EntryEditGroup>
            <EntryEditGroup testID="shared-edit-calendar-group">
              <EntryEditValueRow label="Kalender" value={row.calendarName} separator={false} />
            </EntryEditGroup>
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
              Geteilter Dienst · nur ansehen
            </Text>
            {row.entry.note ? (
              <EntryEditGroup testID="shared-edit-note-group">
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>Notizen</Text>
                <Text selectable style={{ ...TYPOGRAPHY.body, color: palette.text }}>
                  {row.entry.note}
                </Text>
              </EntryEditGroup>
            ) : null}
          </View>
        }
      />
    </>
  );
}
