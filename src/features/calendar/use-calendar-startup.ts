import { useCallback, useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { calendarPerformance } from "@/application/calendar-performance";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { useCalendarHeaderOverlap } from "./calendar-header";

/** All measurements must describe the same native viewport before startup opens. */
export function useCalendarViewport() {
  const [pageHeight, setPageHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 });
  const { headerHeight, headerOverlap, measureHeader } = useCalendarHeaderOverlap();
  const expectedPageHeight = viewportHeight - headerHeight + headerOverlap;
  const ready =
    viewportHeight > 0 &&
    headerHeight > 0 &&
    sceneSize.width > 0 &&
    sceneSize.height > 0 &&
    Math.abs(sceneSize.height - expectedPageHeight) <= 1 &&
    Math.abs(pageHeight - sceneSize.height) <= 1;
  const measurePager = useCallback(
    (event: LayoutChangeEvent) => {
      // Native iOS paging uses the exact viewport height, including subpixels.
      const nextHeight = event.nativeEvent.layout.height;
      calendarPerformance.record("pager-layout", { height: nextHeight });
      if (nextHeight > 0 && nextHeight !== pageHeight) setPageHeight(nextHeight);
    },
    [pageHeight],
  );
  return {
    pageHeight,
    headerOverlap,
    measureHeader,
    measurePager,
    measureViewport: (event: LayoutChangeEvent) =>
      setViewportHeight(event.nativeEvent.layout.height),
    measureScene: setSceneSize,
    ready,
  };
}

export function useCalendarStartup({
  active,
  ready,
  failed,
  positioned,
}: {
  active: boolean;
  ready: boolean;
  failed: boolean;
  positioned: boolean;
}) {
  useEffect(() => {
    if (startupPresentation.isReady() || !active || (!failed && (!ready || !positioned))) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => startupPresentation.complete());
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [active, failed, positioned, ready]);
}
