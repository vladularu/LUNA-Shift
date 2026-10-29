import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { MAX_CALENDAR_IMAGE_OPACITY } from "@/theme/calendar-image";
import { MOTION } from "@/theme/motion";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { selectionFeedback } from "@/ui/haptics";
import { Text } from "@/ui/text";

const STEP = 10;
const THUMB_WIDTH = SPACING.xl;
const ACTIVE_THUMB_WIDTH = SPACING.xl + SPACING.lg;
const TRACK_INSET = ACTIVE_THUMB_WIDTH / 2;

export function CalendarImageOpacityControl({
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  readonly value: number;
  readonly disabled: boolean;
  readonly onPreview: (value: number | null) => void;
  readonly onCommit: (value: number) => void;
}) {
  const palette = usePalette();
  const [active, setActive] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(true);
  const lift = useSharedValue(0);
  const position = useSharedValue(value);
  const width = useSharedValue(0);
  const height = useSharedValue(MINIMUM_TOUCH_TARGET);
  const dragging = useSharedValue(false);
  const origin = useSharedValue(value);
  const step = useSharedValue(value);
  const changed = useSharedValue(false);
  const cancel = useRef(onPreview);
  useEffect(() => {
    cancel.current = onPreview;
  }, [onPreview]);
  useEffect(() => {
    let mounted = true;
    const update = (enabled: boolean) => {
      if (mounted) setReduceTransparency(enabled);
    };
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", update);
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then(update)
      .catch(() => update(true));
    return () => {
      mounted = false;
      subscription.remove();
      if (dragging.get()) cancel.current(null);
    };
  }, [dragging]);
  useEffect(() => {
    if (!dragging.get()) {
      position.set(
        withSpring(value, { ...MOTION.spring.press, reduceMotion: MOTION.reduceMotion }),
      );
    }
  }, [dragging, position, value]);
  const nativeGlass =
    Platform.OS === "ios" &&
    isGlassEffectAPIAvailable() &&
    isLiquidGlassAvailable() &&
    !reduceTransparency;
  const Surface = nativeGlass ? GlassView : View;
  const thumbStyle = useAnimatedStyle(() => {
    const thumbWidth = interpolate(lift.get(), [0, 1], [THUMB_WIDTH, ACTIVE_THUMB_WIDTH]);
    const thumbHeight = interpolate(lift.get(), [0, 1], [SPACING.lg, SPACING.xl + SPACING.xxs]);
    return {
      width: thumbWidth,
      height: thumbHeight,
      left: `${position.get()}%`,
      transform: [{ translateX: -thumbWidth / 2 }, { translateY: -thumbHeight / 2 }],
    };
  });
  const solidThumbStyle = useAnimatedStyle(() => ({ opacity: 1 - lift.get() }));
  const fillStyle = useAnimatedStyle(() => ({ width: `${position.get()}%` }));
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: interpolate(lift.get(), [0, 1], [1, 1.5]) }],
  }));
  const valueStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (-lift.get() * SPACING.xxs) / 2 }, { scale: 1 + lift.get() * 0.035 }],
  }));
  function begin() {
    setActive(true);
  }
  function previewStep(next: number) {
    onPreview(next);
    selectionFeedback();
  }
  function finish(next: number | null) {
    setActive(false);
    if (next === null) onPreview(null);
    else onCommit(next);
  }
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .manualActivation(true)
    .minDistance(0)
    .maxPointers(1)
    .withTestId("calendar-image-opacity-pan")
    .onTouchesDown((event, manager) => {
      const touch = event.changedTouches[0];
      const center = TRACK_INSET + (width.get() * position.get()) / MAX_CALENDAR_IMAGE_OPACITY;
      // Only the 44-point thumb target captures the touch; the rest can scroll.
      if (
        disabled ||
        width.get() <= 0 ||
        event.numberOfTouches !== 1 ||
        !touch ||
        Math.abs(touch.x - center) > MINIMUM_TOUCH_TARGET / 2 ||
        Math.abs(touch.y - height.get() / 2) > MINIMUM_TOUCH_TARGET / 2
      ) {
        manager.fail();
      } else {
        manager.activate();
      }
    })
    .onStart(() => {
      if (disabled || width.get() <= 0) return;
      dragging.set(true);
      origin.set(value);
      step.set(value);
      position.set(value);
      changed.set(false);
      lift.set(withSpring(1, { ...MOTION.spring.press, reduceMotion: MOTION.reduceMotion }));
      runOnJS(begin)();
    })
    .onUpdate((event) => {
      if (disabled || !dragging.get() || width.get() <= 0) return;
      if (!changed.get() && Math.abs(event.translationX) < SPACING.xxs) return;
      const raw = Math.max(
        0,
        Math.min(
          MAX_CALENDAR_IMAGE_OPACITY,
          origin.get() + (event.translationX / width.get()) * MAX_CALENDAR_IMAGE_OPACITY,
        ),
      );
      // The UI-thread thumb follows every frame; only the ten-percent value crosses to JS.
      position.set(raw);
      const next = Math.round(raw / STEP) * STEP;
      if (next !== step.get()) {
        step.set(next);
        changed.set(true);
        runOnJS(previewStep)(next);
      }
    })
    .onEnd((_event, success) => {
      if (!success || !dragging.get()) return;
      dragging.set(false);
      const next = changed.get() ? step.get() : null;
      position.set(
        withSpring(next ?? origin.get(), {
          ...MOTION.spring.press,
          reduceMotion: MOTION.reduceMotion,
        }),
      );
      runOnJS(finish)(next);
    })
    .onFinalize(() => {
      if (dragging.get()) {
        dragging.set(false);
        position.set(
          withSpring(origin.get(), {
            ...MOTION.spring.press,
            reduceMotion: MOTION.reduceMotion,
          }),
        );
        runOnJS(finish)(null);
      }
      lift.set(withSpring(0, { ...MOTION.spring.settle, reduceMotion: MOTION.reduceMotion }));
    });
  return (
    <View style={{ gap: SPACING.xs, opacity: disabled ? 0.5 : 1 }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ alignItems: "center" }}
      >
        <Text style={{ ...TYPOGRAPHY.caption, color: palette.textSecondary }}>Deckkraft</Text>
        <Animated.View style={valueStyle}>
          <Text
            testID="calendar-image-opacity-value"
            style={{
              ...TYPOGRAPHY.highlightCount,
              color: palette.text,
              textAlign: "center",
              fontVariant: ["tabular-nums"],
            }}
          >
            {value} %
          </Text>
        </Animated.View>
      </View>
      <GestureDetector gesture={pan}>
        <View
          testID="calendar-image-opacity-slider"
          collapsable={false}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Deckkraft des Kalenderfotos"
          accessibilityHint="Den Regler berühren und in Zehn-Prozent-Schritten ziehen. Oder mit den Aktionen anpassen."
          accessibilityState={{ disabled }}
          accessibilityValue={{
            min: 0,
            max: MAX_CALENDAR_IMAGE_OPACITY,
            now: value,
            text: `${value} Prozent`,
          }}
          accessibilityActions={[
            { name: "increment", label: "Zehn Prozent mehr" },
            { name: "decrement", label: "Zehn Prozent weniger" },
          ]}
          onAccessibilityAction={(event) => {
            if (disabled || active) return;
            const action = event.nativeEvent.actionName;
            const next =
              action === "increment"
                ? Math.min(MAX_CALENDAR_IMAGE_OPACITY, (Math.floor(value / STEP) + 1) * STEP)
                : action === "decrement"
                  ? Math.max(0, (Math.ceil(value / STEP) - 1) * STEP)
                  : value;
            if (next !== value) {
              selectionFeedback();
              onCommit(next);
            }
          }}
          onLayout={(event) => {
            width.set(event.nativeEvent.layout.width - TRACK_INSET * 2);
            height.set(event.nativeEvent.layout.height);
          }}
          style={styles.touchArea}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.track, { backgroundColor: palette.selectionTrack }, trackStyle]}
          >
            <Animated.View
              testID="calendar-image-opacity-fill"
              style={[styles.fill, { backgroundColor: palette.primary }, fillStyle]}
            />
          </Animated.View>
          <View pointerEvents="none" style={styles.thumbTrack}>
            <Animated.View
              testID="calendar-image-opacity-thumb"
              style={[styles.thumb, { shadowColor: palette.shadow }, thumbStyle]}
            >
              <Surface
                testID="calendar-image-opacity-thumb-surface"
                {...(nativeGlass
                  ? {
                      glassEffectStyle: {
                        style: active ? ("regular" as const) : ("none" as const),
                        animate: true,
                        animationDuration: MOTION.duration.fast / 1000,
                      },
                      colorScheme: palette.dark ? ("dark" as const) : ("light" as const),
                      isInteractive: false,
                    }
                  : {})}
                style={[
                  styles.thumbSurface,
                  {
                    backgroundColor: nativeGlass
                      ? "transparent"
                      : reduceTransparency
                        ? palette.surface
                        : `${palette.surface}cc`,
                    borderColor: palette.separator,
                    borderWidth: nativeGlass ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Animated.View
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: palette.text, borderRadius: RADII.pill },
                    solidThumbStyle,
                  ]}
                />
              </Surface>
            </Animated.View>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}
const styles = StyleSheet.create({
  touchArea: {
    minHeight: MINIMUM_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: TRACK_INSET,
  },
  track: { height: SPACING.xxs, borderRadius: RADII.pill },
  thumbTrack: { position: "absolute", left: TRACK_INSET, right: TRACK_INSET, top: "50%" },
  fill: { height: SPACING.xxs, borderRadius: RADII.pill },
  thumb: {
    position: "absolute",
    top: 0,
    borderRadius: RADII.pill,
    borderCurve: CORNER_CURVE,
    shadowOpacity: 0.16,
    shadowRadius: SPACING.xs,
    shadowOffset: { width: 0, height: SPACING.xxs / 2 },
  },
  thumbSurface: {
    ...StyleSheet.absoluteFill,
    borderRadius: RADII.pill,
    borderCurve: CORNER_CURVE,
    overflow: "hidden",
  },
});
