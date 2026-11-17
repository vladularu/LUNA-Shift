import { Fragment } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from "expo-router";
import { Header, getHeaderTitle } from "expo-router/react-navigation";

import { horizontalBackGestureOptions } from "@/navigation/horizontal-back-gesture";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";

/** Render inside the native screen so the header follows its interactive back transition. */
export function PageStackHeader({ back, options, route }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const titleStyle = StyleSheet.flatten(options.headerTitleStyle);
  // The generic Header subtracts a Dynamic Island correction from its 44 pt row.
  // Own the safe area and reserve a complete control row, including at large text sizes.
  const rowHeight = Math.max(
    MINIMUM_TOUCH_TARGET + SPACING.md,
    Math.ceil((titleStyle?.fontSize ?? TYPOGRAPHY.sectionTitle.fontSize) * 1.4 * fontScale) +
      SPACING.md,
  );
  const height = insets.top + rowHeight;
  const itemProps = { canGoBack: Boolean(back), tintColor: options.headerTintColor };
  const rightItems = options.unstable_headerRightItems?.(itemProps);

  return (
    <View testID="page-stack-header" style={{ height }}>
      <Header
        {...options}
        headerStatusBarHeight={insets.top}
        headerStyle={{ ...StyleSheet.flatten(options.headerStyle), height }}
        back={back}
        title={getHeaderTitle(options, route.name)}
        headerTitleAllowFontScaling
        headerLeftContainerStyle={{ paddingStart: SPACING.lg }}
        headerRightContainerStyle={{ paddingEnd: SPACING.lg }}
        headerLeft={() => options.headerLeft?.(itemProps)}
        headerRight={() =>
          rightItems ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.sm }}>
              {rightItems.map((item, index) =>
                item.type === "custom" ? <Fragment key={index}>{item.element}</Fragment> : null,
              )}
            </View>
          ) : (
            options.headerRight?.(itemProps)
          )
        }
      />
    </View>
  );
}

export function pageStackHeaderOptions(
  routeName: string,
): Pick<NativeStackNavigationOptions, "header"> | undefined {
  // The same route classification keeps sheets, vertical editors and tab roots native.
  if (Platform.OS !== "ios" || !horizontalBackGestureOptions(routeName)) return undefined;
  return { header: (props) => <PageStackHeader {...props} /> };
}
