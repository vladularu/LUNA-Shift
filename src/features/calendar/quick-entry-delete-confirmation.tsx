import { useEffect, useRef } from "react";
import { findNodeHandle, Pressable, View, type LayoutChangeEvent } from "react-native";

import { useInversePalette } from "@/theme/palette";
import { RADII, SHADOWS } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { scheduleAccessibilityFocus } from "@/ui/accessibility-focus";
import { Text } from "@/ui/text";

export function QuickEntryDeleteConfirmation({
  title,
  busy,
  error,
  top,
  left,
  width,
  onLayout,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly top: number;
  readonly left: number;
  readonly width: number;
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
    <View
      testID="quick-entry-delete-confirmation"
      accessibilityViewIsModal
      accessibilityLabel={`${title} löschen?`}
      onAccessibilityEscape={onCancel}
      onLayout={onLayout}
      style={{
        position: "absolute",
        top,
        left,
        width,
        padding: 6,
        gap: 6,
        borderRadius: RADII.card,
        backgroundColor: palette.surfaceRaised,
        borderWidth: 1,
        borderColor: palette.border,
        boxShadow: SHADOWS.overlay,
        zIndex: 10_002,
        elevation: 26,
      }}
    >
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ ...TYPOGRAPHY.caption, color: palette.danger, padding: 8 }}
        >
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 6 }}>
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
            padding: 10,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: RADII.card,
            backgroundColor: palette.surfaceMuted,
            opacity: busy || pressed ? 0.5 : 1,
          })}
        >
          <Text style={{ ...TYPOGRAPHY.label, color: palette.text }}>Abbrechen</Text>
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
            padding: 10,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: RADII.card,
            backgroundColor: palette.surfaceMuted,
            opacity: busy || pressed ? 0.5 : 1,
          })}
        >
          <Text style={{ ...TYPOGRAPHY.label, color: palette.danger }}>
            {busy ? "Löscht …" : "Löschen"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
