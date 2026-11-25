import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import {
  entryEditDurationLabel,
  entryEditShortDate,
} from "@/features/day-editor/entry-edit-overlay-pattern";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING, MINIMUM_TOUCH_TARGET } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

export interface EntryEditHeaderProps {
  readonly date: string;
  readonly durationMinutes: number | null;
  readonly headerColor: string;
  readonly headerLeading?: ReactNode;
  readonly headerSubtitle?: string;
  readonly headerSubtitleControl?: (disabled: boolean) => ReactNode;
  readonly hideHeaderDuration?: boolean;
  readonly headerAccessibilityLabel?: string;
  readonly onHeaderPress?: () => void;
  readonly onDelete?: (() => void) | undefined;
  readonly deleteLabel?: string;
}

export function EntryEditHeader({
  busy,
  date,
  durationMinutes,
  headerColor,
  headerLeading,
  headerSubtitle,
  headerSubtitleControl,
  hideHeaderDuration,
  headerAccessibilityLabel,
  onHeaderPress,
  onDelete,
  deleteLabel = "Eintrag löschen",
}: EntryEditHeaderProps & {
  readonly busy: boolean;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const heading = (
    <>
      <View style={[styles.badge, { backgroundColor: `${headerColor}18` }]}>{headerLeading}</View>
      <View style={styles.identity}>
        <Text style={[TYPOGRAPHY.sectionTitle, { color: palette.text }]}>
          {entryEditShortDate(date)}
        </Text>
        {headerSubtitleControl ? (
          headerSubtitleControl(busy)
        ) : (
          <View style={styles.subtitle}>
            <Text style={[TYPOGRAPHY.small, { color: palette.textMuted }]}>{headerSubtitle}</Text>
            {onHeaderPress ? (
              <Ionicons
                accessibilityElementsHidden
                name="chevron-forward"
                size={14}
                color={palette.textMuted}
              />
            ) : null}
          </View>
        )}
      </View>
    </>
  );
  return (
    <View style={styles.header}>
      <View style={[styles.summary, fontScale >= 1.6 && styles.largeSummary]}>
        {onHeaderPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={headerAccessibilityLabel}
            disabled={busy}
            onPress={onHeaderPress}
            style={[styles.heading, fontScale >= 1.6 && styles.largeHeading]}
          >
            {heading}
          </Pressable>
        ) : (
          <View style={[styles.heading, fontScale >= 1.6 && styles.largeHeading]}>{heading}</View>
        )}
        {!hideHeaderDuration ? (
          <View style={styles.duration}>
            <Text style={[TYPOGRAPHY.bodyStrong, { color: palette.text }]}>
              {entryEditDurationLabel(durationMinutes)}
            </Text>
            {durationMinutes !== null ? (
              <Text style={[TYPOGRAPHY.caption, { color: palette.textMuted }]}>
                {headerSubtitle === "Termin" ? "Dauer" : "ohne Pause"}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          disabled={busy}
          onPress={onDelete}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
        >
          <Ionicons
            accessibilityElementsHidden
            name="trash-outline"
            color={palette.danger}
            size={22}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    zIndex: 4,
  },
  summary: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  largeSummary: { flexDirection: "column", alignItems: "flex-start" },
  largeHeading: { flex: undefined },
  heading: {
    flex: 1,
    minWidth: 0,
    minHeight: MINIMUM_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: RADII.control,
    borderCurve: CORNER_CURVE,
    alignItems: "center",
    justifyContent: "center",
  },
  identity: { flex: 1, minWidth: 0 },
  subtitle: { flexDirection: "row", alignItems: "center", gap: SPACING.xxs },
  duration: { alignItems: "flex-end" },
  deleteButton: {
    minWidth: MINIMUM_TOUCH_TARGET,
    minHeight: MINIMUM_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
