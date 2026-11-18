import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export const supportsSystemScrollEdge =
  process.env.EXPO_OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

function loadNativeEdge(): typeof import("@bsky.app/expo-scroll-edge-effect") | null {
  if (!supportsSystemScrollEdge || !requireOptionalNativeModule("ExpoScrollEdgeEffect")) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Gate the native view on binary support.
  return require("@bsky.app/expo-scroll-edge-effect");
}

export const nativeScrollEdge = loadNativeEdge();
