import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
type PageRenderer = (month: string, onMove: (delta: number) => void, active: boolean) => ReactNode;
const RADIUS = 12;

export function reportPeriodOffset(month: string, delta: number, unit: "MONTH" | "YEAR") {
  return Temporal.PlainYearMonth.from(month)
    .add(unit === "YEAR" ? { years: delta } : { months: delta })
    .toString();
}

/** Native scrolling owns every drag frame. Date changes commit only at a settled page. */
export function ReportPeriodPager({
  value,
  unit = "MONTH",
  enabled = true,
  onChange,
  renderPage,
}: {
  readonly value: string;
  readonly unit?: "MONTH" | "YEAR";
  readonly enabled?: boolean;
  readonly onChange: (month: string) => void;
  readonly renderPage: PageRenderer;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<ScrollView>(null);
  const [anchor, setAnchor] = useState(value);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const { width, height } = layout;
  const [destination, setDestination] = useState<string | null>(null);
  const pages = useMemo(
    () =>
      Array.from({ length: RADIUS * 2 + 1 }, (_, index) =>
        reportPeriodOffset(anchor, index - RADIUS, unit),
      ),
    [anchor, unit],
  );
  const index = pages.indexOf(value);
  const requested = useRef(value);
  const settled = useRef(value);
  const oldWidth = useRef(width);
  const positioning = useRef<string | null>(null);
  const currentLayout = useRef({ anchor, width, enabled });
  useLayoutEffect(() => {
    currentLayout.current = { anchor, width, enabled };
  }, [anchor, enabled, width]);
  const initialOffset = useMemo(() => ({ x: RADIUS * width, y: 0 }), [width]);
  useLayoutEffect(() => {
    if (index < 0 || index <= 1 || index >= pages.length - 2) {
      requested.current = value;
      settled.current = value;
      setDestination(null);
      setAnchor(value);
      return;
    }
    const layoutChanged = oldWidth.current !== width;
    oldWidth.current = width;
    if (settled.current === value && !layoutChanged) return;
    settled.current = value;
    requested.current = value;
    positioning.current = !layoutChanged && !reduced ? value : null;
    setDestination(null);
    ref.current?.scrollTo({ x: index * width, animated: !layoutChanged && !reduced });
  }, [index, pages.length, reduced, value, width]);

  const commit = (event: ScrollEvent) => {
    if (
      !enabled ||
      width <= 0 ||
      currentLayout.current.anchor !== anchor ||
      currentLayout.current.width !== width
    )
      return;
    const position = event.nativeEvent.contentOffset.x / width;
    const nextIndex = Math.round(position);
    if (Math.abs(position - nextIndex) > 0.002) return;
    const next = pages[nextIndex];
    if (!next) return;
    if (positioning.current !== null && positioning.current !== next) return;
    positioning.current = null;
    requested.current = next;
    setDestination(null);
    if (settled.current === next) return;
    settled.current = next;
    onChange(next);
  };
  const move = useCallback(
    (delta: number) => {
      if (!enabled) return;
      const next = reportPeriodOffset(requested.current, delta, unit);
      const nextIndex = pages.indexOf(next);
      if (width <= 0 || nextIndex < 0) {
        requested.current = next;
        settled.current = next;
        onChange(next);
        return;
      }
      requested.current = next;
      // Dispatch the native motion before preparing any more distant target.
      ref.current?.scrollTo({ x: nextIndex * width, animated: !reduced });
      setDestination(next);
      if (reduced) {
        settled.current = next;
        onChange(next);
      }
    },
    [enabled, onChange, pages, reduced, unit, width],
  );
  const destinationIndex = destination ? pages.indexOf(destination) : index;
  return (
    <View
      style={{ flex: 1 }}
      testID="report-period-pager"
      onLayout={(event) => {
        const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
        setLayout((old) =>
          old.width === nextWidth && old.height === nextHeight
            ? old
            : { width: nextWidth, height: nextHeight },
        );
      }}
    >
      {width <= 0 || index < 0 ? (
        <PeriodPageContent month={value} onMove={move} active renderPage={renderPage} />
      ) : (
        <ScrollView
          key={`${anchor}-${unit}`}
          ref={ref}
          testID="report-period-scroll"
          style={{ flex: 1 }}
          horizontal
          pagingEnabled
          directionalLockEnabled
          disableIntervalMomentum
          scrollEnabled={enabled}
          showsHorizontalScrollIndicator={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentOffset={initialOffset}
          onScrollBeginDrag={() => {
            positioning.current = null;
            requested.current = settled.current;
            setDestination(null);
          }}
          onMomentumScrollEnd={commit}
          onScrollEndDrag={(event) => {
            if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.01) commit(event);
          }}
        >
          {pages.map((month, pageIndex) => (
            <View
              key={month}
              style={{ width, height }}
              testID={`report-period-page-${month}`}
              accessibilityElementsHidden={month !== value}
              importantForAccessibility={month === value ? "auto" : "no-hide-descendants"}
              pointerEvents={month === value ? "auto" : "none"}
            >
              {Math.abs(pageIndex - index) <= 1 || Math.abs(pageIndex - destinationIndex) <= 1 ? (
                <PeriodPageContent
                  month={month}
                  onMove={move}
                  active={month === value}
                  renderPage={renderPage}
                />
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function PeriodPageContent({
  month,
  onMove,
  active,
  renderPage,
}: {
  readonly month: string;
  readonly onMove: (delta: number) => void;
  readonly active: boolean;
  readonly renderPage: PageRenderer;
}) {
  return renderPage(month, onMove, active);
}
