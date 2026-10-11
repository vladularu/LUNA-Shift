import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import {
  entryEditDurationLabel,
  entryEditShortDate,
} from "@/features/day-editor/entry-edit-overlay-pattern";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING, MINIMUM_TOUCH_TARGET } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

export interface EntryEditHeaderProps {
  readonly date: string;
  readonly durationMinutes: number | null;
  readonly headerColor: string;
  readonly headerLeading?: ReactNode;
  readonly headerSubtitle?: string;
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
  headerAccessibilityLabel,
  onHeaderPress,
  onDelete,
  menuVisible,
  onMenuPress,
}: EntryEditHeaderProps & {
  readonly busy: boolean;
  readonly menuVisible: boolean;
  readonly onMenuPress: () => void;
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
      </View>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Weitere Aktionen"
          accessibilityState={{ expanded: menuVisible }}
          disabled={busy}
          onPress={onMenuPress}
          style={styles.more}
        >
          <Ionicons
            accessibilityElementsHidden
            name="ellipsis-horizontal-circle"
            color={palette.textMuted}
            size={22}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

// Rendered in the sheet root so native hit testing includes the entire menu.
export function EntryEditActionMenu({
  top,
  label,
  onDelete,
  onClose,
}: {
  readonly top: number;
  readonly label: string;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const palette = usePalette();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Aktionsmenü schließen"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
      />
      <SurfaceCard style={{ ...styles.menu, top }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => {
            onClose();
            onDelete();
          }}
          style={styles.deleteAction}
        >
          <Ionicons
            accessibilityElementsHidden
            name="trash-outline"
            color={palette.danger}
            size={20}
          />
          <Text style={[TYPOGRAPHY.body, { color: palette.danger }]}>{label}</Text>
        </Pressable>
      </SurfaceCard>
    </>
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
  more: {
    minWidth: MINIMUM_TOUCH_TARGET,
    minHeight: MINIMUM_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: { position: "absolute", right: SPACING.lg, maxWidth: "90%", zIndex: 6 },
  deleteAction: {
    minHeight: MINIMUM_TOUCH_TARGET,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
});
