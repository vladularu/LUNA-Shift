import { QUICK_PLANNER_METRICS } from "./quick-planner-appearance";
import { TEXT_MAX_SCALE } from "@/theme/typography";

export const QUICK_ENTRY_VISIBLE_SLOTS = 5;

export function quickEntryStripLayout({
  viewportWidth,
  actionCount,
  activeIndex,
  fontScale,
}: {
  readonly viewportWidth: number;
  readonly actionCount: number;
  readonly activeIndex: number;
  readonly fontScale: number;
}) {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 320;
  const slotWidth = width / QUICK_ENTRY_VISIBLE_SLOTS;
  const scale = Number.isFinite(fontScale) ? Math.max(1, Math.min(fontScale, TEXT_MAX_SCALE)) : 1;
  const detailSlots = Math.ceil((QUICK_PLANNER_METRICS.activeDetailWidth * scale) / slotWidth);
  const detailWidth = detailSlots * slotWidth;
  const active = activeIndex >= 0 && activeIndex < actionCount;
  const overflowSlots = Math.max(
    0,
    actionCount + (active ? detailSlots : 0) - QUICK_ENTRY_VISIBLE_SLOTS,
  );
  // Reserve disclosure space before it animates. Native content bounds therefore
  // stay fixed when selecting/deselecting and cannot clamp the user's offset.
  return {
    viewportWidth: width,
    slotWidth,
    detailWidth,
    contentWidth: Math.max(width, (actionCount + detailSlots) * slotWidth),
    maximumOffset: overflowSlots * slotWidth,
    snapToOffsets: Array.from({ length: overflowSlots + 1 }, (_, slot) => slot * slotWidth),
  };
}

/** Center the open service/time pair, or the service alone when it closes. */
export function quickEntryCenteredOffset({
  layout,
  activeIndex,
  expanded,
}: {
  readonly layout: Pick<
    ReturnType<typeof quickEntryStripLayout>,
    "slotWidth" | "detailWidth" | "viewportWidth" | "maximumOffset"
  >;
  readonly activeIndex: number;
  readonly expanded: boolean;
}) {
  if (activeIndex < 0) return null;
  const { slotWidth, detailWidth, viewportWidth, maximumOffset } = layout;
  const center = activeIndex * slotWidth + (slotWidth + (expanded ? detailWidth : 0)) / 2;
  return Math.min(maximumOffset, Math.max(0, center - viewportWidth / 2));
}
