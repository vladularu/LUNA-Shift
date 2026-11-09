import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { selectionFeedback } from "@/ui/haptics";

export function CheckDetailDisclosure({
  title,
  children,
  testID,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => {
          selectionFeedback();
          setExpanded((value) => !value);
        }}
        style={({ pressed }) => ({
          minHeight: MINIMUM_TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          paddingVertical: SPACING.sm,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text style={{ color: palette.text, ...TYPOGRAPHY.body, flex: 1, minWidth: 0 }}>
          {title}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          color={palette.textMuted}
          size={16}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {expanded ? (
        <View style={{ gap: SPACING.md, paddingBottom: SPACING.sm }}>{children}</View>
      ) : null}
    </View>
  );
}
