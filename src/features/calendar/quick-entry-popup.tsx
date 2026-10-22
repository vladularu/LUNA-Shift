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
import Animated, { type SharedValue } from "react-native-reanimated";
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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QuickEntrySwipeRow } from "./quick-entry-swipe-row";
import { QuickEntryDeleteConfirmation } from "./quick-entry-delete-confirmation";
import { usePopupEntryDeletion } from "./use-popup-entry-deletion";

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
  highlightOpacity,
  onOpenEntry,
  onDeleteEntry,
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
  readonly highlightOpacity?: SharedValue<number>;
  readonly onOpenEntry: (entry: CalendarEntry) => void;
  readonly onDeleteEntry?: (entry: CalendarEntry) => Promise<void>;
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
  const [swipedEntry, setSwipedEntry] = useState<string | null>(null);
  const [confirmationHeight, setConfirmationHeight] = useState(0);
  const deletion = usePopupEntryDeletion({ entries, active, date, removeEntry: onDeleteEntry });
  const interactionBlocked = busy || deletion.busy || deletion.pending !== null;
  const requestDeletion = (entry: CalendarEntry) => {
    if (interactionBlocked) return;
    setConfirmationHeight(0);
    setSwipedEntry(null);
    deletion.request(entry);
  };
  const cancelDeletion = () => {
    if (deletion.busy) return;
    deletion.cancel();
    setSwipedEntry(null);
    scheduleAccessibilityFocus(findNodeHandle(dialogHeadingRef.current));
  };
  useEffect(() => {
    setSwipedEntry(null);
  }, [active, date]);
  const popupRows = [
    ...entries.map((entry) => ({
      key: entry.kind + ":" + entry.id,
      title: entry.title,
      color: entry.color,
      symbol: entry.kind === "SHIFT" ? entry.symbol : null,
      subtitle: entrySubtitle(entry),
      duration: entryDuration(entry, timeZone),
      readOnly: false,
      localEntry: entry,
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
      localEntry: null,
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
    (deletion.pending ? Math.max(actionRowHeight, confirmationHeight) : actionRowHeight) +
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
    highlightOpacity,
  });

  useEffect(() => {
    if (active) scheduleAccessibilityFocus(findNodeHandle(dialogHeadingRef.current));
  }, [active]);

  const dismiss = () => {
    if (deletion.busy) return;
    if (deletion.pending) cancelDeletion();
    else if (swipedEntry) setSwipedEntry(null);
    else closePopup();
  };
  const content = (
    <GestureHandlerRootView
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
        onPress={dismiss}
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
        onAccessibilityEscape={dismiss}
        accessibilityActions={[{ name: "dismiss", label: "Schnellauswahl schließen" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "dismiss") dismiss();
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
              accessibilityElementsHidden={deletion.pending !== null}
              importantForAccessibility={deletion.pending ? "no-hide-descendants" : "auto"}
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

          <ScrollView
            testID="quick-entry-scroll"
            nestedScrollEnabled
            showsVerticalScrollIndicator
            pointerEvents={interactionBlocked ? "none" : "auto"}
            accessibilityElementsHidden={deletion.pending !== null}
            importantForAccessibility={deletion.pending ? "no-hide-descendants" : "auto"}
            style={{ flexShrink: 1 }}
          >
            {visibleEntries.map((entry, index) => {
              const duration = entry.duration;
              const localEntry = entry.localEntry;
              const canDelete = localEntry !== null && onDeleteEntry !== undefined;
              const isPending =
                localEntry &&
                deletion.pending?.kind === localEntry.kind &&
                deletion.pending.id === localEntry.id;
              const row = (
                <Pressable
                  key={entry.key}
                  ref={index === 0 ? dialogHeadingRef : undefined}
                  accessibilityLabel={`${entry.title} ${entry.readOnly ? "ansehen" : "bearbeiten"}`}
                  accessibilityHint={`${compactDate(date)}${duration ? `, ${duration}` : ""}`}
                  accessibilityRole="button"
                  disabled={interactionBlocked}
                  accessibilityState={{ disabled: interactionBlocked }}
                  accessibilityActions={
                    canDelete ? [{ name: "delete", label: "Löschen" }] : undefined
                  }
                  onAccessibilityAction={(event) => {
                    if (
                      !interactionBlocked &&
                      localEntry &&
                      event.nativeEvent.actionName === "delete"
                    ) {
                      requestDeletion(localEntry);
                    }
                  }}
                  onLongPress={canDelete ? () => requestDeletion(localEntry) : undefined}
                  onPress={() => {
                    if (swipedEntry) setSwipedEntry(null);
                    else entry.onPress();
                  }}
                  style={({ pressed }) => ({
                    minHeight: entryRowHeight,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: pressed ? palette.surfaceMuted : palette.surfaceRaised,
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
                      {isPending
                        ? localEntry.kind === "APPOINTMENT"
                          ? "Diesen Termin löschen?"
                          : "Diesen Dienst löschen?"
                        : entry.subtitle}
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
              return canDelete ? (
                <QuickEntrySwipeRow
                  key={entry.key}
                  entryKey={entry.key}
                  title={entry.title}
                  enabled={active && !closing && !interactionBlocked}
                  open={swipedEntry === entry.key}
                  onOpen={() => setSwipedEntry(entry.key)}
                  onClose={() => setSwipedEntry((key) => (key === entry.key ? null : key))}
                  onDelete={() => requestDeletion(localEntry)}
                >
                  {row}
                </QuickEntrySwipeRow>
              ) : (
                row
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
                disabled={interactionBlocked}
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
          </ScrollView>

          <View testID="quick-entry-footer" style={{ flexShrink: 0 }}>
            {deletion.pending ? (
              <QuickEntryDeleteConfirmation
                title={deletion.pending.title}
                busy={deletion.busy}
                error={deletion.error}
                minHeight={actionRowHeight}
                onLayout={(event) =>
                  setConfirmationHeight(Math.ceil(event.nativeEvent.layout.height))
                }
                onCancel={cancelDeletion}
                onConfirm={() => {
                  void deletion.confirm().then((deleted) => {
                    if (deleted) {
                      setSwipedEntry(null);
                      scheduleAccessibilityFocus(findNodeHandle(dialogHeadingRef.current));
                    }
                  });
                }}
              />
            ) : (
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
                    accessibilityLabel={`${action.kind === "APPOINTMENT" ? "Termin" : "Dienst"} hinzufügen`}
                    accessibilityHint={compactDate(date)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: interactionBlocked }}
                    disabled={interactionBlocked}
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
                      {action.kind === "APPOINTMENT" ? "Termin" : "Dienst"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      </Animated.View>
    </GestureHandlerRootView>
  );

  return windowOverlay && Platform.OS === "ios" ? (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={active && !closing}>
      {content}
    </FullWindowOverlay>
  ) : (
    content
  );
});
