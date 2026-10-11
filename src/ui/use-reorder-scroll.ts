import { useMemo, useRef, useState } from "react";
import {
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

export interface ReorderScroll {
  readonly offset: () => number;
  readonly step: (absoluteY: number) => void;
  readonly setDragging: (dragging: boolean) => void;
}

/** Shared edge scrolling; the overlay footer is excluded from the drop viewport. */
export function useReorderScroll(bottomInset = 100) {
  const scrollRef = useRef<ScrollView>(null);
  const metrics = useRef({ offset: 0, top: 0, height: 0, contentHeight: 0 });
  const [dragging, setDragging] = useState(false);
  const controller = useMemo<ReorderScroll>(
    () => ({
      offset: () => metrics.current.offset,
      setDragging,
      step: (absoluteY) => {
        const m = metrics.current;
        if (!m.height) return;
        const top = m.top + 48;
        const bottom = m.top + m.height - bottomInset - 48;
        const speed =
          absoluteY < top
            ? -Math.min(12, (top - absoluteY) / 4)
            : absoluteY > bottom
              ? Math.min(12, (absoluteY - bottom) / 4)
              : 0;
        const next = Math.max(0, Math.min(m.contentHeight - m.height, m.offset + speed));
        if (next === m.offset) return;
        m.offset = next;
        scrollRef.current?.scrollTo({ y: next, animated: false });
      },
    }),
    [bottomInset],
  );
  return {
    scrollRef,
    controller,
    scrollProps: {
      scrollEnabled: !dragging,
      scrollEventThrottle: 16,
      onLayout: (event: LayoutChangeEvent) => {
        metrics.current.height = event.nativeEvent.layout.height;
        scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, y) => {
          metrics.current.top = y;
        });
      },
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        metrics.current.offset = event.nativeEvent.contentOffset.y;
      },
      onContentSizeChange: (_width: number, height: number) => {
        metrics.current.contentHeight = height;
      },
    },
  };
}
