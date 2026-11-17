import { useContext, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { SheetBackFooter } from "@/ui/sheet-back-footer";

export function BackFooterLayout({
  children,
  disabled = false,
  footerTestID,
  label,
  nativeSheet = false,
  onPress,
  showFooter = true,
  style,
  testID,
}: {
  readonly children: (bottomPadding: number) => ReactNode;
  readonly disabled?: boolean;
  readonly footerTestID?: string;
  readonly label?: string;
  /** Keep the scroll view a direct native screen child for formSheet frame correction. */
  readonly nativeSheet?: boolean;
  readonly onPress: () => void;
  readonly showFooter?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  const insets = useContext(SafeAreaInsetsContext);
  const [footerHeight, setFooterHeight] = useState(48);
  const bottom = Math.max(insets?.bottom ?? 0, SPACING.md);

  const content = (
    <>
      {children(showFooter ? bottom + footerHeight + SPACING.lg : 0)}
      {showFooter ? (
        <View
          pointerEvents="box-none"
          testID={footerTestID}
          style={{
            position: "absolute",
            left: Math.max(insets?.left ?? 0, SCREEN_LAYOUT.horizontalPadding),
            right: Math.max(insets?.right ?? 0, SCREEN_LAYOUT.horizontalPadding),
            bottom,
          }}
        >
          <SheetBackFooter
            disabled={disabled}
            label={label}
            onLayout={({ nativeEvent }) => {
              if (nativeEvent.layout.height > 0) setFooterHeight(nativeEvent.layout.height);
            }}
            onPress={onPress}
          />
        </View>
      ) : null}
    </>
  );
  return nativeSheet ? (
    content
  ) : (
    <View style={[{ flex: 1 }, style]} testID={testID}>
      {content}
    </View>
  );
}
