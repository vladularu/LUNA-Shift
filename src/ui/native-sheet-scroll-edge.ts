import type { NativeStackNavigationOptions } from "expo-router";

import { supportsSystemScrollEdge } from "@/ui/native-scroll-edge";

export function nativeSheetScrollEdgeOptions(): NativeStackNavigationOptions | undefined {
  if (!supportsSystemScrollEdge) return undefined;
  return {
    headerTransparent: true,
    headerStyle: { backgroundColor: "transparent" },
    scrollEdgeEffects: { top: "soft" },
  };
}
