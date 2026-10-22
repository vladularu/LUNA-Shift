import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { scheduleIdleWork } from "@/ui/schedule-idle-work";
import {
  calendarPageTarget,
  calendarPageWindow,
  prepareCalendarPages,
} from "./calendar-page-window";

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

/** Fixed native positions and a five-month window keyed by actual month.
 * Four bodies survive a one-month swipe; only the entering edge mounts.
 * The selected body survives its year transition with its moving date glyphs. */
export function CalendarStablePager({
  month,
  months,
  height,
  enabled,
  transitioning = false,
  revision,
  renderMonth,
  onBeginDrag,
  onSettled,
  onVisibleMonth,
  onPositioned,
}: {
  month: string;
  months: readonly string[];
  height: number;
  enabled: boolean;
  transitioning?: boolean;
  revision: number;
  renderMonth: (month: string) => ReactNode;
  onBeginDrag: () => void;
  onSettled: (event: ScrollEvent) => void;
  onVisibleMonth?: (month: string) => void;
  onPositioned?: (target: string) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const dragging = useRef(false);
  const index = Math.max(0, months.indexOf(month));
  const targetKey = calendarPageTarget(month, revision, months[0], height);
  const [storedWindow, setWindow] = useState(() => {
    const initial = calendarPageWindow(targetKey, month, months);
    return enabled && startupPresentation.isReady()
      ? prepareCalendarPages(initial, months)
      : initial;
  });
  const window =
    storedWindow.target === targetKey
      ? storedWindow
      : calendarPageWindow(targetKey, month, months, storedWindow.prepared);
  // Derive the destination before committing children, not in a later layout pass.
  if (window !== storedWindow) setWindow(window);
  const previewMonth = useRef(month);
  useEffect(() => {
    if (!enabled || transitioning || prepareCalendarPages(window, months) === window) return;
    if (!startupPresentation.isReady()) {
      let cancelIdle = () => {};
      const cancelPresentation = startupPresentation.after(() => {
        cancelIdle = scheduleIdleWork(() => {
          setWindow((old) => (old.target === targetKey ? prepareCalendarPages(old, months) : old));
        });
      });
      return () => {
        cancelPresentation();
        cancelIdle();
      };
    }
    // Keep prepared pages in year mode. New neighbours wait for the actual
    // animation completion; requestAnimationFrame alone is not an idle gate.
    const frame = requestAnimationFrame(() => {
      setWindow((old) => (old.target === targetKey ? prepareCalendarPages(old, months) : old));
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, transitioning, targetKey, months, window]);
  const renderIndex = Math.max(0, months.indexOf(window.center));
  const target = index * height;
  const [initialOffset] = useState({ x: 0, y: target });
  const nativeOffset = useRef(target);
  const settledMonth = useRef(month);
  const previous = useRef({ height, revision, enabled, first: months[0] });
  const pendingTarget = useRef<number | null>(null);
  const [positioning, setPositioning] = useState(false);
  useLayoutEffect(() => {
    const old = previous.current;
    const external =
      settledMonth.current !== month ||
      old.height !== height ||
      old.revision !== revision ||
      old.enabled !== enabled ||
      old.first !== months[0];
    previous.current = { height, revision, enabled, first: months[0] };
    if (!external) {
      if (pendingTarget.current === null) onPositioned?.(targetKey);
      return;
    }
    previewMonth.current = month;
    dragging.current = false;
    settledMonth.current = month;
    pendingTarget.current = Math.abs(nativeOffset.current - target) > 1 ? target : null;
    setPositioning(pendingTarget.current !== null);
    ref.current?.scrollTo({ y: target, animated: false });
    if (pendingTarget.current === null) onPositioned?.(targetKey);
  }, [month, height, revision, enabled, months, target, targetKey, onPositioned]);
  // Recovery only for explicit jumps/layout changes racing native layout.
  // Ordinary settled gestures never enter this state.
  useEffect(() => {
    if (!positioning) return;
    const retry = setInterval(() => {
      if (pendingTarget.current !== null)
        ref.current?.scrollTo({ y: pendingTarget.current, animated: false });
    }, 200);
    return () => clearInterval(retry);
  }, [positioning]);

  const monthAt = (y: number) =>
    months[Math.max(0, Math.min(months.length - 1, Math.round(y / height)))];
  const settle = (event: ScrollEvent) => {
    if (
      !enabled ||
      transitioning ||
      pendingTarget.current !== null ||
      !dragging.current ||
      height <= 0
    )
      return;
    const y = event.nativeEvent.contentOffset.y;
    // Intermediate end events from an interrupted native snap are not commits.
    if (Math.abs(y / height - Math.round(y / height)) > 0.001) return;
    dragging.current = false;
    nativeOffset.current = y;
    const next = monthAt(y);
    setWindow((old) =>
      prepareCalendarPages(calendarPageWindow(old.target, next, months, old.prepared), months),
    );
    previewMonth.current = next;
    settledMonth.current = next;
    onPositioned?.(calendarPageTarget(next, revision, months[0], height));
    onVisibleMonth?.(next);
    onSettled(event);
  };
  const pages = window.prepared.map((key) => ({ key, index: months.indexOf(key) }));
  const start = pages[0]?.index ?? renderIndex;
  const end = pages.at(-1)?.index ?? renderIndex;
  return (
    <ScrollView
      ref={ref}
      testID="calendar-month-pager"
      contentInsetAdjustmentBehavior="never"
      contentOffset={initialOffset}
      onContentSizeChange={() => {
        if (pendingTarget.current !== null)
          ref.current?.scrollTo({ y: pendingTarget.current, animated: false });
      }}
      scrollEnabled={enabled && !transitioning && !positioning}
      scrollEventThrottle={16}
      onScroll={(event) => {
        const y = event.nativeEvent.contentOffset.y;
        nativeOffset.current = y;
        if (pendingTarget.current !== null) {
          if (Math.abs(y - pendingTarget.current) <= 1) {
            pendingTarget.current = null;
            setPositioning(false);
            onPositioned?.(targetKey);
          }
        } else if (dragging.current && enabled && !transitioning && height > 0) {
          const visible = monthAt(y);
          if (previewMonth.current !== visible) {
            previewMonth.current = visible;
            setWindow((old) =>
              prepareCalendarPages(
                calendarPageWindow(old.target, visible, months, old.prepared),
                months,
              ),
            );
            onVisibleMonth?.(visible);
          }
        }
      }}
      pagingEnabled
      bounces={false}
      decelerationRate="fast"
      disableIntervalMomentum
      snapToInterval={height}
      showsVerticalScrollIndicator={false}
      onScrollBeginDrag={() => {
        if (!enabled || transitioning || pendingTarget.current !== null) return;
        setWindow((old) => prepareCalendarPages(old, months));
        dragging.current = true;
        onBeginDrag();
      }}
      onMomentumScrollEnd={settle}
      onScrollEndDrag={(event) => {
        if (event.nativeEvent.velocity?.y === 0) settle(event);
      }}
    >
      <View key="before" style={{ height: start * height }} />
      {pages.map((page, i) => (
        <Fragment key={page.key}>
          {i > 0 && page.index > pages[i - 1].index + 1 ? (
            <View style={{ height: (page.index - pages[i - 1].index - 1) * height }} />
          ) : null}
          <View
            key="page"
            testID={`calendar-slot-${page.index - renderIndex}`}
            style={{ height }}
            accessibilityElementsHidden={page.index !== renderIndex}
            importantForAccessibility={page.index === renderIndex ? "auto" : "no-hide-descendants"}
          >
            {renderMonth(page.key)}
          </View>
        </Fragment>
      ))}
      <View key="after" style={{ height: (months.length - end - 1) * height }} />
    </ScrollView>
  );
}
