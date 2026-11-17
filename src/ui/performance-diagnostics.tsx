import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useSegments } from "expo-router";
import { AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { FullWindowOverlay } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { runOnJS, useFrameCallback, useSharedValue, type FrameInfo } from "react-native-reanimated";
import { calendarPerformance } from "@/application/calendar-performance";
import {
  navigationPerformance,
  performanceScreen,
  PERFORMANCE_SCREENS,
  type PerformanceFrameWindow,
} from "@/application/navigation-performance";
import { DEV_TOOLS_AVAILABLE } from "@/infrastructure/dev-tools-policy";
import { DARK_PALETTE } from "@/theme/palette";
import { RADII, SPACING, MINIMUM_TOUCH_TARGET } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "./text";

function publishFrames(session: number, frame: PerformanceFrameWindow) {
  if (calendarPerformance.getSnapshot() !== session) return;
  navigationPerformance.frame(session, frame);
  calendarPerformance.record(
    "navigation-frames",
    { ...frame, mode: navigationPerformance.getSnapshot().screen },
    session,
  );
}

/** A single probe above navigation; navigation commits never reset the frame window. */
export function PerformanceDiagnostics() {
  return DEV_TOOLS_AVAILABLE && Platform.OS === "ios" ? <PerformanceMonitor /> : null;
}
function PerformanceMonitor() {
  "use no memo";
  const session = useSyncExternalStore(
    calendarPerformance.subscribe,
    calendarPerformance.getSnapshot,
    () => 0,
  );
  const segments = useSegments();
  const screen = performanceScreen(segments);
  const sampling = useSharedValue(0);
  const bucket = useSharedValue([-1, 0, 0, 0, 0, 0, 0]);
  const onFrame = useCallback(
    (frame: FrameInfo) => {
      "worklet";
      if (!sampling.value) return;
      const b = bucket.value;
      if (b[0] < 0 || frame.timeSincePreviousFrame === null) {
        bucket.set([frame.timestamp, 0, 0, 0, 0, 0, 0]);
        return;
      }
      const gap = frame.timeSincePreviousFrame;
      const next = [
        b[0],
        b[1] + 1,
        Math.max(b[2], gap),
        b[3] + (gap > 17 ? 1 : 0),
        b[4] + (gap > 34 ? 1 : 0),
        b[5] + (gap > 50 ? 1 : 0),
        b[6] + Math.max(0, Math.round(gap / (1000 / 60)) - 1),
      ];
      if (frame.timestamp - b[0] >= 500) {
        runOnJS(publishFrames)(sampling.value, {
          duration: frame.timestamp - b[0],
          count: next[1],
          maximum: next[2],
          over17: next[3],
          over34: next[4],
          over50: next[5],
          missed60: next[6],
        });
        bucket.set([frame.timestamp, 0, 0, 0, 0, 0, 0]);
      } else bucket.set(next);
    },
    [bucket, sampling],
  );
  const frames = useFrameCallback(onFrame, false);
  useLayoutEffect(() => {
    navigationPerformance.start(session);
    navigationPerformance.screen(session, screen);
  }, [session, screen]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (state: string) => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      const enabled = Boolean(session && state === "active");
      sampling.set(enabled ? session : 0);
      bucket.set([-1, 0, 0, 0, 0, 0, 0]);
      frames.setActive(enabled);
      calendarPerformance.record("navigation-sampling", { state: enabled ? 1 : 0 }, session);
      if (!enabled) return;
      let previous = performance.now(),
        worst = 0,
        lastPublish = previous;
      timer = setInterval(() => {
        const now = performance.now(),
          lag = Math.max(0, now - previous - 100);
        previous = now;
        worst = Math.max(worst, lag);
        if (lag > 20) calendarPerformance.record("navigation-lag", { duration: lag }, session);
        if (now - lastPublish >= 500) {
          navigationPerformance.lag(session, worst);
          worst = 0;
          lastPublish = now;
        }
      }, 100);
    };
    update(AppState.currentState);
    const subscription = AppState.addEventListener("change", update);
    const expiry = session ? setTimeout(calendarPerformance.stop, 600_000) : undefined;
    return () => {
      subscription.remove();
      if (timer !== undefined) clearInterval(timer);
      if (expiry !== undefined) clearTimeout(expiry);
      sampling.set(0);
      frames.setActive(false);
    };
  }, [bucket, frames, sampling, session]);
  return session ? <PerformanceOverlay /> : null;
}
function PerformanceOverlay() {
  const state = useSyncExternalStore(
    navigationPerformance.subscribe,
    navigationPerformance.getSnapshot,
  );
  const insets = useSafeAreaInsets();
  if (!state.visible) return null;
  return (
    <FullWindowOverlay>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={[styles.panel, { top: insets.top + 48 }]} testID="performance-overlay">
          <View style={styles.heading}>
            <Text style={styles.title}>Diagnose · Ziel 60 FPS</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Diagnoseanzeige ausblenden"
              hitSlop={10}
              onPress={() => navigationPerformance.setVisible(false)}
              style={styles.close}
            >
              <Text style={styles.text}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.text}>{PERFORMANCE_SCREENS[state.screen]}</Text>
          <Text style={styles.text}>
            UI-Takt {state.fps === null ? "…" : state.fps.toFixed(1)} FPS
          </Text>
          <Text style={styles.text}>
            Längstes Intervall {state.maximum.toFixed(1)} ms · &gt;34 ms: {state.over34}
          </Text>
          <Text style={styles.text}>JS-Verzögerung {state.jsLag.toFixed(1)} ms</Text>
          <Text style={styles.note}>Letztes Messfenster · keine GPU-Messung</Text>
        </View>
      </View>
    </FullWindowOverlay>
  );
}
const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    right: SPACING.sm,
    maxWidth: "94%",
    padding: SPACING.sm,
    borderRadius: RADII.small,
    backgroundColor: DARK_PALETTE.surfaceRaised,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.md,
  },
  close: {
    minWidth: MINIMUM_TOUCH_TARGET,
    minHeight: MINIMUM_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...TYPOGRAPHY.label, color: DARK_PALETTE.text },
  text: { ...TYPOGRAPHY.caption, color: DARK_PALETTE.text, fontVariant: ["tabular-nums"] },
  note: { ...TYPOGRAPHY.micro, color: DARK_PALETTE.textMuted, marginTop: SPACING.xxs },
});
