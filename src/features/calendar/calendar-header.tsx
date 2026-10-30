import Ionicons from "@/ui/icon";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassViewProps,
} from "expo-glass-effect";
import { memo, useContext, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import Animated, {
  Extrapolation,
  FadeInDown,
  FadeInUp,
  FadeOutDown,
  FadeOutUp,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import type { CalendarViewMode } from "@/domain/types";
import { formatMonthTitle } from "@/engine/calendar";
import {
  calendarHeaderFadeIn,
  calendarHeaderFadeOut,
} from "@/features/calendar/calendar-view-transition";
import { usePalette } from "@/theme/palette";
import { useCalendarBackground } from "@/features/settings/calendar-background-context";
import { MOTION } from "@/theme/motion";
import { TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, SHADOWS, RADII, SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { TabScreenHeader } from "@/ui/screen-layout";

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);
const ACTION_GROUP_HEIGHT = 48;

/** Include fixed filters/notices while keeping the native pager below the safe area. */
export function useCalendarHeaderOverlap() {
  const safeTop = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const [height, setHeight] = useState(0);
  const top = process.env.EXPO_OS === "web" ? SCREEN_LAYOUT.contentTopPadding : safeTop;
  return {
    headerOverlap: Math.max(0, height - top),
    measureHeader: (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height),
  };
}

function HeaderIconButton({
  label,
  name,
  onPress,
}: {
  readonly label: string;
  readonly name:
    | "account-multiple"
    | "calendar-number-outline"
    | "options-outline"
    | "chevron-back"
    | "chevron-forward"
    | "alert-circle-outline";
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && { backgroundColor: palette.overlaySubtle },
      ]}
    >
      <Ionicons accessible={false} color={palette.text} name={name} size={24} />
    </Pressable>
  );
}

export const CalendarHeader = memo(function CalendarHeader({
  month,
  referenceMonth,
  viewMode,
  onOpenYear,
  onOpenDisplay,
  onOpenSharing,
  onMoveYear,
  plannerActive,
  plannerTransition,
  direction = "NEXT",
  transition = "SPATIAL",
  synchronized = false,
  pageTitle = false,
  notice,
}: {
  readonly month: string;
  readonly referenceMonth: string;
  readonly viewMode: CalendarViewMode;
  readonly onOpenYear: () => void;
  readonly onOpenSharing?: () => void;
  readonly onOpenDisplay: () => void;
  readonly onMoveYear: (amount: number) => void;
  readonly plannerActive: boolean;
  readonly plannerTransition: SharedValue<number>;
  readonly direction?: "NEXT" | "PREVIOUS";
  readonly transition?: "SPATIAL" | "CROSSFADE";
  readonly synchronized?: boolean;
  readonly pageTitle?: boolean;
  readonly notice?: string;
}) {
  const palette = usePalette();
  const background = useCalendarBackground();
  const { fontScale } = useWindowDimensions();
  // Both headers share a bottom anchor; align the fixed island with the scrolling title's center.
  const titleAlignmentStyle =
    pageTitle && viewMode === "MONTH" && fontScale < SCREEN_LAYOUT.headerAccessoryStackFontScale
      ? {
          transform: [
            {
              translateY:
                (ACTION_GROUP_HEIGHT - Math.ceil(TYPOGRAPHY.hero.lineHeight * fontScale)) / 2,
            },
          ],
        }
      : undefined;
  const glassAvailable =
    Platform.OS === "ios" && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    if (!glassAvailable) return;
    let active = true;
    const update = (enabled: boolean) => {
      if (active) setReduceTransparency(enabled);
    };
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", update);
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then(update)
      .catch(() => update(true));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [glassAvailable]);
  const nativeGlass = glassAvailable && !reduceTransparency;
  const year = month.slice(0, 4);
  const monthName = formatMonthTitle(month).replace(/\s+\d{4}$/, "");
  const title =
    viewMode === "YEAR"
      ? year
      : year === referenceMonth.slice(0, 4)
        ? monthName
        : formatMonthTitle(month);
  const titleEntering =
    transition === "CROSSFADE"
      ? calendarHeaderFadeIn()
      : (direction === "NEXT" ? FadeInDown : FadeInUp)
          .duration(MOTION.duration.normal)
          .easing(MOTION.easing.calm)
          .withInitialValues({
            translateY: direction === "NEXT" ? MOTION.distance.small : -MOTION.distance.small,
          })
          .reduceMotion(MOTION.reduceMotion);
  const titleExiting =
    transition === "CROSSFADE"
      ? calendarHeaderFadeOut()
      : (direction === "NEXT" ? FadeOutUp : FadeOutDown)
          .duration(MOTION.duration.normal)
          .easing(MOTION.easing.calm)
          .withTargetValues({
            translateY: direction === "NEXT" ? -MOTION.distance.small : MOTION.distance.small,
          })
          .reduceMotion(MOTION.reduceMotion);
  const actionGroupMotionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(plannerTransition.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  // Reapply the native effect after quick planning: a zero-opacity ancestor otherwise loses it.
  const glassProps = useAnimatedProps<GlassViewProps>(() => ({
    glassEffectStyle:
      interpolate(plannerTransition.value, [0, 0.5], [1, 0], Extrapolation.CLAMP) > 0.01
        ? "regular"
        : "none",
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.headerPosition, titleAlignmentStyle]}
      testID="calendar-header-position"
    >
      <TabScreenHeader
        testID="calendar-header"
        transparent={pageTitle || Boolean(background.uri)}
        titleHidden={pageTitle && viewMode === "MONTH"}
        surface="calendarBackground"
        accessory={
          <Animated.View
            accessibilityElementsHidden={plannerActive}
            accessibilityRole="toolbar"
            importantForAccessibility={plannerActive ? "no-hide-descendants" : "auto"}
            pointerEvents={plannerActive ? "none" : "auto"}
            style={[
              styles.actionGroup,
              {
                borderColor: nativeGlass ? "transparent" : palette.separator,
                backgroundColor: nativeGlass ? "transparent" : palette.surfaceRaised,
                boxShadow: SHADOWS.overlay,
              },
              actionGroupMotionStyle,
            ]}
            testID="calendar-header-actions"
          >
            {nativeGlass ? (
              <AnimatedGlassView
                accessible={false}
                animatedProps={glassProps}
                colorScheme={palette.dark ? "dark" : "light"}
                pointerEvents="none"
                style={styles.glassSurface}
                testID="calendar-header-glass"
              />
            ) : null}
            <Animated.View
              key={synchronized ? "calendar-controls" : viewMode}
              entering={synchronized ? undefined : calendarHeaderFadeIn()}
              exiting={synchronized ? undefined : calendarHeaderFadeOut()}
              style={styles.modeActions}
              testID="calendar-header-mode-actions"
            >
              {viewMode === "MONTH" ? (
                <>
                  {onOpenSharing ? (
                    <>
                      <HeaderIconButton
                        label="Kalender teilen"
                        name="account-multiple"
                        onPress={onOpenSharing}
                      />
                      <View style={[styles.separator, { backgroundColor: palette.separator }]} />
                    </>
                  ) : null}
                  <HeaderIconButton
                    label={`${year}, Jahresansicht öffnen`}
                    name="calendar-number-outline"
                    onPress={onOpenYear}
                  />
                  <View style={[styles.separator, { backgroundColor: palette.separator }]} />
                  <HeaderIconButton
                    label={
                      notice
                        ? `Kalender gestalten öffnen. Hinweis: ${notice}`
                        : "Kalender gestalten öffnen"
                    }
                    name="options-outline"
                    onPress={onOpenDisplay}
                  />
                </>
              ) : (
                <>
                  <HeaderIconButton
                    label="Vorheriges Jahr"
                    name="chevron-back"
                    onPress={() => onMoveYear(-1)}
                  />
                  <View style={[styles.separator, { backgroundColor: palette.separator }]} />
                  <HeaderIconButton
                    label="Nächstes Jahr"
                    name="chevron-forward"
                    onPress={() => onMoveYear(1)}
                  />
                </>
              )}
            </Animated.View>
            {notice && viewMode === "MONTH" ? (
              <View
                pointerEvents="none"
                accessible={false}
                testID="calendar-notice-badge"
                style={{
                  position: "absolute",
                  right: 8,
                  top: 8,
                  width: 6,
                  height: 6,
                  borderRadius: RADII.pill,
                  backgroundColor: palette.accent,
                }}
              />
            ) : null}
          </Animated.View>
        }
        title={title}
        stableTitle={synchronized}
        titleColor={viewMode === "YEAR" ? palette.calendarYearAccent : undefined}
        titleEntering={synchronized ? undefined : titleEntering}
        titleExiting={synchronized ? undefined : titleExiting}
        titleKey={synchronized ? "calendar-title" : `${viewMode}-${title}`}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  headerPosition: {
    // Expand the header layout so controls reach the narrow gutter without moving outside hit bounds.
    marginRight: SPACING.xs - SCREEN_LAYOUT.horizontalPadding,
  },
  actionGroup: {
    minHeight: ACTION_GROUP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    paddingHorizontal: SPACING.xxs / 2,
    paddingVertical: SPACING.xxs / 2 - StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
    borderCurve: CORNER_CURVE,
  },
  action: {
    width: 48,
    height: 44,
    borderRadius: RADII.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  modeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  glassSurface: {
    ...StyleSheet.absoluteFill,
    borderRadius: RADII.pill,
    borderCurve: CORNER_CURVE,
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: 18,
  },
});
