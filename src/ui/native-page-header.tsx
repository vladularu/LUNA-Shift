import { router } from "expo-router";

import { GlassBackButton } from "./glass-back-button";

const defaultBack = () => router.back();

export function pageBackButtonOptions(
  onPress = defaultBack,
  label = "Zurück",
  alwaysVisible = false,
) {
  const button = () => <GlassBackButton label={label} onPress={onPress} />;
  return {
    headerBackVisible: false,
    headerLeft: ({ canGoBack }: { readonly canGoBack?: boolean } = {}) =>
      canGoBack || alwaysVisible ? button() : null,
    unstable_headerLeftItems: ({ canGoBack }: { readonly canGoBack?: boolean } = {}) =>
      canGoBack || alwaysVisible
        ? [{ type: "custom" as const, element: button(), hidesSharedBackground: true }]
        : [],
  };
}
