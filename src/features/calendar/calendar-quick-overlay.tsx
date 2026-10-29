import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";

/** One native overlay keeps the persistent planner above the day popover. */
export function CalendarQuickOverlay({
  children,
  modal,
}: {
  readonly children: ReactNode;
  readonly modal: boolean;
}) {
  const content = (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: 2 }]}
      testID="calendar-quick-overlay"
    >
      {children}
    </View>
  );
  return Platform.OS === "ios" ? (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={modal}>
      {content}
    </FullWindowOverlay>
  ) : (
    content
  );
}
