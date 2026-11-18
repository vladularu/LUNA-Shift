import type { NativeStackNavigationOptions } from "expo-router";
import { Platform } from "react-native";

const supportsSystemScrollEdge =
  process.env.EXPO_OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

export function nativeSheetScrollEdgeOptions(): NativeStackNavigationOptions | undefined {
  if (!supportsSystemScrollEdge) return undefined;
  return {
    headerTransparent: true,
    headerStyle: { backgroundColor: "transparent" },
    scrollEdgeEffects: { top: "soft" },
  };
}
