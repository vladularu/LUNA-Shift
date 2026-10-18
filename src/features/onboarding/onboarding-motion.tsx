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
  appearance,
  delay = 0,
  style,
  testID,
}: {
  readonly children: ReactNode;
  readonly reduced: boolean;
  readonly appearance?: string | number;
  readonly delay?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 260,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [appearance, delay, opacity, reduced]);
  return (
    <Animated.View
      testID={testID}
      style={[
        style,
        {
          opacity: reduced ? 1 : opacity,
          transform: [
            {
              translateY: reduced
                ? 0
                : opacity.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
