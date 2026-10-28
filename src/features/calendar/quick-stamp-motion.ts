import { withSequence, withTiming, type EntryExitAnimationFunction } from "react-native-reanimated";
import { MOTION } from "@/theme/motion";

/** A small local pop; no layout change or delay to the underlying save. */
export const quickStampEntering: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: MOTION.distance.subtle }, { scale: MOTION.scale.emphasis }],
    },
    animations: {
      opacity: withTiming(1, { duration: MOTION.duration.fast }),
      transform: [
        {
          translateY: withSequence(
            withTiming(-MOTION.distance.subtle, { duration: MOTION.duration.instant }),
            withTiming(0, { duration: MOTION.duration.fast, easing: MOTION.easing.standard }),
          ),
        },
        {
          scale: withSequence(
            withTiming(2 - MOTION.scale.emphasis, { duration: MOTION.duration.instant }),
            withTiming(1, { duration: MOTION.duration.fast, easing: MOTION.easing.standard }),
          ),
        },
      ],
    },
  };
};

export const quickStampExiting: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: MOTION.duration.fast }),
      transform: [
        { translateY: withTiming(-MOTION.distance.subtle, { duration: MOTION.duration.fast }) },
        { scale: withTiming(MOTION.scale.emphasis, { duration: MOTION.duration.fast }) },
      ],
    },
  };
};
