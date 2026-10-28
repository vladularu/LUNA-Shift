import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

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
  const pressMotion = usePressMotion(1, 0.95);
  const detail =
    active && isStampAction
      ? action.template.allDay
        ? ["Ganztägig"]
        : action.template.startTime && action.template.endTime
          ? [action.template.startTime, action.template.endTime]
          : ["Ohne Zeit"]
      : null;
  const labelWidth = width - (detail ? detailWidth : 0);

  return (
    <AnimatedPressable
      accessibilityLabel={`${action.label} auswählen`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      accessibilityValue={detail ? { text: detail.join(" bis ") } : undefined}
      disabled={disabled}
      onPress={() => onPress(action)}
      onPressIn={pressMotion.onPressIn}
      onPressOut={pressMotion.onPressOut}
      style={[styles.tile, { width }, pressMotion.animatedStyle]}
    >
      <View style={[styles.template, { width: labelWidth }]}>
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
      </View>
      {detail ? (
        <View
          style={[styles.details, { width: detailWidth }]}
          testID={`quick-planner-detail-${action.key}`}
        >
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
