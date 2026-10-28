import { Fragment, memo, useCallback, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import type { QuickEntryAction } from "@/features/calendar/quick-entry-actions";
import { QuickEntryActionTile } from "@/features/calendar/quick-entry-action-tile";
import { QUICK_PLANNER_METRICS } from "@/features/calendar/quick-planner-appearance";
import { usePalette } from "@/theme/palette";
import { MOTION } from "@/theme/motion";

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
  const detailWidth = QUICK_PLANNER_METRICS.activeDetailWidth * Math.max(1, fontScale);
  const scrollRef = useRef<ScrollView>(null);
  const viewportWidth = useRef(0);
  const activeIndex = actions.findIndex(
    (action) => action.key === activeKey && action.kind === "TEMPLATE",
  );
  const revealActive = useCallback(() => {
    if (activeIndex < 0 || viewportWidth.current <= 0) return;
    const left = 2 + activeIndex * (tileWidth + StyleSheet.hairlineWidth);
    const activeWidth = tileWidth + detailWidth;
    scrollRef.current?.scrollTo({
      x: Math.max(0, left - (viewportWidth.current - activeWidth) / 2),
      animated: !reduceMotion,
    });
  }, [activeIndex, tileWidth, detailWidth, reduceMotion]);
  useEffect(() => {
    if (activeIndex < 0) return;
    revealActive();
    // Animated tile widths emit many content-size events. Recenter once after
    // expansion so the final template is visible without restarting the scroll each frame.
    const timeout = setTimeout(revealActive, reduceMotion ? 0 : MOTION.duration.normal);
    return () => clearTimeout(timeout);
  }, [activeIndex, reduceMotion, revealActive]);
  const offsets = actions.map(
    (_, index) =>
      index * (tileWidth + StyleSheet.hairlineWidth) +
      (activeIndex >= 0 && index > activeIndex ? detailWidth : 0),
  );

  return (
    <ScrollView
      ref={scrollRef}
      accessibilityLabel="Schnellauswahl"
      alwaysBounceHorizontal={false}
      bounces={actions.length > 5 || activeIndex >= 0}
      contentContainerStyle={styles.content}
      decelerationRate="fast"
      directionalLockEnabled
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      snapToAlignment="start"
      snapToOffsets={offsets}
      onLayout={(event) => {
        viewportWidth.current = event.nativeEvent.layout.width;
        revealActive();
      }}
      style={styles.scroll}
      testID="quick-planner-strip"
    >
      {actions.map((action, index) => (
        <Fragment key={action.key}>
          <QuickEntryActionTile
            action={action}
            active={activeKey === action.key}
            disabled={busy}
            onPress={onSelectAction}
            width={tileWidth + (index === activeIndex ? detailWidth : 0)}
            detailWidth={detailWidth}
          />
          {index === actions.length - 1 ? null : (
            <View style={[styles.separator, { backgroundColor: palette.text }]} />
          )}
        </Fragment>
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
    paddingHorizontal: 2,
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: 50,
    opacity: 0.2,
  },
});
