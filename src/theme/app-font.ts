import { Platform } from "react-native";

// System fonts are already available in the installed app; no native font change is needed.
export const APP_FONT_FAMILY = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "system-ui",
});
