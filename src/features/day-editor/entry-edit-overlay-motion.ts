import { useCallback, useMemo } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  SlideInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { MOTION } from "@/theme/motion";

export const ENTRY_EDIT_OPEN_DURATION = 560;
export const ENTRY_EDIT_CLOSE_DURATION = 360;
const CLOSE_FOOTER_LANDED = 1;
const CLOSE_FOOTER_SETTLED = 2;
const CLOSE_FOOTER_ARRIVAL_DURATION = 100;
const CLOSE_FOOTER_SETTLE_DURATION = MOTION.duration.fast;
const CLOSE_FOOTER_TIMING = {
  easing: MOTION.easing.calm,
  reduceMotion: MOTION.reduceMotion,
};

function makeSheetEntering() {
  return SlideInDown.duration(ENTRY_EDIT_OPEN_DURATION)
    .easing(MOTION.easing.calm)
    .reduceMotion(MOTION.reduceMotion);
}

// Gesture Worklets capture only the numeric duration, never this non-serializable builder.
// Transform only: fading a parent to zero can prevent native glass from rendering.
export const ENTRY_EDIT_MOTION = {
  sheet: makeSheetEntering(),
} as const;

export function useEntryEditCloseFooterMotion(enabled: boolean, viewportHeight: number) {
  const progress = useSharedValue(enabled ? 0 : CLOSE_FOOTER_SETTLED);
  const travel = useSharedValue(viewportHeight);

  const onFooterLayout = useCallback(
    (event: LayoutChangeEvent) => {
      travel.set(event.nativeEvent.layout.height + MOTION.distance.small);
    },
    [travel],
  );

  // The sheet and its footer share the actual completion event on the UI thread.
  // Keeping progress in the frame also avoids a replay after keyboard or editor changes.
  const sheetEntering = useMemo(() => {
    if (!enabled) return ENTRY_EDIT_MOTION.sheet;
    return makeSheetEntering().withCallback((finished) => {
      "worklet";
      if (progress.get() !== 0) return;
      progress.set(
        finished
          ? withSequence(
              CLOSE_FOOTER_TIMING.reduceMotion,
              withTiming(CLOSE_FOOTER_LANDED, {
                ...CLOSE_FOOTER_TIMING,
                duration: CLOSE_FOOTER_ARRIVAL_DURATION,
              }),
              withTiming(CLOSE_FOOTER_SETTLED, {
                ...CLOSE_FOOTER_TIMING,
                duration: CLOSE_FOOTER_SETTLE_DURATION,
              }),
            )
          : CLOSE_FOOTER_SETTLED,
      );
    });
  }, [enabled, progress]);

  const footerMotionStyle = useAnimatedStyle(() => {
    const phase = progress.get();
    const shapePhases = [0, 0.8, CLOSE_FOOTER_LANDED, CLOSE_FOOTER_SETTLED];
    return {
      transform: [
        {
          translateY: interpolate(
            Math.min(phase, CLOSE_FOOTER_LANDED),
            [0, CLOSE_FOOTER_LANDED],
            [travel.get(), 0],
          ),
        },
        { scaleX: interpolate(phase, shapePhases, [1, 1, 1.032, 1]) },
        { scaleY: interpolate(phase, shapePhases, [1, 1, 0.94, 1]) },
      ],
    };
  });

  return { footerMotionStyle, onFooterLayout, sheetEntering };
}
