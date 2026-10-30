import type { ComponentProps, Key, PropsWithChildren, ReactNode, RefObject } from "react";
import { useContext } from "react";
import {
  ScrollView,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";

import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SCREEN_LAYOUT, SPACING } from "@/theme/tokens";

export type ScreenSurface = "background" | "groupedBackground" | "calendarBackground";

export function ScreenScrollView({
  bottomPadding = SCREEN_LAYOUT.contentBottomPadding,
  children,
  contentContainerStyle,
  contentGap = SCREEN_LAYOUT.contentGap,
  contentInsetAdjustmentBehavior = "automatic",
  style,
  surface = "background",
  scrollRef,
  ...scrollViewProps
}: PropsWithChildren<
  Omit<ScrollViewProps, "contentContainerStyle"> & {
    readonly bottomPadding?: number;
    readonly contentContainerStyle?: StyleProp<ViewStyle>;
    readonly contentGap?: number;
    readonly surface?: ScreenSurface;
    readonly scrollRef?: RefObject<ScrollView | null>;
  }
>) {
  const palette = usePalette();

  return (
    <ScrollView
      {...scrollViewProps}
      ref={scrollRef}
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      contentContainerStyle={[
        {
          gap: contentGap,
          paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
          paddingTop: SCREEN_LAYOUT.contentTopPadding,
          paddingBottom: bottomPadding,
        },
        contentContainerStyle,
      ]}
      style={[{ backgroundColor: palette[surface] }, style]}
    >
      {children}
    </ScrollView>
  );
}

export function TabScreenHeader({
  accessory,
  surface = "background",
  testID,
  title,
  titleEntering,
  titleExiting,
  titleColor,
  titleKey,
  stableTitle = false,
  minimumTitleScale,
  titleHeightMode = "fixed",
  transparent = false,
  toolbar,
  safeTopOverride,
  titleHidden = false,
}: {
  readonly accessory?: ReactNode;
  readonly surface?: ScreenSurface;
  readonly testID?: string;
  readonly title: string;
  readonly titleEntering?: ComponentProps<typeof Animated.Text>["entering"];
  readonly titleExiting?: ComponentProps<typeof Animated.Text>["exiting"];
  readonly titleColor?: string;
  readonly titleKey?: Key;
  readonly stableTitle?: boolean;
  readonly minimumTitleScale?: number;
  readonly titleHeightMode?: "fixed" | "content";
  readonly transparent?: boolean;
  readonly toolbar?: ReactNode;
  readonly safeTopOverride?: number;
  readonly titleHidden?: boolean;
}) {
  const palette = usePalette();
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const { fontScale } = useWindowDimensions();
  const stableTitleHeight = stableTitle
    ? Math.ceil(TYPOGRAPHY.hero.lineHeight * fontScale)
    : undefined;
  const stackAccessory =
    Boolean(accessory) && fontScale >= SCREEN_LAYOUT.headerAccessoryStackFontScale;
  const safeTop =
    safeTopOverride ?? (process.env.EXPO_OS === "web" ? SCREEN_LAYOUT.contentTopPadding : topInset);
  const titleAreaMinHeight =
    SCREEN_LAYOUT.headerMinHeight -
    SCREEN_LAYOUT.headerTopPadding -
    SCREEN_LAYOUT.headerBottomPadding;

  return (
    <View
      testID={testID}
      pointerEvents={titleHidden ? "box-none" : "auto"}
      style={{
        minHeight: safeTop + SCREEN_LAYOUT.headerMinHeight,
        backgroundColor: transparent ? "transparent" : palette[surface],
        paddingTop: safeTop + SCREEN_LAYOUT.headerTopPadding,
        paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
        paddingBottom: SCREEN_LAYOUT.headerBottomPadding,
      }}
    >
      <View
        pointerEvents={titleHidden ? "box-none" : "auto"}
        testID={testID ? `${testID}-title-area` : undefined}
        style={{
          minHeight: titleAreaMinHeight,
          justifyContent: "flex-end",
        }}
      >
        <View
          pointerEvents={titleHidden ? "box-none" : "auto"}
          style={{
            flexDirection: stackAccessory ? "column" : "row",
            alignItems: stackAccessory ? "stretch" : "flex-end",
            gap: SPACING.md,
          }}
        >
          <Animated.Text
            pointerEvents={titleHidden ? "none" : "auto"}
            accessible={!titleHidden}
            accessibilityElementsHidden={titleHidden}
            importantForAccessibility={titleHidden ? "no-hide-descendants" : "auto"}
            key={titleKey}
            accessibilityRole="header"
            dynamicTypeRamp="largeTitle"
            entering={titleEntering}
            exiting={titleExiting}
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            numberOfLines={stableTitle ? 1 : undefined}
            adjustsFontSizeToFit={stableTitle}
            minimumFontScale={stableTitle ? minimumTitleScale : undefined}
            accessibilityLabel={title}
            style={{
              ...(titleHidden ? { opacity: 0 } : {}),
              flex: stackAccessory ? undefined : 1,
              color: titleColor ?? palette.text,
              ...TYPOGRAPHY.hero,
              height: titleHeightMode === "fixed" ? stableTitleHeight : undefined,
              minHeight: titleHeightMode === "content" ? stableTitleHeight : undefined,
            }}
          >
            {title}
          </Animated.Text>
          {accessory ? (
            <View
              style={{
                alignSelf: stackAccessory ? "stretch" : "auto",
                alignItems: stackAccessory ? "flex-end" : undefined,
              }}
            >
              {accessory}
            </View>
          ) : null}
        </View>
      </View>
      {toolbar ? (
        <View
          testID={testID ? `${testID}-toolbar-area` : undefined}
          style={{ marginTop: SPACING.xs }}
        >
          {toolbar}
        </View>
      ) : null}
    </View>
  );
}
