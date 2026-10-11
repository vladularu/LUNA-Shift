import { SlideInDown } from "react-native-reanimated";

import { MOTION } from "@/theme/motion";

export const ENTRY_EDIT_OPEN_DURATION = 560;
export const ENTRY_EDIT_CLOSE_DURATION = 360;

// Gesture Worklets capture only the numeric duration, never this non-serializable builder.
// Transform only: fading a parent to zero can prevent native glass from rendering.
export const ENTRY_EDIT_MOTION = {
  sheet: SlideInDown.duration(ENTRY_EDIT_OPEN_DURATION)
    .easing(MOTION.easing.calm)
    .reduceMotion(MOTION.reduceMotion),
} as const;
