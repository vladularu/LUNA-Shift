import { useEffect, useRef } from "react";
import { findNodeHandle, Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { useInversePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY, TEXT_MAX_SCALE } from "@/theme/typography";
import { scheduleAccessibilityFocus } from "@/ui/accessibility-focus";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

const FOOTER_ENTERING = FadeIn.duration(140).reduceMotion(ReduceMotion.System);

export function QuickEntryDeleteConfirmation({
  title,
  busy,
  error,
  minHeight,
  onLayout,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly minHeight: number;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const palette = useInversePalette();
  const cancel = useRef<View>(null);
  useEffect(() => {
    scheduleAccessibilityFocus(findNodeHandle(cancel.current));
  }, []);
  return (
    <Animated.View
      testID="quick-entry-delete-confirmation"
      accessibilityViewIsModal
      accessibilityLabel={`${title} löschen?`}
      onAccessibilityEscape={onCancel}
      onLayout={onLayout}
      entering={FOOTER_ENTERING}
      style={{
        backgroundColor: palette.surfaceRaised,
        borderTopWidth: 1,
        borderTopColor: palette.separator,
        flexShrink: 0,
      }}
    >
      {error ? (
        <Text
          accessibilityRole="alert"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{
            ...TYPOGRAPHY.caption,
            color: palette.danger,
            paddingHorizontal: SPACING.lg,
            paddingTop: SPACING.sm,
          }}
        >
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", minHeight: minHeight - 1 }}>
        <Pressable
          ref={cancel}
          accessibilityRole="button"
          accessibilityLabel="Löschen abbrechen"
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          onPress={onCancel}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.sm,
            alignItems: "center",
            justifyContent: "center",
            opacity: busy || pressed ? 0.5 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              ...TYPOGRAPHY.small,
              color: palette.textMuted,
              textAlign: "center",
              flexShrink: 1,
            }}
          >
            Abbrechen
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} endgültig löschen`}
          disabled={busy}
          accessibilityState={{ disabled: busy, busy }}
          onPress={onConfirm}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.sm,
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            justifyContent: "center",
            opacity: busy || pressed ? 0.5 : 1,
          })}
        >
          <Ionicons accessible={false} color={palette.danger} name="trash-outline" size={18} />
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{
              ...TYPOGRAPHY.small,
              color: palette.danger,
              textAlign: "center",
              flexShrink: 1,
            }}
          >
            {busy ? "Löscht …" : "Löschen"}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
