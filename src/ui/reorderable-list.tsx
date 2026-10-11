import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { moveListItem } from "@/domain/reorder";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { ReorderableRow } from "@/ui/reorderable-row";
import { Text } from "@/ui/text";
import { selectionFeedback } from "@/ui/haptics";
import { reorderOffsets, reorderTarget } from "@/ui/reorder-geometry";
import type { ReorderScroll } from "@/ui/use-reorder-scroll";

export interface ReorderItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly leading: ReactNode;
}
interface Drag {
  readonly id: string;
  readonly from: number;
  readonly heights: readonly number[];
  readonly top: number;
  readonly scrollStart: number;
  translation: number;
  x: number;
  absoluteY: number;
  target: number;
}
export interface ReorderPosition {
  readonly x: Animated.Value;
  readonly y: Animated.Value;
}

/** Native gestures, with React/persistence callbacks kept on the JS thread. */
export function ReorderableList({
  items,
  onMove,
  disabled = false,
  saveFailed = false,
  scroll,
  testID,
}: {
  readonly items: readonly ReorderItem[];
  readonly onMove: (id: string, index: number) => void | Promise<void>;
  readonly disabled?: boolean;
  readonly saveFailed?: boolean;
  readonly scroll?: ReorderScroll;
  readonly testID: string;
}) {
  const p = usePalette();
  const incoming = items.map((item) => item.id);
  const orderKey = JSON.stringify(incoming);
  const [order, setOrder] = useState(incoming);
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});
  const acceptedOrderKey = useRef(orderKey);
  const incomingChanged = useRef(false);
  const externalSaving = useRef(disabled);
  const drag = useRef<Drag | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const positions = useRef(new Map<string, ReorderPosition>());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const duration = reduced ? 0 : 200;
  const layout = useMemo(() => {
    const tops = new Map<string, number>();
    let height = 0;
    order.forEach((id) => {
      tops.set(id, height);
      height += heights[id] ?? 72;
    });
    return { tops, height };
  }, [order, heights]);
  function position(id: string) {
    return positions.current.get(id)!;
  }
  const registerPosition = useCallback((id: string, values: ReorderPosition) => {
    positions.current.set(id, values);
    return () => {
      values.x.stopAnimation();
      values.y.stopAnimation();
      positions.current.delete(id);
    };
  }, []);
  const stopScrolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  const stopMotion = useCallback(() => {
    positions.current.forEach(({ x, y }) => {
      x.stopAnimation();
      y.stopAnimation();
    });
  }, []);
  useLayoutEffect(() => {
    if (active) return;
    // Resting rows use the same coordinates as the landing animation. Their
    // underlying layout never moves and there is no reset-to-zero handoff.
    positions.current.forEach(({ x, y }, id) => {
      x.stopAnimation();
      y.stopAnimation();
      x.setValue(0);
      y.setValue(layout.tops.get(id) ?? 0);
    });
  }, [active, layout]);
  useEffect(() => {
    mounted.current = true;
    if (acceptedOrderKey.current !== orderKey || (externalSaving.current && !disabled)) {
      acceptedOrderKey.current = orderKey;
      incomingChanged.current = true;
    }
    externalSaving.current = disabled;
    if (
      !drag.current &&
      !active &&
      !pending &&
      !disabled &&
      (incomingChanged.current || saveFailed)
    ) {
      incomingChanged.current = false;
      setOrder((current) =>
        JSON.stringify(current) === orderKey ? current : (JSON.parse(orderKey) as string[]),
      );
    }
  }, [orderKey, active, pending, disabled, saveFailed]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted.current) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted.current = false;
      subscription.remove();
      stopScrolling();
      scroll?.setDragging(false);
      stopMotion();
    };
  }, [scroll, stopMotion, stopScrolling]);

  function animate(id: string, y: number, x = 0) {
    const values = position(id);
    return Animated.parallel([
      Animated.timing(values.y, { toValue: y, duration, useNativeDriver: true }),
      Animated.timing(values.x, { toValue: x, duration, useNativeDriver: true }),
    ]);
  }
  function update() {
    const current = drag.current;
    if (!current) return;
    const translation = current.translation + (scroll?.offset() ?? 0) - current.scrollStart;
    position(current.id).y.setValue(current.top + translation);
    position(current.id).x.setValue(current.x);
    const target = reorderTarget(current.heights, current.from, translation);
    if (target === current.target) return;
    current.target = target;
    const offsets = reorderOffsets(current.heights, current.from, target);
    order.forEach((id, index) => {
      if (id !== current.id) animate(id, (layout.tops.get(id) ?? 0) + offsets[index]).start();
    });
  }
  function begin(id: string) {
    if (disabled || busy.current || active || drag.current) return;
    const from = order.indexOf(id);
    drag.current = {
      id,
      from,
      heights: order.map((key) => heights[key] ?? 72),
      top: layout.tops.get(id) ?? 0,
      scrollStart: scroll?.offset() ?? 0,
      translation: 0,
      x: 0,
      absoluteY: Number.NaN,
      target: from,
    };
    setActive(id);
    scroll?.setDragging(true);
    selectionFeedback();
    timer.current = setInterval(() => {
      if (drag.current && Number.isFinite(drag.current.absoluteY)) {
        scroll?.step(drag.current.absoluteY);
        update();
      }
    }, 16);
  }
  async function commit(id: string, from: number, to: number) {
    if (from === to || busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    const previous = order;
    setOrder([...moveListItem(order, from, to)]);
    try {
      await onMove(id, to);
      if (mounted.current) {
        selectionFeedback();
        AccessibilityInfo.announceForAccessibility(
          `${items.find((item) => item.id === id)?.title}, Position ${to + 1} von ${items.length}`,
        );
      }
    } catch {
      if (mounted.current) {
        setOrder(previous);
        AccessibilityInfo.announceForAccessibility("Reihenfolge konnte nicht gespeichert werden.");
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function finish(cancelled: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    stopScrolling();
    const target = cancelled ? current.from : current.target;
    const offsets = reorderOffsets(current.heights, current.from, target);
    Animated.parallel(
      order.map((id, index) => animate(id, (layout.tops.get(id) ?? 0) + offsets[index])),
    ).start(({ finished }) => {
      if (!mounted.current) return;
      const landed = reorderOffsets(
        current.heights,
        current.from,
        finished ? target : current.from,
      );
      order.forEach((id, index) => {
        const values = position(id);
        values.x.stopAnimation();
        values.y.stopAnimation();
        values.x.setValue(0);
        values.y.setValue((layout.tops.get(id) ?? 0) + landed[index]);
      });
      scroll?.setDragging(false);
      setActive(null);
      if (finished && !cancelled) void commit(current.id, current.from, target);
    });
  }
  return (
    <GestureHandlerRootView style={{ flexGrow: 0 }}>
      <View style={{ gap: SPACING.sm }}>
        <Text style={{ color: p.textMuted, ...TYPOGRAPHY.caption }}>
          Gedrückt halten und verschieben.
        </Text>
        <View
          testID={testID}
          style={{
            borderRadius: RADII.card,
            borderCurve: CORNER_CURVE,
            backgroundColor: p.surface,
            borderWidth: 1,
            borderColor: p.separator,
            height: layout.height + 2,
          }}
        >
          {order.map((id, index) => {
            const item = items.find((candidate) => candidate.id === id);
            if (!item) return null;
            return (
              <ReorderableRow
                key={id}
                item={item}
                index={index}
                initialY={layout.tops.get(id) ?? 0}
                count={items.length}
                onRegisterPosition={registerPosition}
                lifted={active === id}
                disabled={disabled || pending}
                testID={testID}
                onStart={() => begin(id)}
                onDrag={(x, y, absoluteY) => {
                  if (drag.current?.id !== id) return;
                  drag.current.translation = y;
                  drag.current.x = x;
                  drag.current.absoluteY = absoluteY;
                  update();
                }}
                onEnd={(success) => {
                  if (drag.current?.id === id) finish(!success);
                }}
                onHeight={(height) => {
                  if (!Number.isFinite(height) || height <= 0) return;
                  setHeights((current) =>
                    current[id] === height ? current : { ...current, [id]: height },
                  );
                }}
                onAccessibilityMove={(delta) => {
                  if (!active) void commit(id, index, index + delta);
                }}
              />
            );
          })}
        </View>
      </View>
    </GestureHandlerRootView>
  );
}
