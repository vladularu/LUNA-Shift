import type { CalendarAnchorRect, CalendarPopupPlacement } from "./calendar-layout";
import { Easing } from "react-native-reanimated";
import { MOTION } from "@/theme/motion";

export const QUICK_ENTRY_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

export function quickEntryTransitionDuration(open: boolean, reduceMotion: boolean): number {
  if (reduceMotion) return MOTION.duration.instant;
  return open ? 320 : 240;
}

export interface QuickEntryAnchorMotion {
  readonly translateY: number;
  readonly pivotY: number;
}

export function quickEntryAnchorMotion(
  anchor: CalendarAnchorRect,
  placement: CalendarPopupPlacement,
  popupHeight: number,
): QuickEntryAnchorMotion {
  const below = placement.direction === "BELOW";
  const edge = below ? 0 : popupHeight;
  return {
    translateY: anchor.y + (below ? anchor.height : 0) - (placement.top + edge),
    pivotY: below ? -popupHeight / 2 : popupHeight / 2,
  };
}
