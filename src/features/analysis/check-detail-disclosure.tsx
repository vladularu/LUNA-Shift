import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { selectionFeedback } from "@/ui/haptics";
import { useCheckReferenceDetail } from "./check-detail-layout";

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
  const reference = useCheckReferenceDetail();
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
          minHeight: reference ? 46 : MINIMUM_TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.sm,
          paddingVertical: reference ? SPACING.xxs : SPACING.sm,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text
          style={{
            color: reference?.text ?? palette.text,
            ...(reference ? CHECK_REFERENCE_TYPOGRAPHY.disclosure : TYPOGRAPHY.body),
            flex: 1,
            minWidth: 0,
          }}
        >
          {title}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          color={reference?.secondary ?? palette.textMuted}
          size={16}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {expanded ? (
        <View
          style={
            reference
              ? {
                  gap: 7,
                  paddingTop: 9,
                  paddingBottom: 13,
                  borderTopColor: reference.line,
                  borderTopWidth: 1,
                }
              : { gap: SPACING.md, paddingBottom: SPACING.sm }
          }
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
