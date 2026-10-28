import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { memo, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { MOTION } from "@/theme/motion";

import type { QuickEntryAction } from "@/features/calendar/quick-entry-actions";
import {
  QUICK_PLANNER_COLORS,
  QUICK_PLANNER_METRICS,
} from "@/features/calendar/quick-planner-appearance";
import { APPOINTMENT_COLOR, useInversePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { ColorBadge } from "@/ui/design-system";
import { AnimatedPressable, usePressMotion } from "@/ui/press-motion";

export const QuickEntryActionTile = memo(function QuickEntryActionTile({
  action,
  active = false,
  disabled = false,
  onPress,
  width = 72,
  detailWidth = QUICK_PLANNER_METRICS.activeDetailWidth,
}: {
  readonly action: QuickEntryAction;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onPress: (action: QuickEntryAction) => void;
  readonly width?: number;
  readonly detailWidth?: number;
}) {
  const palette = useInversePalette();
  const isStampAction = action.kind === "TEMPLATE";
  const editorIcon = action.kind === "APPOINTMENT" ? "calendar-outline" : "add";
  const editorColor =
    action.kind === "APPOINTMENT" ? APPOINTMENT_COLOR : QUICK_PLANNER_COLORS.active;
  const pressMotion = usePressMotion(1, MOTION.scale.press);
  const reduceMotion = useReducedMotion();
  const showDetail = active && isStampAction;
  const selection = useSharedValue(showDetail ? 1 : 0);
  const previousActive = useRef(showDetail);
  useEffect(() => {
    if (previousActive.current === showDetail) return;
    previousActive.current = showDetail;
    selection.value = reduceMotion
      ? showDetail
        ? 1
        : 0
      : withTiming(showDetail ? 1 : 0, {
          duration: MOTION.duration.normal,
          easing: MOTION.easing.calm,
        });
  }, [showDetail, selection, reduceMotion]);
  useEffect(() => () => cancelAnimation(selection), [selection]);
  const labelWidth = width - (showDetail ? detailWidth : 0);
  const tileMotion = useAnimatedStyle(() => ({
    width: labelWidth + detailWidth * selection.value,
  }));
  const templateMotion = useAnimatedStyle(() => ({
    transform: [
      { translateY: reduceMotion ? 0 : -MOTION.distance.subtle * selection.value },
      { scale: reduceMotion ? 1 : 1 + (1 - MOTION.scale.emphasis) * selection.value },
    ],
  }));
  const detailMotion = useAnimatedStyle(() => ({
    width: detailWidth * selection.value,
    opacity: selection.value,
    transform: [{ translateX: reduceMotion ? 0 : -MOTION.distance.subtle * (1 - selection.value) }],
  }));
  const detail = isStampAction
    ? action.template.allDay
      ? ["Ganztägig"]
      : action.template.startTime && action.template.endTime
        ? [action.template.startTime, action.template.endTime]
        : ["Ohne Zeit"]
    : null;

  return (
    <AnimatedPressable
      accessibilityLabel={`${action.label} auswählen`}
      accessibilityHint={active ? "Erneut antippen, um die Vorlage abzuwählen." : undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      accessibilityValue={showDetail && detail ? { text: detail.join(" bis ") } : undefined}
      disabled={disabled}
      onPress={() => onPress(action)}
      onPressIn={pressMotion.onPressIn}
      onPressOut={pressMotion.onPressOut}
      style={[styles.tile, tileMotion, pressMotion.animatedStyle]}
    >
      <Animated.View
        style={[styles.template, { width: labelWidth }, templateMotion]}
        testID={`quick-planner-template-${action.key}`}
      >
        <View
          style={[styles.badgeRing, active && { borderColor: palette.primary }]}
          testID={`quick-planner-badge-${action.key}`}
        >
          {isStampAction ? (
            <ColorBadge
              color={action.color}
              label={action.symbol}
              size={QUICK_PLANNER_METRICS.badgeSize}
            />
          ) : (
            <View style={[styles.editorBadge, { backgroundColor: editorColor }]}>
              <Ionicons
                accessible={false}
                color={QUICK_PLANNER_COLORS.onColor}
                name={editorIcon}
                size={16}
              />
            </View>
          )}
        </View>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={[
            styles.label,
            {
              color: active ? palette.primary : palette.text,
              maxWidth: labelWidth - 6,
            },
            active && styles.labelActive,
          ]}
        >
          {action.label}
        </Text>
      </Animated.View>
      {detail ? (
        <Animated.View
          accessibilityElementsHidden={!showDetail}
          importantForAccessibility={showDetail ? "auto" : "no-hide-descendants"}
          pointerEvents="none"
          style={[styles.detailClip, detailMotion]}
          testID={`quick-planner-detail-${action.key}`}
        >
          <View style={[styles.details, { width: detailWidth }]}>
            {detail.map((line, index) => (
              <Text
                key={index}
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={[styles.time, { color: palette.text }]}
              >
                {line}
              </Text>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    minHeight: QUICK_PLANNER_METRICS.tileHeight,
    flexDirection: "row",
    alignItems: "center",
  },
  template: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  details: {
    paddingRight: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  detailClip: {
    overflow: "hidden",
  },
  time: {
    fontFamily: INTER_FONTS.medium,
    fontSize: TYPOGRAPHY.overline.fontSize,
    lineHeight: TYPOGRAPHY.micro.lineHeight,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  badgeRing: {
    width: QUICK_PLANNER_METRICS.badgeRingSize,
    height: QUICK_PLANNER_METRICS.badgeRingSize,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: QUICK_PLANNER_METRICS.badgeRingSize / 2,
  },
  editorBadge: {
    width: QUICK_PLANNER_METRICS.badgeSize,
    height: QUICK_PLANNER_METRICS.badgeSize,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: QUICK_PLANNER_METRICS.badgeSize / 2,
  },
  label: {
    fontFamily: INTER_FONTS.medium,
    fontSize: TYPOGRAPHY.overline.fontSize,
    lineHeight: TYPOGRAPHY.micro.lineHeight,
    fontWeight: "500",
    textAlign: "center",
  },
  labelActive: {
    fontWeight: "600",
  },
});
