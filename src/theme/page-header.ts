import type { ViewStyle } from "react-native";

// Apply to every native stack, including expanded iOS titles.
export const PAGE_HEADER_OPTIONS = {
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  headerTransparent: false,
} as const;

export function nativePageHeaderStyle(backgroundColor: string) {
  return { backgroundColor };
}

// Custom headers use their page's own surface and never draw a separate frame.
export function pageHeaderStyle(backgroundColor: string): ViewStyle {
  return {
    backgroundColor,
    borderWidth: 0,
    borderBottomWidth: 0,
    boxShadow: "0 0 0 rgba(0, 0, 0, 0)",
    elevation: 0,
  };
}
