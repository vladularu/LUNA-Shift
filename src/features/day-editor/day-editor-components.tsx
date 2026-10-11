import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { CORNER_CURVE, RADII } from "@/theme/tokens";
import { INTER_FONTS } from "@/theme/shadcn";
import Ionicons from "@/ui/icon";
import { Pressable, View } from "react-native";

import { formatDateTitle } from "@/engine/calendar";
import { usePalette } from "@/theme/palette";
import { SurfaceCard } from "@/ui/design-system";

export function EditorCloseButton({
  busy,
  onPress,
}: {
  readonly busy: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityLabel="Schließen und speichern"
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: busy ? 0.4 : pressed ? 0.58 : 1,
      })}
    >
      <Ionicons color={palette.text} name="close" size={25} />
    </Pressable>
  );
}

export function EditorDateHeader({
  date,
  label,
}: {
  readonly date: string;
  readonly label: string;
}) {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel={`Datum: ${formatDateTitle(date)}`}
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 2,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: RADII.control,
          borderCurve: CORNER_CURVE,
          backgroundColor: palette.primarySoft,
        }}
      >
        <Text
          style={{
            color: palette.primary,
            fontFamily: INTER_FONTS.semibold,
            fontSize: TYPOGRAPHY.label.fontSize,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {date.slice(-2)}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          selectable
          style={{
            color: palette.text,
            fontFamily: INTER_FONTS.semibold,
            fontSize: TYPOGRAPHY.compact.fontSize,
            fontWeight: "600",
          }}
        >
          {formatDateTitle(date)}
        </Text>
        <Text
          style={{
            color: palette.textMuted,
            fontFamily: INTER_FONTS.semibold,
            fontSize: TYPOGRAPHY.caption.fontSize,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

export function InlineDeleteConfirmation({
  onCancel,
  onDelete,
  series,
}: {
  readonly onCancel: () => void;
  readonly onDelete: () => void;
  readonly series: boolean;
}) {
  const palette = usePalette();
  return (
    <SurfaceCard style={{ gap: 12, borderColor: palette.danger, padding: 16 }}>
      <Text
        style={{
          color: palette.text,
          fontFamily: INTER_FONTS.bold,
          fontSize: TYPOGRAPHY.body.fontSize,
          fontWeight: "700",
        }}
      >
        {series ? "Gesamte Serie löschen?" : "Eintrag löschen?"}
      </Text>
      <Text
        style={{
          color: palette.textMuted,
          fontFamily: INTER_FONTS.regular,
          fontSize: TYPOGRAPHY.small.fontSize,
          lineHeight: TYPOGRAPHY.small.lineHeight,
        }}
      >
        {series
          ? "Alle Termine dieser Serie werden gelöscht."
          : "Dieser Eintrag wird aus dem Kalender entfernt."}
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onCancel}
          style={{
            borderCurve: CORNER_CURVE,
            flex: 1,
            minHeight: 46,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: RADII.control,
            backgroundColor: palette.surfaceMuted,
          }}
        >
          <Text style={{ color: palette.text, fontWeight: "600" }}>Abbrechen</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={{
            borderCurve: CORNER_CURVE,
            flex: 1,
            minHeight: 46,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: RADII.control,
            backgroundColor: palette.danger,
          }}
        >
          <Text style={{ color: palette.onDanger, fontWeight: "700" }}>Löschen</Text>
        </Pressable>
      </View>
    </SurfaceCard>
  );
}

export function AdvancedDisclosure({
  color,
  expanded,
  onPress,
  summary,
}: {
  readonly color: string;
  readonly expanded: boolean;
  readonly onPress: () => void;
  readonly summary: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: palette.separator,
        backgroundColor: pressed ? palette.surfaceMuted : "transparent",
        opacity: pressed ? 0.78 : 1,
        paddingTop: 6,
      })}
    >
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            color: palette.text,
            fontFamily: INTER_FONTS.semibold,
            fontSize: TYPOGRAPHY.small.fontSize,
            fontWeight: "600",
          }}
        >
          Weitere Angaben
        </Text>
        <Text
          style={{
            color: palette.textMuted,
            fontFamily: INTER_FONTS.semibold,
            fontSize: TYPOGRAPHY.caption.fontSize,
            fontWeight: "600",
          }}
        >
          {summary}
        </Text>
      </View>
      <Ionicons color={palette.primary} name={expanded ? "remove" : "add"} size={19} />
    </Pressable>
  );
}
