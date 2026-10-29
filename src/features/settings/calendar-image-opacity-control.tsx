import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { MAX_CALENDAR_IMAGE_OPACITY } from "@/theme/calendar-image";
import { MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";

export function CalendarImageOpacityControl({
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  readonly value: number;
  readonly disabled: boolean;
  readonly onPreview: (value: number | null) => void;
  readonly onCommit: (value: number) => void;
}) {
  const palette = usePalette();
  const position = (value / MAX_CALENDAR_IMAGE_OPACITY) * 100;
  const width = useRef(0);
  const drag = useRef<{ pageX: number; locationX: number; value: number } | null>(null);
  const cancel = useRef(onPreview);
  useEffect(() => {
    cancel.current = onPreview;
  }, [onPreview]);
  useEffect(
    () => () => {
      if (drag.current) cancel.current(null);
    },
    [],
  );
  function update(locationX: number) {
    if (!drag.current || width.current <= 0) return;
    const next = Math.round(
      Math.max(0, Math.min(1, locationX / width.current)) * MAX_CALENDAR_IMAGE_OPACITY,
    );
    drag.current.value = next;
    onPreview(next);
  }
  return (
    <View style={{ gap: SPACING.xxs, opacity: disabled ? 0.5 : 1 }}>
      <View style={styles.labels}>
        <Text style={{ ...TYPOGRAPHY.body, color: palette.text }}>Deckkraft</Text>
        <Text style={{ ...TYPOGRAPHY.body, color: palette.textSecondary }}>{value} %</Text>
      </View>
      <View
        testID="calendar-image-opacity-slider"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Deckkraft des Kalenderfotos"
        accessibilityHint="In Schritten von einem Prozent anpassen."
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: 0,
          max: MAX_CALENDAR_IMAGE_OPACITY,
          now: value,
          text: `${value} Prozent`,
        }}
        accessibilityActions={[
          { name: "increment", label: "Ein Prozent mehr" },
          { name: "decrement", label: "Ein Prozent weniger" },
        ]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const action = event.nativeEvent.actionName;
          const next =
            action === "increment"
              ? Math.min(MAX_CALENDAR_IMAGE_OPACITY, value + 1)
              : action === "decrement"
                ? Math.max(0, value - 1)
                : value;
          if (next !== value) onCommit(next);
        }}
        onLayout={(event) => {
          width.current = event.nativeEvent.layout.width - SPACING.xl;
        }}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          if (disabled) return;
          drag.current = {
            pageX: event.nativeEvent.pageX,
            locationX: event.nativeEvent.locationX,
            value,
          };
          update(event.nativeEvent.locationX - SPACING.md);
        }}
        onResponderMove={(event) => {
          if (disabled || !drag.current) return;
          update(
            drag.current.locationX + event.nativeEvent.pageX - drag.current.pageX - SPACING.md,
          );
        }}
        onResponderRelease={() => {
          const next = drag.current?.value;
          drag.current = null;
          if (next !== undefined) onCommit(next);
        }}
        onResponderTerminate={() => {
          drag.current = null;
          onPreview(null);
        }}
        style={styles.touchArea}
      >
        <View
          pointerEvents="none"
          style={[styles.track, { backgroundColor: palette.selectionTrack }]}
        >
          <View
            style={[styles.fill, { width: `${position}%`, backgroundColor: palette.primary }]}
          />
          <View
            style={[
              styles.thumb,
              { left: `${position}%`, backgroundColor: palette.text, borderColor: palette.surface },
            ]}
          />
        </View>
      </View>
      <View style={styles.labels} accessibilityElementsHidden>
        <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>0 %</Text>
        <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
          {MAX_CALENDAR_IMAGE_OPACITY} %
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: SPACING.sm,
    flexWrap: "wrap",
  },
  touchArea: {
    minHeight: MINIMUM_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: SPACING.md,
  },
  track: { height: SPACING.xxs, borderRadius: RADII.pill },
  fill: { height: SPACING.xxs, borderRadius: RADII.pill },
  thumb: {
    position: "absolute",
    top: (SPACING.xxs - SPACING.xl) / 2,
    marginLeft: -SPACING.md,
    width: SPACING.xl,
    height: SPACING.xl,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
});
