/** Diagnostic presentation only. No routes, parameters, domain data or wall-clock times are retained. */
export const PERFORMANCE_SCREENS = [
  "Weitere Seite",
  "Kalender",
  "Auswertung",
  "Vorlagen",
  "Mehr",
  "Gehalt",
  "Gehaltsdetails",
  "Arbeitszeit",
  "Zuschläge",
  "Dienstplan-Check",
  "Einstellungen",
  "Kalenderansicht",
] as const;
export function performanceScreen(segments: readonly string[]): number {
  const leaf = segments.at(-1);
  const details: Record<string, number> = {
    salary: 5,
    "salary-details": 6,
    "worktime-details": 7,
    "premium-details": 8,
    "compliance-details": 9,
    "check-issue": 9,
    "check-settings": 9,
    "settings-editor": 10,
    appearance: 10,
    "net-pay-settings": 10,
    "calendar-view": 11,
    "calendar-design": 11,
  };
  if (leaf && details[leaf] !== undefined) return details[leaf];
  if (segments.includes("(calendar)")) return 1;
  if (segments.includes("(analysis)")) return 2;
  if (segments.includes("(templates)")) return 3;
  if (segments.includes("(more)")) return 4;
  return 0;
}
export interface PerformanceFrameWindow {
  readonly duration: number;
  readonly count: number;
  readonly maximum: number;
  readonly over17: number;
  readonly over34: number;
  readonly over50: number;
  readonly missed60: number;
}
export function createNavigationPerformance(now: () => number = () => performance.now()) {
  let session = 0,
    started = 0,
    previousScreen = -1;
  let snapshot = {
    visible: true,
    screen: 0,
    fps: null as number | null,
    maximum: 0,
    over34: 0,
    jsLag: 0,
  };
  const windows: (PerformanceFrameWindow & { t: number; screen: number })[] = [];
  const changes: { t: number; from: number; to: number }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const elapsed = () => Math.round(Math.max(0, now() - started) * 100) / 100;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    isVisible: () => snapshot.visible,
    start(id: number) {
      if (id === session) return;
      session = id;
      if (!id) return;
      started = now();
      previousScreen = -1;
      windows.length = 0;
      changes.length = 0;
      snapshot = { ...snapshot, fps: null, maximum: 0, over34: 0, jsLag: 0 };
      notify();
    },
    screen(id: number, screen: number) {
      if (!session || id !== session || !Number.isInteger(screen) || !PERFORMANCE_SCREENS[screen])
        return;
      if (screen === previousScreen) return;
      if (changes.length === 300) changes.shift();
      changes.push({ t: elapsed(), from: previousScreen, to: screen });
      previousScreen = screen;
      snapshot = { ...snapshot, screen };
      notify();
    },
    frame(id: number, frame: PerformanceFrameWindow) {
      if (
        !session ||
        id !== session ||
        Object.values(frame).some((value) => !Number.isFinite(value) || value < 0) ||
        frame.duration <= 0 ||
        frame.count <= 0
      )
        return;
      if (windows.length === 1200) windows.shift();
      windows.push({ ...frame, t: elapsed(), screen: snapshot.screen });
      snapshot = {
        ...snapshot,
        fps: (frame.count * 1000) / frame.duration,
        maximum: frame.maximum,
        over34: frame.over34,
      };
      notify();
    },
    lag(id: number, value: number) {
      if (!session || id !== session || !Number.isFinite(value) || value < 0) return;
      snapshot = { ...snapshot, jsLag: value };
      notify();
    },
    setVisible(visible: boolean) {
      snapshot = { ...snapshot, visible };
      notify();
    },
    report: () => ({
      schema: 1,
      targetFps: 60,
      targetFrameMs: 1000 / 60,
      screens: PERFORMANCE_SCREENS,
      windows: windows.map((value) => ({ ...value })),
      changes: changes.map((value) => ({ ...value })),
      limits:
        "UI-runtime callback cadence, not GPU presentation FPS. Target 60 does not cap actual refresh rate. missed60 estimates missed 60-Hz opportunities. Route changes mark JS route commits, not physical gesture or animation start. Window t is JS receipt time and can be delayed by JS work; windows may span several routes. Only foreground complete 500-ms windows; partial windows omitted on pause/stop. Maximum 1200 windows and 300 route changes; retained in RAM until next start, discard or process exit. Instrumentation and overlay add overhead.",
    }),
    clear() {
      session = 0;
      windows.length = 0;
      changes.length = 0;
      snapshot = { ...snapshot, fps: null, maximum: 0, over34: 0, jsLag: 0 };
      notify();
    },
  };
}
export const navigationPerformance = createNavigationPerformance();
