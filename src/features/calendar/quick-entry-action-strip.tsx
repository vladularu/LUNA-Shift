import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import type { QuickEntryAction } from "@/features/calendar/quick-entry-actions";
import { QuickEntryActionTile } from "@/features/calendar/quick-entry-action-tile";
import { QUICK_PLANNER_METRICS } from "@/features/calendar/quick-planner-appearance";
import { usePalette } from "@/theme/palette";
import {
  QUICK_ENTRY_VISIBLE_SLOTS,
  quickEntryCenteredOffset,
  quickEntryStripLayout,
} from "./quick-entry-strip-layout";

export const QuickEntryActionStrip = memo(function QuickEntryActionStrip({
  actions,
  activeKey = null,
  busy,
  onSelectAction,
  tileWidth,
}: {
  readonly actions: readonly QuickEntryAction[];
  readonly activeKey?: string | null;
  readonly busy: boolean;
  readonly onSelectAction: (action: QuickEntryAction) => void;
  readonly tileWidth: number;
}) {
  const palette = usePalette();
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(tileWidth * QUICK_ENTRY_VISIBLE_SLOTS);
  const resizeOffset = useRef<{ slots: number; width: number } | null>(null);
  const nativeOffset = useRef(0);
  const scrollTarget = useRef<number | null>(null);
  const centeredSelection = useRef<{ key: string; index: number } | null>(null);
  const activeIndex = actions.findIndex(
    (action) => action.key === activeKey && action.kind === "TEMPLATE",
  );
  const layout = quickEntryStripLayout({
    viewportWidth,
    actionCount: actions.length,
    activeIndex,
    fontScale,
  });
  const { slotWidth, detailWidth, contentWidth, maximumOffset, snapToOffsets } = layout;
  const previousSelection = useRef<{ key: string | null; index: number }>({ key: null, index: -1 });
  const moveStrip = useCallback((x: number, animated: boolean) => {
    if (scrollTarget.current !== null && Math.abs(scrollTarget.current - x) < 0.01) return;
    if (scrollTarget.current === null && Math.abs(nativeOffset.current - x) < 0.01) return;
    scrollTarget.current = x;
    scrollRef.current?.scrollTo({ x, animated });
  }, []);
  useEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = { key: activeKey, index: activeIndex };
    if (
      activeIndex >= 0 &&
      activeKey &&
      (previous.key !== activeKey || previous.index !== activeIndex)
    ) {
      centeredSelection.current = { key: activeKey, index: activeIndex };
    }
    if (resizeOffset.current !== null) return;
    const centered = centeredSelection.current;
    if (centered) {
      const expanded = activeIndex >= 0 && activeKey === centered.key;
      const target = quickEntryCenteredOffset({
        layout: { slotWidth, detailWidth, viewportWidth, maximumOffset },
        activeIndex: centered.index,
        expanded,
      });
      if (!expanded) centeredSelection.current = null;
      if (target !== null) moveStrip(target, !reduceMotion);
    } else if ((scrollTarget.current ?? nativeOffset.current) > maximumOffset) {
      moveStrip(maximumOffset, !reduceMotion);
    }
  }, [
    activeIndex,
    activeKey,
    contentWidth,
    detailWidth,
    maximumOffset,
    moveStrip,
    viewportWidth,
    reduceMotion,
    slotWidth,
  ]);

  return (
    <ScrollView
      ref={scrollRef}
      accessibilityLabel="Schnellauswahl"
      alwaysBounceHorizontal={false}
      bounces={maximumOffset > 0}
      scrollEnabled={maximumOffset > 0}
      contentContainerStyle={[styles.content, { width: contentWidth }]}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      decelerationRate="fast"
      directionalLockEnabled
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      snapToAlignment="start"
      snapToOffsets={snapToOffsets}
      snapToEnd={false}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (width <= 0 || width === viewportWidth) return;
        const offset = scrollTarget.current ?? nativeOffset.current;
        scrollTarget.current = null;
        resizeOffset.current = { slots: offset / slotWidth, width };
        setViewportWidth(width);
      }}
      onContentSizeChange={(nativeContentWidth) => {
        const target = resizeOffset.current;
        if (
          !target ||
          target.width !== viewportWidth ||
          Math.abs(nativeContentWidth - contentWidth) > 1
        )
          return;
        resizeOffset.current = null;
        const centered = centeredSelection.current;
        if (centered) {
          const expanded = activeIndex >= 0 && activeKey === centered.key;
          const offset = quickEntryCenteredOffset({
            layout,
            activeIndex: centered.index,
            expanded,
          });
          if (!expanded) centeredSelection.current = null;
          if (offset !== null) moveStrip(offset, false);
        } else {
          moveStrip(Math.min(target.slots * slotWidth, maximumOffset), false);
        }
      }}
      scrollEventThrottle={16}
      onScroll={(event) => {
        nativeOffset.current = event.nativeEvent.contentOffset.x;
      }}
      onScrollBeginDrag={() => {
        centeredSelection.current = null;
        scrollTarget.current = null;
      }}
      onScrollEndDrag={(event) => {
        const target =
          event.nativeEvent.targetContentOffset?.x ?? event.nativeEvent.contentOffset.x;
        if (target > maximumOffset) {
          moveStrip(maximumOffset, !reduceMotion);
        }
      }}
      onMomentumScrollEnd={(event) => {
        const x = event.nativeEvent.contentOffset.x;
        nativeOffset.current = x;
        if (scrollTarget.current !== null && Math.abs(x - scrollTarget.current) > 1) return;
        scrollTarget.current = null;
        if (x > maximumOffset) moveStrip(maximumOffset, !reduceMotion);
      }}
      style={styles.scroll}
      testID="quick-planner-strip"
    >
      {actions.map((action, index) => (
        <View key={action.key}>
          <QuickEntryActionTile
            action={action}
            active={activeKey === action.key}
            disabled={busy}
            onPress={onSelectAction}
            width={layout.slotWidth + (index === activeIndex ? layout.detailWidth : 0)}
            detailWidth={layout.detailWidth}
          />
          {index === actions.length - 1 ? null : (
            <View style={[styles.separator, { backgroundColor: palette.text }]} />
          )}
        </View>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    minHeight: QUICK_PLANNER_METRICS.tileHeight,
    alignItems: "center",
  },
  separator: {
    position: "absolute",
    right: 0,
    top: (QUICK_PLANNER_METRICS.tileHeight - 50) / 2,
    width: StyleSheet.hairlineWidth,
    height: 50,
    opacity: 0.2,
  },
});
