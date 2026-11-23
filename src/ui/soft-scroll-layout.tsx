import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type Ref,
} from "react";
import { ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { nativeScrollEdge } from "@/ui/native-scroll-edge";

type ScrollEdgeState = {
  readonly edge: "top" | "bottom";
  readonly extent: number;
  readonly measure: (extent: number) => void;
  readonly register: (node: ScrollView) => () => void;
};

const SoftEdgeContext = createContext<ScrollEdgeState | null>(null);
const noRef = () => {};

/** One fixed header or footer and one vertical scroll view per scope. */
export function SoftScrollScope({
  children,
  edge = "top",
  enabled = true,
}: PropsWithChildren<{ readonly edge?: "top" | "bottom"; readonly enabled?: boolean }>) {
  if (!nativeScrollEdge) return children;
  const Provider = nativeScrollEdge.ScrollEdgeEffectProvider;
  return (
    <Provider>
      <SoftScrollState edge={edge} enabled={enabled}>
        {children}
      </SoftScrollState>
    </Provider>
  );
}

function SoftScrollState({
  children,
  edge,
  enabled,
}: PropsWithChildren<{ readonly edge: "top" | "bottom"; readonly enabled: boolean }>) {
  const [measuredExtent, measure] = useState(0);
  const [bound, setBound] = useState(false);
  const nativeRef = nativeScrollEdge?.useScrollEdgeEffectRef() ?? noRef;
  const owner = useRef<ScrollView | null>(null);
  const register = useCallback(
    (node: ScrollView) => {
      owner.current = node;
      nativeRef(node);
      setBound(true);
      return () => {
        if (owner.current !== node) return;
        owner.current = null;
        nativeRef(null);
        setBound(false);
      };
    },
    [nativeRef],
  );
  const extent = bound ? measuredExtent : 0;
  const value = useMemo(
    () => (enabled ? { edge, extent, measure, register } : null),
    [edge, enabled, extent, register],
  );
  return <SoftEdgeContext.Provider value={value}>{children}</SoftEdgeContext.Provider>;
}

/** A native-stack header is positioned by Expo Router outside the page body. */
export function SoftScrollBody({
  children,
  enabled,
  extent,
  register,
}: PropsWithChildren<{
  readonly enabled: boolean;
  readonly extent: number;
  readonly register: ScrollEdgeState["register"];
}>) {
  const value = useMemo(
    () => (enabled ? { edge: "top" as const, extent, register, measure: noRef } : null),
    [enabled, extent, register],
  );
  return <SoftEdgeContext.Provider value={value}>{children}</SoftEdgeContext.Provider>;
}

export function SoftScrollTarget({ node }: { readonly node?: ScrollView }) {
  const register = useContext(SoftEdgeContext)?.register;
  useEffect(() => {
    if (node) return register?.(node);
  }, [node, register]);
  return null;
}

export function useSoftScrollEdgeEnabled() {
  return useContext(SoftEdgeContext) !== null;
}

/** Position fixed content relative to the header when the scroll view extends beneath it. */
export function useSoftScrollTopOverlap() {
  const state = useContext(SoftEdgeContext);
  return state?.edge === "top" ? state.extent : 0;
}

/** Keep the controls in place and let the scroll view extend behind them. */
export function SoftScrollAnchor({
  children,
  existingOverlap = false,
  extendBelow = 0,
  topEffectHeight,
  showEffect = true,
}: PropsWithChildren<{
  readonly existingOverlap?: boolean;
  readonly extendBelow?: number;
  readonly topEffectHeight?: number;
  readonly showEffect?: boolean;
}>) {
  const edge = useContext(SoftEdgeContext);
  const NativeEdge = nativeScrollEdge?.ScrollEdgeEffect;
  if (!NativeEdge || !edge) return children;

  // Position the UIKit interaction independently of the header's measured layout.
  const detachedEffect = edge.edge === "top" && (topEffectHeight !== undefined || extendBelow > 0);
  const effectStyle = detachedEffect
    ? [
        styles.positionedEffect,
        topEffectHeight === undefined ? { bottom: -extendBelow } : { height: topEffectHeight },
      ]
    : existingOverlap
      ? styles.anchor
      : undefined;
  const effect = (
    <NativeEdge
      edge={edge.edge}
      effect={showEffect ? "soft" : "hidden"}
      pointerEvents={detachedEffect ? "none" : "box-none"}
      style={effectStyle}
      testID="soft-scroll-edge"
    >
      {detachedEffect ? null : children}
    </NativeEdge>
  );
  if (existingOverlap && !detachedEffect) return effect;

  return (
    <View
      pointerEvents="box-none"
      testID={existingOverlap ? undefined : "soft-scroll-anchor"}
      style={[
        styles.anchor,
        !existingOverlap && {
          [edge.edge === "top" ? "marginBottom" : "marginTop"]: -edge.extent,
        },
      ]}
      onLayout={
        existingOverlap ? undefined : ({ nativeEvent }) => edge.measure(nativeEvent.layout.height)
      }
    >
      {effect}
      {detachedEffect ? children : null}
    </View>
  );
}

type SoftScrollViewProps = ScrollViewProps & {
  readonly ref?: Ref<ScrollView>;
  readonly fixedViewportHeight?: number;
};

export function SoftScrollView({
  ref,
  onLayout,
  onContentSizeChange,
  fixedViewportHeight,
  style,
  contentContainerStyle,
  contentInsetAdjustmentBehavior,
  contentInset,
  scrollIndicatorInsets,
  ...props
}: SoftScrollViewProps) {
  const edge = useContext(SoftEdgeContext);
  const safeBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const scrollRef = useRef<ScrollView>(null);
  const register = edge?.register;
  const [node, setNode] = useState<ScrollView | null>(null);
  useImperativeHandle(ref, () => scrollRef.current!, []);

  const bind = useCallback<NonNullable<ScrollViewProps["onLayout"]>>(
    (event) => {
      if (register && scrollRef.current) setNode(scrollRef.current);
      onLayout?.(event);
    },
    [onLayout, register],
  );

  useEffect(() => {
    if (node) return register?.(node);
  }, [node, register]);

  // Reflow the existing padding only. Sending a new contentOffset would move
  // the mounted UIScrollView when a header or footer is remeasured.
  const overlap = edge?.extent ?? 0;
  const side = edge?.edge ?? "top";
  const bodyStyle = edge ? StyleSheet.flatten(contentContainerStyle) : undefined;
  const basePadding =
    (side === "top" ? bodyStyle?.paddingTop : bodyStyle?.paddingBottom) ??
    bodyStyle?.paddingVertical ??
    bodyStyle?.padding ??
    0;
  const keepBottomInset =
    edge?.edge === "top" &&
    !contentInset?.bottom &&
    (contentInsetAdjustmentBehavior === "automatic" || contentInsetAdjustmentBehavior === "always");
  const bottomInset = keepBottomInset ? safeBottom : (contentInset?.bottom ?? 0);
  const fixedViewport = fixedViewportHeight !== undefined;
  const overlaidInsets = useMemo(
    () => (keepBottomInset ? { ...contentInset, bottom: bottomInset } : contentInset),
    [bottomInset, contentInset, keepBottomInset],
  );
  const overlaidIndicators = useMemo(
    () => ({
      ...scrollIndicatorInsets,
      bottom: bottomInset,
      [side]: (scrollIndicatorInsets?.[side] ?? (side === "bottom" ? bottomInset : 0)) + overlap,
    }),
    [bottomInset, overlap, scrollIndicatorInsets, side],
  );

  return (
    <ScrollView
      {...props}
      ref={scrollRef}
      onLayout={edge ? bind : onLayout}
      style={fixedViewport ? [style, { height: fixedViewportHeight + overlap }] : style}
      onContentSizeChange={
        fixedViewport && edge && onContentSizeChange
          ? (width, height) => onContentSizeChange(width, Math.max(0, height - overlap))
          : onContentSizeChange
      }
      contentContainerStyle={
        edge && overlap && typeof basePadding === "number"
          ? [
              contentContainerStyle,
              side === "top"
                ? { paddingTop: basePadding + overlap }
                : { paddingBottom: basePadding + overlap },
            ]
          : contentContainerStyle
      }
      contentInsetAdjustmentBehavior={edge ? "never" : contentInsetAdjustmentBehavior}
      contentInset={edge ? overlaidInsets : contentInset}
      automaticallyAdjustContentInsets={edge ? false : props.automaticallyAdjustContentInsets}
      automaticallyAdjustsScrollIndicatorInsets={
        edge ? false : props.automaticallyAdjustsScrollIndicatorInsets
      }
      scrollIndicatorInsets={edge ? overlaidIndicators : scrollIndicatorInsets}
    />
  );
}

export function renderSoftScrollView(props: ScrollViewProps) {
  return <SoftScrollView {...props} />;
}

const styles = StyleSheet.create({
  anchor: { flexShrink: 0, zIndex: 1 },
  positionedEffect: { position: "absolute", top: 0, left: 0, right: 0 },
});
