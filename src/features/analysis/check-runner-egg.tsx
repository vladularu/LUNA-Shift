import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { Text } from "@/ui/text";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { DinoRunnerGame, DinoRunnerIcon } from "./dino-runner-game";

export function CheckRunnerEgg({
  title,
  active = true,
}: {
  readonly title: string;
  readonly active?: boolean;
}) {
  const p = usePalette();
  const lastTap = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!active) {
      setOpen(false);
      lastTap.current = null;
    }
  }, [active]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        lastTap.current = null;
        setOpen(false);
      }
    });
    return () => subscription.remove();
  }, []);
  if (open && active) return <DinoRunnerGame onClose={close} />;
  return (
    <View style={{ width: "100%", alignItems: "center", gap: SPACING.md, paddingBottom: 96 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Prüfungs-Dino"
        accessibilityHint="Zwei schnelle Tipps öffnen eine kleine Spielpause."
        onPress={() => {
          if (!active) return;
          const now = Date.now();
          if (lastTap.current !== null && now - lastTap.current <= 350) {
            lastTap.current = null;
            setOpen(true);
          } else lastTap.current = now;
        }}
        style={{ width: 104, height: 104, alignItems: "center", justifyContent: "center" }}
      >
        <DinoRunnerIcon color={p.textSecondary} />
      </Pressable>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: p.text, textAlign: "center", ...TYPOGRAPHY.sectionTitle }}
      >
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: p.textSecondary, textAlign: "center", ...TYPOGRAPHY.body }}
      >
        Keine Auffälligkeiten
      </Text>
    </View>
  );
}
