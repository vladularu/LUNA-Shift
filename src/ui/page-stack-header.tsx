import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from "expo-router";
import {
  Header,
  HeaderBackContext,
  HeaderHeightContext,
  getHeaderTitle,
  useHeaderHeight,
} from "expo-router/react-navigation";

import { horizontalBackGestureOptions } from "@/navigation/horizontal-back-gesture";
import { MINIMUM_TOUCH_TARGET, SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";

import { nativeScrollEdge } from "@/ui/native-scroll-edge";
import {
  ReportScrollEdge,
  ReportScrollHeader,
  ReportScrollHeaderProvider,
  useReportScrollHeaderEnabled,
} from "@/ui/report-scroll-header";
import {
  SoftScrollAnchor,
  SoftScrollBody,
  SoftScrollScope,
  SoftScrollTarget,
  useSoftScrollEdgeEnabled,
} from "@/ui/soft-scroll-layout";

const scrollPageRoutes = new Set([
  "account",
  "account-name",
  "annual-details",
  "calendar-access",
  "calendar-sharing",
  "check-profile",
  "check-settings",
  "compliance-details",
  "data-backup",
  "net-pay-settings",
  "private-cloud",
  "profile-selection",
  "settings-editor",
  "sharing-invite",
  "template-editor",
  "work-profile",
  "working-time-profile",
  "worktime-details",
]);

type ScrollViews = ReadonlyMap<string, ScrollView>;
type RegisterScrollView = (routeKey: string, node: ScrollView) => () => void;
const ScrollViewsContext = createContext<ScrollViews>(new Map());
const RegisterScrollViewContext = createContext<RegisterScrollView>(() => () => {});

// Expo renders a custom header outside the screen layout. Keep only the
// scroll-view reference in common, keyed by each mounted route instance.
export function PageStackScrollEdges({ children }: PropsWithChildren) {
  const [views, setViews] = useState<ScrollViews>(() => new Map());
  const register = useCallback<RegisterScrollView>((routeKey, node) => {
    setViews((current) => new Map(current).set(routeKey, node));
    return () =>
      setViews((current) => {
        if (current.get(routeKey) !== node) return current;
        const next = new Map(current);
        next.delete(routeKey);
        return next;
      });
  }, []);
  return (
    <RegisterScrollViewContext.Provider value={register}>
      <ScrollViewsContext.Provider value={views}>{children}</ScrollViewsContext.Provider>
    </RegisterScrollViewContext.Provider>
  );
}

export function pageStackScrollLayout({
  children,
  options,
  route,
}: Pick<NativeStackHeaderProps, "options" | "route"> & { readonly children: ReactElement }) {
  if (options.header === renderCalendarDesignHeaderPlaceholder && options.headerShown !== false) {
    return (
      <CalendarDesignScrollPage options={options} route={route}>
        {children}
      </CalendarDesignScrollPage>
    );
  }
  if (options.header !== renderSoftStackHeader) return children;
  return (
    <StackScrollPage enabled={options.headerShown !== false} routeKey={route.key}>
      {children}
    </StackScrollPage>
  );
}

function CalendarDesignScrollPage({
  children,
  options,
  route,
}: PropsWithChildren<Pick<NativeStackHeaderProps, "options" | "route">>) {
  const back = useContext(HeaderBackContext);
  return (
    <ReportScrollHeaderProvider>
      <ReportScrollHeader>
        <PageStackHeader back={back} options={options} route={route} />
      </ReportScrollHeader>
      {children}
    </ReportScrollHeaderProvider>
  );
}

function StackScrollPage({
  children,
  enabled,
  routeKey,
}: PropsWithChildren<{ readonly enabled: boolean; readonly routeKey: string }>) {
  const height = useHeaderHeight();
  const bound = useContext(ScrollViewsContext).has(routeKey);
  const register = useContext(RegisterScrollViewContext);
  const bind = useCallback((node: ScrollView) => register(routeKey, node), [register, routeKey]);
  const bodyTop = enabled && !bound ? height : 0;

  return (
    <View style={{ flex: 1, paddingTop: bodyTop }}>
      <HeaderHeightContext value={bodyTop}>
        <SoftScrollBody enabled={enabled} extent={bound ? height : 0} register={bind}>
          {children}
        </SoftScrollBody>
      </HeaderHeightContext>
    </View>
  );
}

function SoftStackHeader(props: NativeStackHeaderProps) {
  const scrollView = useContext(ScrollViewsContext).get(props.route.key);
  return (
    <SoftScrollScope>
      <SoftScrollTarget node={scrollView} />
      <SoftScrollAnchor existingOverlap>
        <PageStackHeader {...props} />
      </SoftScrollAnchor>
    </SoftScrollScope>
  );
}

function renderSoftStackHeader(props: NativeStackHeaderProps) {
  return <SoftStackHeader {...props} />;
}

function renderCalendarDesignHeaderPlaceholder() {
  return null;
}

/** Render inside the native screen so the header follows its interactive back transition. */
export function PageStackHeader({
  back,
  options,
  route,
}: Pick<NativeStackHeaderProps, "back" | "options" | "route">) {
  const hasScrollEdge = useSoftScrollEdgeEnabled();
  const reportEdgeEnabled = useReportScrollHeaderEnabled();
  const useControlRowEdge = reportEdgeEnabled && route.name === "calendar-design";
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

  const header = (
    <Header
      {...options}
      headerStatusBarHeight={useControlRowEdge ? 0 : insets.top}
      headerStyle={{
        ...StyleSheet.flatten(options.headerStyle),
        ...(hasScrollEdge || useControlRowEdge ? { backgroundColor: "transparent" } : undefined),
        height: useControlRowEdge ? rowHeight : height,
      }}
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
  );
  return (
    <View
      testID="page-stack-header"
      pointerEvents={useControlRowEdge ? "box-none" : undefined}
      style={{
        height: useControlRowEdge ? height + SCREEN_LAYOUT.contentTopPadding : height,
        paddingTop: useControlRowEdge ? insets.top : undefined,
      }}
    >
      {useControlRowEdge ? (
        <ReportScrollEdge>
          {header}
          {/* Extend the native effect independently of the measured header and preview position. */}
          <View
            testID="calendar-design-header-gap"
            pointerEvents="none"
            style={{ height: SCREEN_LAYOUT.contentTopPadding + SPACING.xxl }}
          />
        </ReportScrollEdge>
      ) : (
        header
      )}
    </View>
  );
}

export function pageStackHeaderOptions(
  routeName: string,
): Pick<NativeStackNavigationOptions, "header" | "headerTransparent"> | undefined {
  // The same route classification keeps sheets, vertical editors and tab roots native.
  if (Platform.OS !== "ios" || !horizontalBackGestureOptions(routeName)) return undefined;
  if (nativeScrollEdge && routeName === "calendar-design") {
    return { header: renderCalendarDesignHeaderPlaceholder, headerTransparent: true };
  }
  if (nativeScrollEdge && scrollPageRoutes.has(routeName)) {
    return { header: renderSoftStackHeader, headerTransparent: true };
  }
  return { header: (props) => <PageStackHeader {...props} /> };
}
