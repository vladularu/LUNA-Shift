import { useEffect, useRef, type ReactNode } from "react";
import { Pressable } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import { useInversePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";

/** Revealing the action never deletes an entry, including a full swipe. */
export function QuickEntrySwipeRow({
  children,
  entryKey,
  title,
  enabled,
  open,
  onOpen,
  onClose,
  onDelete,
}: {
  readonly children: ReactNode;
  readonly entryKey: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
}) {
  const palette = useInversePalette();
  const swipe = useRef<SwipeableMethods>(null);
  useEffect(() => {
    if (!open) swipe.current?.close();
  }, [open]);

  return (
    <Swipeable
      ref={swipe}
      testID={`swipe-entry-${entryKey}`}
      enabled={enabled}
      friction={1.5}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableWillOpen={onOpen}
      onSwipeableClose={onClose}
      renderRightActions={() => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title} löschen`}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
          disabled={!enabled || !open}
          onPress={onDelete}
          style={({ pressed }) => ({
            minWidth: 88,
            minHeight: 44,
            paddingHorizontal: SPACING.lg,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.danger,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...TYPOGRAPHY.label, color: palette.onDanger }}>Löschen</Text>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  );
}
