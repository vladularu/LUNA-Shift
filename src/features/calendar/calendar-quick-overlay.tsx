import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { STARTUP_SPLASH_FADE_MS, startupPresentation } from "@/infrastructure/startup-presentation";
import { FullWindowOverlay } from "react-native-screens";

/** One native overlay keeps the persistent planner above the day popover. */
export function CalendarQuickOverlay({
  children,
  modal,
}: {
  readonly children: ReactNode;
  readonly modal: boolean;
}) {
  const ready = useSyncExternalStore(
    startupPresentation.after,
    startupPresentation.isReady,
    startupPresentation.isReady,
  );
  const [initiallyReady] = useState(ready);
  const [opacity] = useState(() => new Animated.Value(ready ? 1 : 0));
  useEffect(() => {
    if (!ready) {
      opacity.setValue(0);
      return;
    }
    if (initiallyReady) return;
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: STARTUP_SPLASH_FADE_MS,
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [initiallyReady, opacity, ready]);
  const content = (
    <Animated.View
      pointerEvents={ready ? "box-none" : "none"}
      accessibilityElementsHidden={!ready}
      importantForAccessibility={ready ? "auto" : "no-hide-descendants"}
      style={[StyleSheet.absoluteFill, { zIndex: 2, opacity }]}
      testID="calendar-quick-overlay"
    >
      {children}
    </Animated.View>
  );
  return Platform.OS === "ios" ? (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={modal}>
      {content}
    </FullWindowOverlay>
  ) : (
    content
  );
}
