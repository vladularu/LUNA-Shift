import { GlassView } from "expo-glass-effect";
import { Platform, StyleSheet, View } from "react-native";

import { CORNER_CURVE } from "@/theme/tokens";

export function FloatingGlassBackground({
  dark,
  radius,
}: {
  readonly dark: boolean;
  readonly radius: number;
}) {
  const glass = (
    <GlassView
      pointerEvents="none"
      colorScheme={dark ? "dark" : "light"}
      glassEffectStyle="regular"
      testID="floating-glass-background"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, borderCurve: CORNER_CURVE }]}
    />
  );
  if (dark || Platform.OS !== "ios") return glass;

  // Expo documents opacity on a wrapper around GlassView starting with iOS 26.1.
  const [major, minor = 0] = String(Platform.Version).split(".").map(Number);
  if (!(major > 26 || (major === 26 && minor >= 1))) return glass;

  return (
    <View
      collapsable={false}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: 0.9 }]}
      testID="floating-glass-background-layer"
    >
      {glass}
    </View>
  );
}
