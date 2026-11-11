import { FadeIn, FadeOut } from "react-native-reanimated";

import { MOTION } from "@/theme/motion";

export const CALENDAR_VIEW_ZOOM = { duration: 600, measurementTimeout: 900 } as const;

export function calendarHeaderFadeIn() {
  return FadeIn.duration(CALENDAR_VIEW_ZOOM.duration)
    .easing(MOTION.easing.calm)
    .reduceMotion(MOTION.reduceMotion);
}

export function calendarHeaderFadeOut() {
  return FadeOut.duration(MOTION.duration.normal)
    .easing(MOTION.easing.calm)
    .reduceMotion(MOTION.reduceMotion);
}
