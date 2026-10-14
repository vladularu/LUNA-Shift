import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import type { QuickEntryAnchorMotion } from "./quick-entry-motion";
import { QUICK_ENTRY_EASING, quickEntryTransitionDuration } from "./quick-entry-motion";

export function useQuickEntryPopupMotion({
  animateEntry,
  origin,
  onClose,
  highlightOpacity,
}: {
  readonly animateEntry: boolean;
  readonly origin: QuickEntryAnchorMotion;
  readonly onClose: () => void;
  readonly highlightOpacity?: SharedValue<number>;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(animateEntry ? 0 : 1);
  const closeStart = useSharedValue(1);
  const [closing, setClosing] = useState(false);
  const closeRequested = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnimation(progress);
    };
  }, [progress]);

  useEffect(() => {
    if (closeRequested.current) return;
    cancelAnimation(progress);
    progress.set(
      animateEntry
        ? withTiming(1, {
            duration: quickEntryTransitionDuration(true, reduceMotion),
            easing: QUICK_ENTRY_EASING,
          })
        : 1,
    );
  }, [animateEntry, progress, reduceMotion]);

  const finishClose = useCallback(() => {
    if (!mounted.current || completed.current) return;
    completed.current = true;
    onClose();
  }, [onClose]);

  const closePopup = useCallback(() => {
    if (closeRequested.current) return;
    closeRequested.current = true;
    closeStart.set(progress.get());
    setClosing(true);
    cancelAnimation(progress);
    progress.set(
      withTiming(
        0,
        {
          duration: quickEntryTransitionDuration(false, reduceMotion),
          easing: QUICK_ENTRY_EASING,
        },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        },
      ),
    );
  }, [closeStart, finishClose, progress, reduceMotion]);

  const opacity = useDerivedValue(() => {
    const value = progress.get();
    return reduceMotion
      ? value
      : closing
        ? Math.min(1, Math.max(0, value / Math.max(0.001, closeStart.get())))
        : 1;
  }, [closeStart, closing, progress, reduceMotion]);

  useAnimatedReaction(
    () => opacity.get(),
    (value) => highlightOpacity?.set(value),
    [highlightOpacity],
  );

  const popupMotionStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: opacity.get(),
      transform: reduceMotion
        ? []
        : [
            { translateY: origin.translateY * (1 - value) },
            { translateY: origin.pivotY },
            { scaleY: value },
            { translateY: -origin.pivotY },
          ],
    };
  }, [opacity, origin, reduceMotion]);

  return { closing, closePopup, popupMotionStyle };
}
