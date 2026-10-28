import Ionicons from "@/ui/icon";
import { memo, useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import {
  calculateCalendarBottomLayout,
  calculateQuickPlannerLayout,
} from "@/features/calendar/calendar-layout";
import type { QuickEntryAction } from "@/features/calendar/quick-entry-actions";
import { QuickEntryActionStrip } from "@/features/calendar/quick-entry-action-strip";
import {
  QUICK_PLANNER_EASING,
  quickPlannerControlMotion,
  quickPlannerDockMotion,
  quickPlannerTransitionDuration,
} from "./quick-planner-control-motion";
import { QUICK_PLANNER_METRICS } from "@/features/calendar/quick-planner-appearance";
import { MOTION } from "@/theme/motion";
import { useInversePalette, usePalette } from "@/theme/palette";
import { CORNER_CURVE, SHADOWS, CALENDAR_METRICS } from "@/theme/tokens";
import { AnimatedPressable, usePressMotion } from "@/ui/press-motion";

const CONTROL_SIDE_INSET = 8;
const CLOSED_SCREEN_RIGHT = 22;
const IOS_NATIVE_TAB_OVERLAY_CLEARANCE = 17;
const IOS_NATIVE_TAB_OVERLAY_DROP = 42;
const CLOSE_INNER_INSET =
  (QUICK_PLANNER_METRICS.closeTargetSize - QUICK_PLANNER_METRICS.closeVisualSize) / 2;
const CLOSE_TARGET_GAP = QUICK_PLANNER_METRICS.closeVisualGap - CLOSE_INNER_INSET;
const CONTROL_HEIGHT =
  QUICK_PLANNER_METRICS.closeTargetSize + CLOSE_TARGET_GAP + QUICK_PLANNER_METRICS.dockHeight;
const CLOSED_TARGET_SIZE = Math.max(44, CALENDAR_METRICS.floatingActionSize + 8);
const CLOSED_TARGET_INSET = (CLOSED_TARGET_SIZE - CALENDAR_METRICS.floatingActionSize) / 2;
const CLOSED_TARGET_RIGHT = CLOSED_SCREEN_RIGHT - CONTROL_SIDE_INSET - CLOSED_TARGET_INSET;
const CLOSE_CENTER_OFFSET = (CLOSED_TARGET_SIZE - QUICK_PLANNER_METRICS.closeTargetSize) / 2;

export { quickPlannerTransitionDuration } from "./quick-planner-control-motion";

export const QuickPlannerDock = memo(function QuickPlannerDock({
  actions,
  activeKey,
  busy,
  open,
  transitionProgress,
  windowOverlay = true,
  active = true,
  onOpen,
  onSelectAction,
  onClose,
}: {
  readonly actions: readonly QuickEntryAction[];
  readonly activeKey: string | null;
  readonly busy: boolean;
  readonly open: boolean;
  readonly transitionProgress?: SharedValue<number>;
  readonly windowOverlay?: boolean;
  readonly active?: boolean;
  readonly onOpen: () => void;
  readonly onSelectAction: (action: QuickEntryAction) => void;
  readonly onClose: () => void;
}) {
  const dockPalette = useInversePalette();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const internalProgress = useSharedValue(open ? 1 : 0);
  const progress = transitionProgress ?? internalProgress;
  const pencilPressMotion = usePressMotion(1, MOTION.scale.press);
  const closePressMotion = usePressMotion(1, MOTION.scale.press);
  const baseOpenBottom = Platform.OS === "web" ? 8 : Math.max(insets.bottom - 16, 8);
  const openBottom =
    Platform.OS === "ios" ? baseOpenBottom - IOS_NATIVE_TAB_OVERLAY_DROP : baseOpenBottom;
  const overlaidTabBarInset =
    Platform.OS === "ios" ? insets.bottom + IOS_NATIVE_TAB_OVERLAY_CLEARANCE : insets.bottom;
  const { floatingActionBottom } = calculateCalendarBottomLayout(overlaidTabBarInset);
  const minimumVisualBottom =
    openBottom +
    QUICK_PLANNER_METRICS.dockHeight +
    QUICK_PLANNER_METRICS.closeVisualGap +
    Math.max(0, (QUICK_PLANNER_METRICS.closeVisualSize - CALENDAR_METRICS.floatingActionSize) / 2);
  const closedVisualBottom = Math.max(floatingActionBottom, minimumVisualBottom);
  const closedBottomWithinControl = closedVisualBottom - openBottom;
  const { tileWidth } = calculateQuickPlannerLayout(width);

  useEffect(() => () => cancelAnimation(progress), [progress]);

  useEffect(() => {
    if (closing) return;
    cancelAnimation(progress);
    if (progress.get() === (open ? 1 : 0)) return;
    progress.value = withTiming(open ? 1 : 0, {
      duration: quickPlannerTransitionDuration(open, reduceMotion),
      easing: QUICK_PLANNER_EASING,
    });
  }, [closing, open, progress, reduceMotion]);

  const finishClose = useCallback(() => {
    setClosing(false);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    cancelAnimation(progress);
    progress.value = withTiming(
      0,
      {
        duration: quickPlannerTransitionDuration(false, reduceMotion),
        easing: QUICK_PLANNER_EASING,
      },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  }, [closing, finishClose, open, progress, reduceMotion]);

  const dockMotionStyle = useAnimatedStyle(
    () =>
      quickPlannerDockMotion(
        progress.get(),
        reduceMotion,
        QUICK_PLANNER_METRICS.dockHeight + MOTION.distance.scene,
      ),
    [reduceMotion],
  );

  const pencilMorphStyle = useAnimatedStyle(
    () => quickPlannerControlMotion(progress.get(), "add", reduceMotion),
    [reduceMotion],
  );
  // Cover the navigation completely before the drawer starts rising. Reverse
  // the same clock so navigation returns only after the drawer has left.
  const navigationCoverStyle = useAnimatedStyle(() => ({
    opacity: 1 - quickPlannerControlMotion(progress.get(), "add", true).opacity,
  }));

  const closeMorphStyle = useAnimatedStyle(
    () => quickPlannerControlMotion(progress.get(), "close", reduceMotion),
    [reduceMotion],
  );

  const control = (
    <Animated.View
      pointerEvents={active ? "box-none" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[StyleSheet.absoluteFill, { zIndex: 10_002, elevation: 26, opacity: active ? 1 : 0 }]}
      testID="quick-planner-mount-reveal"
    >
      <Animated.View
        testID="quick-planner-navigation-cover"
        pointerEvents={open || closing ? "auto" : "none"}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          {
            position: "absolute",
            bottom: Math.min(openBottom, 0),
            left: 0,
            right: 0,
            height: QUICK_PLANNER_METRICS.dockHeight + Math.max(0, openBottom),
            backgroundColor: palette.background,
          },
          navigationCoverStyle,
        ]}
      />
      <View
        pointerEvents="box-none"
        style={[styles.stack, { bottom: openBottom, height: CONTROL_HEIGHT }]}
        testID="quick-planner-stack"
      >
        <Animated.View
          accessibilityElementsHidden={!open || closing}
          importantForAccessibility={open && !closing ? "auto" : "no-hide-descendants"}
          pointerEvents={open && !closing ? "auto" : "none"}
          style={[
            styles.dockSurface,
            {
              backgroundColor: dockPalette.surface,
              borderColor: dockPalette.separator,
              boxShadow: SHADOWS.overlay,
            },
            dockMotionStyle,
          ]}
          testID="quick-planner-dock"
        >
          <QuickEntryActionStrip
            actions={actions}
            activeKey={activeKey}
            busy={busy || closing}
            onSelectAction={onSelectAction}
            tileWidth={tileWidth}
          />
        </Animated.View>

        <Animated.View
          accessibilityElementsHidden={open || closing}
          importantForAccessibility={!open && !closing ? "auto" : "no-hide-descendants"}
          pointerEvents={!open && !closing ? "auto" : "none"}
          style={[
            styles.pencilAnchor,
            {
              right: CLOSED_TARGET_RIGHT,
              bottom: closedBottomWithinControl - CLOSED_TARGET_INSET,
            },
            pencilMorphStyle,
          ]}
          testID="quick-planner-pencil-anchor"
        >
          <AnimatedPressable
            accessibilityHint="Öffnet die Vorlagenauswahl zum schnellen Eintragen mehrerer Dienste."
            accessibilityLabel="Dienstplan bearbeiten"
            accessibilityRole="button"
            onPress={onOpen}
            onPressIn={pencilPressMotion.onPressIn}
            onPressOut={pencilPressMotion.onPressOut}
            style={[styles.pencilTarget, pencilPressMotion.animatedStyle]}
            testID="quick-planner-pencil-target"
          >
            <View
              style={[
                styles.pencilVisual,
                {
                  backgroundColor: palette.floatingAction,
                  boxShadow: SHADOWS.overlay,
                },
              ]}
            >
              <Ionicons accessible={false} color={palette.onFloatingAction} name="add" size={24} />
            </View>
          </AnimatedPressable>
        </Animated.View>

        <Animated.View
          accessibilityElementsHidden={!open || closing}
          importantForAccessibility={open && !closing ? "auto" : "no-hide-descendants"}
          pointerEvents={open && !closing ? "auto" : "none"}
          style={[
            styles.closeAnchor,
            {
              right: CLOSED_TARGET_RIGHT + CLOSE_CENTER_OFFSET,
              bottom: closedBottomWithinControl - CLOSED_TARGET_INSET + CLOSE_CENTER_OFFSET,
            },
            closeMorphStyle,
          ]}
          testID="quick-planner-close-row"
        >
          <AnimatedPressable
            accessibilityHint="Schließt den Schnelleinfüge-Modus."
            accessibilityLabel="Planung beenden"
            accessibilityRole="button"
            onPress={requestClose}
            onPressIn={closePressMotion.onPressIn}
            onPressOut={closePressMotion.onPressOut}
            style={[styles.closeTarget, closePressMotion.animatedStyle]}
            testID="quick-planner-close-hit-target"
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.closeVisual,
                  {
                    backgroundColor: dockPalette.surface,
                    borderColor: dockPalette.separator,
                    boxShadow: SHADOWS.overlay,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
                testID="quick-planner-close-visual"
              >
                <Ionicons accessible={false} color={dockPalette.text} name="close" size={20} />
              </View>
            )}
          </AnimatedPressable>
        </Animated.View>
      </View>
    </Animated.View>
  );

  if (windowOverlay && Platform.OS === "ios") {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
        {control}
      </FullWindowOverlay>
    );
  }

  return control;
});

const styles = StyleSheet.create({
  stack: {
    position: "absolute",
    right: CONTROL_SIDE_INSET,
    left: CONTROL_SIDE_INSET,
    zIndex: 100,
    elevation: 24,
  },
  dockSurface: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    height: QUICK_PLANNER_METRICS.dockHeight,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: QUICK_PLANNER_METRICS.dockRadius,
    borderCurve: CORNER_CURVE,
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  pencilAnchor: {
    position: "absolute",
    width: CLOSED_TARGET_SIZE,
    height: CLOSED_TARGET_SIZE,
  },
  pencilTarget: {
    width: CLOSED_TARGET_SIZE,
    height: CLOSED_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  pencilVisual: {
    width: CALENDAR_METRICS.floatingActionSize,
    height: CALENDAR_METRICS.floatingActionSize,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: CALENDAR_METRICS.floatingActionSize / 2,
  },
  closeAnchor: {
    position: "absolute",
    width: QUICK_PLANNER_METRICS.closeTargetSize,
    height: QUICK_PLANNER_METRICS.closeTargetSize,
  },
  closeTarget: {
    width: QUICK_PLANNER_METRICS.closeTargetSize,
    height: QUICK_PLANNER_METRICS.closeTargetSize,
    alignItems: "center",
    justifyContent: "center",
  },
  closeVisual: {
    width: QUICK_PLANNER_METRICS.closeVisualSize,
    height: QUICK_PLANNER_METRICS.closeVisualSize,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: QUICK_PLANNER_METRICS.closeVisualSize / 2,
    borderCurve: CORNER_CURVE,
  },
});
