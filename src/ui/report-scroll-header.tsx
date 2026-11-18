import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type RefObject,
} from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { nativeScrollEdge as nativeEdge } from "@/ui/native-scroll-edge";

const ignoreNativeRef = (_node: ScrollView | null) => {};

type ReportHeaderState = {
  readonly height: number;
  readonly safeBottom: number;
  readonly setHeight: (height: number) => void;
  readonly register: (node: ScrollView) => () => void;
};

const HeaderContext = createContext<ReportHeaderState | null>(null);
const ActivePageContext = createContext(true);

export function ReportScrollHeaderProvider({ children }: PropsWithChildren) {
  const Provider = nativeEdge?.ScrollEdgeEffectProvider;
  if (!Provider) return children;
  return (
    <Provider>
      <NativeReportScrollHeaderState>{children}</NativeReportScrollHeaderState>
    </Provider>
  );
}

function NativeReportScrollHeaderState({ children }: PropsWithChildren) {
  const nativeScrollRef = nativeEdge?.useScrollEdgeEffectRef() ?? ignoreNativeRef;
  const safeBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const [height, setHeight] = useState(0);
  const owner = useRef<ScrollView | null>(null);
  const register = useCallback(
    (node: ScrollView) => {
      owner.current = node;
      nativeScrollRef(node);
      return () => {
        if (owner.current !== node) return;
        owner.current = null;
        nativeScrollRef(null);
      };
    },
    [nativeScrollRef],
  );

  const value = useMemo(
    () => ({ height, safeBottom, setHeight, register }),
    [height, safeBottom, register],
  );
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function ReportScrollHeaderPage({
  active,
  children,
}: PropsWithChildren<{ readonly active: boolean }>) {
  return <ActivePageContext.Provider value={active}>{children}</ActivePageContext.Provider>;
}

export function useReportScrollHeaderEnabled() {
  return useContext(HeaderContext) !== null;
}

export function ReportScrollHeaderPlaceholder({ children }: PropsWithChildren) {
  const header = useContext(HeaderContext);
  if (!header) return children;
  return <View style={{ flex: 1, paddingTop: header.height }}>{children}</View>;
}

export function ReportScrollHeader({ children }: PropsWithChildren) {
  const header = useContext(HeaderContext);
  if (!header) return children;
  return (
    <View
      collapsable={false}
      pointerEvents="box-none"
      style={styles.overlay}
      testID="report-scroll-header-content"
      onLayout={(event) => header.setHeight(Math.ceil(event.nativeEvent.layout.height))}
    >
      {children}
    </View>
  );
}

/** Keep the native interaction on the period row, ending at its lower edge. */
export function ReportScrollEdge({ children }: PropsWithChildren) {
  const enabled = useReportScrollHeaderEnabled();
  const EdgeContainer = nativeEdge?.ScrollEdgeEffect;
  if (!enabled || !EdgeContainer) return children;
  return (
    <EdgeContainer edge="top" effect="soft" pointerEvents="box-none" testID="report-scroll-edge">
      {children}
    </EdgeContainer>
  );
}

export function useReportScrollHeaderBinding(scrollRef: RefObject<ScrollView | null>) {
  const header = useContext(HeaderContext);
  const active = useContext(ActivePageContext);
  const [node, setNode] = useState<ScrollView | null>(null);
  const register = header?.register;
  const bind = useCallback(() => {
    if (register && scrollRef.current) setNode(scrollRef.current);
  }, [register, scrollRef]);
  useEffect(() => {
    if (active && node !== null) return register?.(node);
  }, [active, node, register]);

  return {
    enabled: header !== null,
    height: header?.height ?? 0,
    bottom: header?.safeBottom ?? 0,
    bind,
  };
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1 },
});
