import type { SharedCalendarDayEntry } from "./shared-calendar-display";
import { Text } from "@/ui/text";
import { CORNER_CURVE, SHADOWS, RADII } from "@/theme/tokens";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import Animated from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CalendarEntry } from "@/domain/types";
import { calculateTimedShiftMinutes } from "@/engine/working-time";
import { entryEditDurationLabel } from "@/features/day-editor/entry-edit-overlay-pattern";
import {
  calculateCalendarPopupPlacement,
  type CalendarAnchorRect,
} from "@/features/calendar/calendar-layout";
import type { QuickEntryAction } from "@/features/calendar/quick-entry-actions";
import { accessibleChipBackgroundColor, chipTextColor } from "@/theme/color-contrast";
import { useInversePalette } from "@/theme/palette";
import { quickEntryAnchorMotion } from "./quick-entry-motion";
import { useQuickEntryPopupMotion } from "./use-quick-entry-popup-motion";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { scheduleAccessibilityFocus } from "@/ui/accessibility-focus";
import { ShiftSymbol } from "@/ui/shift-symbol";
import { SharedShiftSymbol } from "@/ui/shared-shift-symbol";

const HOLIDAY_HEADER_HEIGHT = 28;
const ENTRY_ROW_HEIGHT = 60;
const OVERFLOW_ROW_HEIGHT = 30;
const ACTION_ROW_HEIGHT = 56;

function compactDate(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function entrySubtitle(entry: CalendarEntry): string {
  const location = entry.location?.name;
  if (entry.kind === "APPOINTMENT") {
    const time = entry.allDay ? "Ganztägig" : `${entry.startTime}–${entry.endTime}`;
    return location ? `${time} · ${location}` : time;
  }
  const time =
    entry.allDay || entry.startTime === null || entry.endTime === null
      ? "Ganztägig"
      : `${entry.startTime}–${entry.endTime}`;
  return location ? `${time} · ${location}` : time;
}

function entryDuration(entry: CalendarEntry, timeZone: string): string | null {
  if (entry.allDay || entry.startTime === null || entry.endTime === null) return null;
  if (entry.kind === "SHIFT" && ["VACATION", "SICK", "FREE"].includes(entry.type)) return null;
  return entryEditDurationLabel(
    calculateTimedShiftMinutes(
      {
        ...entry,
        breakMinutes: entry.kind === "SHIFT" ? entry.breakMinutes : 0,
      },
      timeZone,
    ),
  );
}

export const QuickEntryPopup = memo(function QuickEntryPopup({
  actions,
  active = true,
  animateEntry = true,
  windowOverlay = true,
  anchor,
  busy,
  date,
  timeZone = "Europe/Berlin",
  entries,
  sharedEntries = [],
  onOpenSharedEntry,
  holidayName,
  onClose,
  onOpenEntry,
  onOpenDetails,
  onOpenShiftPicker,
  onSelectAction,
}: {
  readonly actions: readonly QuickEntryAction[];
  readonly active?: boolean;
  readonly animateEntry?: boolean;
  readonly windowOverlay?: boolean;
  readonly anchor: CalendarAnchorRect;
  readonly busy: boolean;
  readonly date: string;
  readonly timeZone?: string;
  readonly entries: readonly CalendarEntry[];
  readonly sharedEntries?: readonly SharedCalendarDayEntry[];
  readonly onOpenSharedEntry?: (row: SharedCalendarDayEntry, date: string) => void;
  readonly holidayName?: string;
  readonly onClose: () => void;
  readonly onOpenEntry: (entry: CalendarEntry) => void;
  readonly onOpenDetails: (date: string) => void;
  readonly onOpenShiftPicker: (date: string) => void;
  readonly onSelectAction: (action: QuickEntryAction, date: string) => void;
}) {
  const palette = useInversePalette();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const dialogHeadingRef = useRef<View>(null);
  const layoutScale = Math.max(1, fontScale);
  const entryRowHeight = Math.ceil(ENTRY_ROW_HEIGHT * layoutScale);
  const overflowRowHeight = Math.ceil(OVERFLOW_ROW_HEIGHT * layoutScale);
  const actionRowHeight = Math.ceil(ACTION_ROW_HEIGHT * layoutScale);
  const popupWidth = Math.min(420, width - 24);
  const [entryLimit, setEntryLimit] = useState(25);
  const popupRows = [
    ...entries.map((entry) => ({
      key: entry.kind + ":" + entry.id,
      title: entry.title,
      color: entry.color,
      symbol: entry.kind === "SHIFT" ? entry.symbol : null,
      subtitle: entrySubtitle(entry),
      duration: entryDuration(entry, timeZone),
      readOnly: false,
      onPress: () => onOpenEntry(entry),
    })),
    ...sharedEntries.map((row) => ({
      key: row.calendarId + ":" + row.entry.id,
      title: row.entry.title,
      color: row.entry.color,
      symbol: row.entry.symbol,
      subtitle: row.when + " · " + row.calendarName,
      duration: null,
      readOnly: true,
      onPress: () => onOpenSharedEntry?.(row, date),
    })),
  ];
  const visibleEntries = popupRows.slice(0, sharedEntries.length ? entryLimit : 2);
  const overflowCount = Math.max(0, popupRows.length - visibleEntries.length);
  const headerHeight = Math.ceil((holidayName ? HOLIDAY_HEADER_HEIGHT : 0) * layoutScale);
  const desiredPopupHeight =
    headerHeight +
    visibleEntries.length * entryRowHeight +
    (overflowCount > 0 ? overflowRowHeight : 0) +
    actionRowHeight +
    2;
  const maxPopupHeight = Math.max(240, height - insets.top - Math.max(insets.bottom + 68, 82) - 24);
  const popupHeight = Math.min(desiredPopupHeight, maxPopupHeight);
  const editorActions = actions.filter((action) => action.kind !== "TEMPLATE");
  const placement = useMemo(
    () =>
      calculateCalendarPopupPlacement({
        anchor,
        viewportWidth: width,
        viewportHeight: height,
        popupWidth,
        popupHeight,
        topInset: insets.top,
        bottomInset: Math.max(insets.bottom + 68, 82),
        edgeInset: 12,
      }),
    [anchor, height, insets.bottom, insets.top, popupHeight, popupWidth, width],
  );
  const arrowLeft = Math.max(
    18,
    Math.min(popupWidth - 34, anchor.x + anchor.width / 2 - placement.left - 8),
  );
  const origin = useMemo(
    () => quickEntryAnchorMotion(anchor, placement, popupHeight),
    [anchor, placement, popupHeight],
  );
  const { closing, closePopup, popupMotionStyle } = useQuickEntryPopupMotion({
    animateEntry,
    origin,
    onClose,
  });

  useEffect(() => {
    if (active) scheduleAccessibilityFocus(findNodeHandle(dialogHeadingRef.current));
  }, [active]);

  const content = (
    <View
      pointerEvents={!active || closing ? "none" : "box-none"}
      accessibilityElementsHidden={!active || closing}
      importantForAccessibility={!active || closing ? "no-hide-descendants" : "auto"}
      testID="quick-entry-overlay"
      style={{
        position: "absolute",
        opacity: active ? 1 : 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 10_000,
        elevation: 24,
      }}
    >
      <Pressable
        testID="quick-entry-backdrop"
        accessible={false}
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        onPress={closePopup}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: "transparent",
        }}
      />
      <Animated.View
        accessibilityLabel={`Schnellauswahl für ${compactDate(date)}`}
        accessibilityViewIsModal={windowOverlay}
        onAccessibilityEscape={closePopup}
        accessibilityActions={[{ name: "dismiss", label: "Schnellauswahl schließen" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "dismiss") closePopup();
        }}
        testID="quick-entry-popup"
        pointerEvents={closing ? "none" : "auto"}
        style={[
          {
            position: "absolute",
            left: placement.left,
            top: placement.top,
            width: popupWidth,
            height: popupHeight,
            borderWidth: 1,
            borderColor: palette.border,
            borderRadius: RADII.card,
            borderCurve: CORNER_CURVE,
            backgroundColor: palette.surfaceRaised,
            overflow: "visible",
            boxShadow: SHADOWS.overlay,
            zIndex: 10_001,
            elevation: 25,
          },
          popupMotionStyle,
        ]}
      >
        <View
          accessible={false}
          pointerEvents="none"
          testID="quick-entry-pointer"
          style={{
            position: "absolute",
            left: arrowLeft,
            top: placement.direction === "BELOW" ? -8 : undefined,
            bottom: placement.direction === "ABOVE" ? -8 : undefined,
            width: 16,
            height: 16,
            borderLeftWidth: 1,
            borderTopWidth: 1,
            borderColor: palette.border,
            backgroundColor: palette.surfaceRaised,
            transform: [{ rotate: placement.direction === "BELOW" ? "45deg" : "225deg" }],
          }}
        />

        <View
          style={{
            flex: 1,
            overflow: "hidden",
            borderRadius: RADII.card - 1,
            borderCurve: CORNER_CURVE,
          }}
          testID="quick-entry-clipped-content"
        >
          {holidayName ? (
            <View
              accessibilityLabel={holidayName}
              style={{
                height: headerHeight,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 16,
              }}
            >
              <View
                style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.warning }}
              />
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{
                  flex: 1,
                  color: palette.warning,
                  fontFamily: INTER_FONTS.semibold,
                  fontSize: TYPOGRAPHY.overline.fontSize,
                }}
              >
                {holidayName}
              </Text>
            </View>
          ) : null}

          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator style={{ flexShrink: 1 }}>
            {visibleEntries.map((entry, index) => {
              const duration = entry.duration;
              return (
                <Pressable
                  key={entry.key}
                  ref={index === 0 ? dialogHeadingRef : undefined}
                  accessibilityLabel={`${entry.title} ${entry.readOnly ? "ansehen" : "bearbeiten"}`}
                  accessibilityHint={`${compactDate(date)}${duration ? `, ${duration}` : ""}`}
                  accessibilityRole="button"
                  onPress={entry.onPress}
                  style={({ pressed }) => ({
                    minHeight: entryRowHeight,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: pressed ? palette.surfaceMuted : "transparent",
                    paddingHorizontal: 14,
                  })}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 15,
                      backgroundColor: accessibleChipBackgroundColor(entry.color),
                    }}
                  >
                    {entry.symbol ? (
                      entry.readOnly ? (
                        <SharedShiftSymbol color={chipTextColor} size={15} value={entry.symbol} />
                      ) : (
                        <ShiftSymbol color={chipTextColor} size={15} value={entry.symbol} />
                      )
                    ) : (
                      <Ionicons color={chipTextColor} name="calendar-outline" size={15} />
                    )}
                  </View>
                  <View style={{ minWidth: 0, flex: 1, gap: 1 }}>
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      style={{
                        color: palette.text,
                        fontFamily: INTER_FONTS.semibold,
                        fontSize: TYPOGRAPHY.label.fontSize,
                        fontWeight: "600",
                      }}
                    >
                      {entry.title}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      style={{
                        color: palette.textMuted,
                        fontFamily: INTER_FONTS.regular,
                        fontSize: TYPOGRAPHY.caption.fontSize,
                      }}
                    >
                      {entry.subtitle}
                    </Text>
                  </View>
                  {duration ? (
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      style={{
                        alignSelf: "flex-start",
                        paddingTop: 12,
                        color: palette.textMuted,
                        fontFamily: INTER_FONTS.regular,
                        fontSize: TYPOGRAPHY.caption.fontSize,
                      }}
                    >
                      {duration}
                    </Text>
                  ) : null}
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 54,
                      right: 14,
                      height: 1,
                      backgroundColor: palette.separator,
                    }}
                  />
                </Pressable>
              );
            })}

            {overflowCount > 0 ? (
              <Pressable
                accessibilityLabel={
                  sharedEntries.length
                    ? `${overflowCount} weitere Einträge anzeigen`
                    : `${overflowCount} weitere Einträge in den Tagesdetails anzeigen`
                }
                accessibilityRole="button"
                onPress={() =>
                  sharedEntries.length ? setEntryLimit((limit) => limit + 25) : onOpenDetails(date)
                }
                style={({ pressed }) => ({
                  minHeight: overflowRowHeight,
                  alignItems: "center",
                  justifyContent: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: palette.separator,
                  opacity: pressed ? 0.58 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={{
                    color: palette.textMuted,
                    fontFamily: INTER_FONTS.semibold,
                    fontSize: TYPOGRAPHY.caption.fontSize,
                    fontWeight: "600",
                  }}
                >
                  +{overflowCount} weitere
                </Text>
              </Pressable>
            ) : null}

            <View
              accessibilityRole="toolbar"
              style={{
                minHeight: actionRowHeight,
                flexDirection: "row",
                alignItems: "stretch",
              }}
            >
              {editorActions.map((action, index) => (
                <Pressable
                  key={action.key}
                  ref={!visibleEntries.length && index === 0 ? dialogHeadingRef : undefined}
                  accessibilityLabel={`${action.kind === "APPOINTMENT" ? "Termin" : "Schicht"} hinzufügen`}
                  accessibilityHint={compactDate(date)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => {
                    if (action.kind === "CUSTOM_SHIFT") {
                      onOpenShiftPicker(date);
                      return;
                    }
                    onSelectAction(action, date);
                  }}
                  style={({ pressed }) => ({
                    minHeight: actionRowHeight,
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    backgroundColor: pressed ? palette.surfaceMuted : "transparent",
                    opacity: busy ? 0.38 : 1,
                  })}
                >
                  {index > 0 ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 8,
                        bottom: 8,
                        width: 1,
                        backgroundColor: palette.separator,
                      }}
                    />
                  ) : null}
                  <Ionicons accessible={false} color={palette.textMuted} name="add" size={21} />
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={{
                      color: palette.textMuted,
                      fontFamily: INTER_FONTS.regular,
                      fontSize: TYPOGRAPHY.small.fontSize,
                      fontWeight: "400",
                    }}
                  >
                    {action.kind === "APPOINTMENT" ? "Termin" : "Schicht"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </Animated.View>
    </View>
  );

  return windowOverlay && Platform.OS === "ios" ? (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={active && !closing}>
      {content}
    </FullWindowOverlay>
  ) : (
    content
  );
});
