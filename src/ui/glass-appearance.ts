import { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

export const GlassSurfaceVisibilityContext = createContext(true);

export function useGlassAppearance() {
  const visible = useContext(GlassSurfaceVisibilityContext);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    let active = true;
    const update = (enabled: boolean) => {
      if (active) setReduceTransparency(enabled);
    };
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", update);
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then(update)
      .catch(() => update(true));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return {
    reduceTransparency,
    nativeGlass:
      Platform.OS === "ios" &&
      isGlassEffectAPIAvailable() &&
      isLiquidGlassAvailable() &&
      visible &&
      !reduceTransparency,
  };
}
