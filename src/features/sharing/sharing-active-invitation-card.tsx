import { Pressable, StyleSheet, View } from "react-native";
import { Copy } from "lucide-react-native";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, SurfaceCard } from "@/ui/design-system";

export function SharingActiveInvitationCard({
  title,
  caption,
  name,
  remaining,
  joined,
  busy,
  copyLabel,
  onOpen,
  onCopy,
  onStop,
}: {
  readonly title: string;
  readonly caption?: string;
  readonly name: string;
  readonly remaining: string;
  readonly joined: string;
  readonly busy: boolean;
  readonly copyLabel: string;
  readonly onOpen?: () => void;
  readonly onCopy?: () => void;
  readonly onStop: () => void;
}) {
  const palette = usePalette();
  return (
    <SurfaceCard>
      <View style={styles.row}>
        <Pressable
          accessibilityRole={onOpen ? "button" : undefined}
          accessibilityLabel="Einladung öffnen"
          accessibilityHint={title}
          disabled={busy || !onOpen}
          onPress={onOpen}
          style={styles.link}
        >
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text }}
          >
            {title}
          </Text>
          {caption ? (
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>{caption}</Text>
          ) : null}
        </Pressable>
        {onCopy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copyLabel}
            disabled={busy}
            onPress={onCopy}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Copy size={22} color={palette.primary} accessible={false} />
          </Pressable>
        ) : null}
      </View>
      <CardSeparator />
      <View style={styles.details}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...TYPOGRAPHY.caption, color: palette.primary }}
        >{`Läuft ab in: ${remaining}`}</Text>
        <Text style={{ ...TYPOGRAPHY.caption, color: palette.text }}>{name}</Text>
        <View style={styles.footer}>
          <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted, flex: 1 }}>{joined}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Einladung stoppen"
            disabled={busy}
            onPress={onStop}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.danger }}>Stop</Text>
          </Pressable>
        </View>
      </View>
    </SurfaceCard>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md },
  link: { flex: 1, minHeight: 44, justifyContent: "center", paddingVertical: SPACING.sm },
  action: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  details: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.xs },
  footer: { flexDirection: "row", alignItems: "center" },
});
