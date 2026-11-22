import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable } from "react-native";
import { usePalette } from "@/theme/palette";
import { SUPPORTED_CHECKS_EMPTY } from "./check-copy";
import { DinoRunnerGame, DinoRunnerIcon } from "./dino-runner-game";

export function CheckRunnerEgg({ active = true }: { readonly active?: boolean }) {
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Prüfungs-Dino"
      accessibilityHint={`${SUPPORTED_CHECKS_EMPTY} Zwei schnelle Tipps öffnen eine kleine Spielpause.`}
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
  );
}
