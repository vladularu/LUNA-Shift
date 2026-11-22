import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

export function useOnboardingReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active && !changed) setReduced(value);
      })
      .catch(() => {
        if (active && !changed) setReduced(true);
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export function OnboardingReveal({
  children,
  reduced,
  variant = "intro",
  delay = 0,
  style,
  testID,
}: {
  readonly children: ReactNode;
  readonly reduced: boolean;
  readonly variant?: "intro" | "page";
  readonly delay?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: variant === "page" ? 160 : 260,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced, variant]);
  return (
    <Animated.View
      testID={testID}
      style={[
        style,
        {
          opacity: reduced
            ? 1
            : variant === "page"
              ? progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] })
              : progress,
          transform:
            variant === "intro" && !reduced
              ? [
                  {
                    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }),
                  },
                ]
              : undefined,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
