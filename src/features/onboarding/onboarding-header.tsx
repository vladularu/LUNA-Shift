import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOnboardingPalette } from "@/theme/onboarding";
import { Text } from "@/ui/text";
import { s } from "./onboarding-screen.styles";

export function OnboardingHeader({
  children,
  onBack,
  onClose,
  atStart = false,
  busy = false,
}: {
  readonly children?: ReactNode;
  readonly onBack: () => void;
  readonly onClose?: () => void;
  readonly atStart?: boolean;
  readonly busy?: boolean;
}) {
  const { top } = useSafeAreaInsets();
  const p = useOnboardingPalette();
  return (
    <View testID="onboarding-header" style={{ paddingTop: top }}>
      <View style={s.progressHeader}>
        <Pressable
          accessibilityLabel="Zurück"
          accessibilityRole="button"
          disabled={atStart || busy}
          onPress={onBack}
          style={[s.back, { opacity: atStart ? 0 : busy ? 0.5 : 1 }]}
        >
          <Text style={[s.label, { color: p.text }]}>‹</Text>
        </Pressable>
        <View style={s.progressRight}>
          {children}
          {onClose && (
            <Pressable
              accessibilityLabel="Testmodus schließen"
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={s.back}
            >
              <Text style={[s.caption, { color: p.muted }]} testID="onboarding-preview-hint">
                Schließen
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
