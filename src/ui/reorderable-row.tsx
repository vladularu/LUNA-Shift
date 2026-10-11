import { useLayoutEffect, useState } from "react";
import { Animated, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import type { ReorderItem, ReorderPosition } from "@/ui/reorderable-list";

export function ReorderableRow({
  item,
  index,
  initialY,
  count,
  onRegisterPosition,
  lifted,
  disabled,
  testID,
  onStart,
  onDrag,
  onEnd,
  onHeight,
  onAccessibilityMove,
}: {
  readonly item: ReorderItem;
  readonly index: number;
  readonly initialY: number;
  readonly count: number;
  readonly onRegisterPosition: (id: string, position: ReorderPosition) => () => void;
  readonly lifted: boolean;
  readonly disabled: boolean;
  readonly testID: string;
  readonly onStart: () => void;
  readonly onDrag: (x: number, y: number, absoluteY: number) => void;
  readonly onEnd: (success: boolean) => void;
  readonly onHeight: (height: number) => void;
  readonly onAccessibilityMove: (delta: -1 | 1) => void;
}) {
  const p = usePalette();
  // Each keyed row keeps its native transform nodes throughout saved reorders.
  const [position] = useState<ReorderPosition>(() => ({
    x: new Animated.Value(0),
    y: new Animated.Value(initialY),
  }));
  useLayoutEffect(
    () => onRegisterPosition(item.id, position),
    [item.id, onRegisterPosition, position],
  );
  const pan = Gesture.Pan()
    .activateAfterLongPress(350)
    .runOnJS(true)
    .enabled(!disabled)
    .withTestId(`${testID}-drag-${item.id}`)
    .onStart(onStart)
    .onUpdate((event) => onDrag(event.translationX, event.translationY, event.absoluteY))
    .onEnd((_event, success) => onEnd(success))
    .onFinalize((_event, success) => {
      if (!success) onEnd(false);
    });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID={`${testID}-row-${item.id}`}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${item.title}, Position ${index + 1} von ${count}`}
        accessibilityHint="Gedrückt halten und verschieben. Oder die Aktionen nach oben und nach unten verwenden."
        accessibilityState={{ disabled, busy: lifted }}
        accessibilityActions={[
          ...(index > 0 ? [{ name: "decrement", label: "Nach oben verschieben" }] : []),
          ...(index < count - 1 ? [{ name: "increment", label: "Nach unten verschieben" }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (disabled || lifted) return;
          const action = event.nativeEvent.actionName;
          if (action === "decrement" && index > 0) onAccessibilityMove(-1);
          if (action === "increment" && index < count - 1) onAccessibilityMove(1);
        }}
        onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          minHeight: 72,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          borderTopWidth: 1,
          borderTopColor: index > 0 && !lifted ? p.separator : "transparent",
          borderRadius: lifted || index === 0 || index === count - 1 ? RADII.card : 0,
          borderCurve: CORNER_CURVE,
          backgroundColor: p.surface,
          zIndex: lifted ? 10 : 0,
          elevation: lifted ? 6 : 0,
          shadowColor: "#000",
          shadowOpacity: lifted ? 0.15 : 0,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          opacity: 1,
          transform: [
            { translateX: position.x },
            { translateY: position.y },
            { scale: lifted ? 1.015 : 1 },
          ],
        }}
      >
        <View
          style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
          accessibilityElementsHidden
        >
          {item.leading}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.text, ...TYPOGRAPHY.bodyStrong }}>{item.title}</Text>
          {item.subtitle ? (
            <Text style={{ color: p.textMuted, ...TYPOGRAPHY.caption }}>{item.subtitle}</Text>
          ) : null}
        </View>
        <View
          style={{ width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityElementsHidden
        >
          <Ionicons name="reorder-three-outline" size={24} color={p.textMuted} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
