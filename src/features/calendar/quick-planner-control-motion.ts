import { MOTION } from "@/theme/motion";
import { Easing } from "react-native-reanimated";

const PLUS_EXIT_END = 0.3;
const DOCK_ARRIVAL_END = 5 / 6;
export const QUICK_PLANNER_EASING = Easing.linear;

export function quickPlannerTransitionDuration(open: boolean, reduceMotion: boolean): number {
  if (reduceMotion) return MOTION.duration.instant;
  return open ? 480 : 360;
}

/** The drawer and close control follow the same staged path in both directions. */
export function quickPlannerDockMotion(progress: number, reduceMotion: boolean, distance?: number) {
  "worklet";
  // Captured values are bound in the worklet body, after parameter initialization.
  const travelDistance = distance === undefined ? MOTION.distance.scene : distance;
  const rise = Math.min(
    1,
    Math.max(0, (progress - PLUS_EXIT_END) / (DOCK_ARRIVAL_END - PLUS_EXIT_END)),
  );
  const visibility = 1 - Math.pow(1 - rise, 3);
  return {
    opacity: visibility,
    transform: reduceMotion ? [] : [{ translateY: (1 - visibility) * travelDistance }],
  };
}

/** Plus leaves completely before the drawer and close control begin to rise. */
export function quickPlannerControlMotion(
  progress: number,
  control: "add" | "close",
  reduceMotion: boolean,
) {
  "worklet";
  if (control === "close") return quickPlannerDockMotion(progress, reduceMotion);
  const phase = Math.min(1, Math.max(0, progress / PLUS_EXIT_END));
  const smooth = phase * phase * (3 - 2 * phase);
  return {
    opacity: 1 - smooth,
    transform: reduceMotion ? [] : [{ translateY: smooth * MOTION.distance.scene }],
  };
}
