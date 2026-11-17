import { withSequence, withTiming, type EntryExitAnimationFunction } from "react-native-reanimated";
import { MOTION } from "@/theme/motion";

/** Visible in the first frame; only the small local movement settles afterward. */
export const quickStampEntering: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: {
      opacity: 1,
      transform: [{ translateY: MOTION.distance.subtle }, { scale: MOTION.scale.emphasis }],
    },
    animations: {
      opacity: withTiming(1, { duration: 0 }),
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

/** Do not keep a removed service visible while its native view is detached. */
export const quickStampExiting: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0 },
    animations: {
      opacity: withTiming(0, { duration: 0 }),
    },
  };
};
