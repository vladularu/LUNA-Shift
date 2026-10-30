import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CalendarHeader } from "@/features/calendar/calendar-header";
import { CalendarBackgroundContext } from "@/features/settings/calendar-background-context";
import { CALENDAR_VIEW_ZOOM } from "@/features/calendar/calendar-view-transition";
import { MOTION } from "@/theme/motion";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/theme/palette-values";

const photoBackground = {
  uri: null as string | null,
  strength: "medium" as const,
  setStrength: async () => {},
  ready: true,
  busy: false,
  error: null,
  supported: true,
  choose: async () => {},
  remove: async () => {},
  canUndoRemoval: false,
  undoRemove: async () => {},
  reset: async () => true,
  retry: () => {},
};

function PlannerHeader({
  direction = "NEXT",
  month = "2026-08",
  referenceMonth = "2026-08",
  titleTransition = "SPATIAL",
  viewMode = "MONTH",
  synchronized = false,
  pageTitle = false,
  notice,
  plannerActive = true,
  onOpenSharing,
  onOpenDisplay = jest.fn(),
  onOpenYear = jest.fn(),
}: {
  direction?: "NEXT" | "PREVIOUS";
  month?: string;
  referenceMonth?: string;
  titleTransition?: "SPATIAL" | "CROSSFADE";
  viewMode?: "MONTH" | "YEAR";
  synchronized?: boolean;
  pageTitle?: boolean;
  notice?: string;
  plannerActive?: boolean;
  onOpenSharing?: () => void;
  onOpenDisplay?: () => void;
  onOpenYear?: () => void;
} = {}) {
  const plannerTransition = useSharedValue(plannerActive ? 1 : 0);
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 932, width: 430, x: 0, y: 0 },
        insets: { bottom: 34, left: 0, right: 0, top: 59 },
      }}
    >
      <CalendarHeader
        pageTitle={pageTitle}
        synchronized={synchronized}
        notice={notice}
        direction={direction}
        month={month}
        onMoveYear={jest.fn()}
        onOpenSharing={onOpenSharing}
        onOpenDisplay={onOpenDisplay}
        onOpenYear={onOpenYear}
        plannerActive={plannerActive}
        plannerTransition={plannerTransition}
        referenceMonth={referenceMonth}
        transition={titleTransition}
        viewMode={viewMode}
      />
    </SafeAreaProvider>
  );
}

describe("CalendarHeader", () => {
  beforeEach(() => {
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(false);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
  });

  it("keeps all three actions compact with comfortable touch targets and preserves their destinations", async () => {
    jest
      .spyOn(
        jest.requireActual<typeof import("react-native")>("react-native"),
        "useWindowDimensions",
      )
      .mockReturnValue({ width: 430, height: 932, scale: 3, fontScale: 1 });
    const onOpenSharing = jest.fn();
    const onOpenYear = jest.fn();
    const onOpenDisplay = jest.fn();
    const screen = await render(
      <PlannerHeader
        pageTitle
        plannerActive={false}
        onOpenSharing={onOpenSharing}
        onOpenYear={onOpenYear}
        onOpenDisplay={onOpenDisplay}
      />,
    );
    const actions = screen.getAllByRole("button");
    expect(actions).toHaveLength(3);
    expect(screen.getByTestId("calendar-header-position")).toHaveStyle({
      marginRight: -18,
      transform: [{ translateY: 3.5 }],
    });
    expect(screen.getByTestId("calendar-header-position")).toHaveProp("pointerEvents", "box-none");
    expect(screen.getByTestId("calendar-header")).toHaveStyle({ paddingHorizontal: 24 });
    expect(screen.getByTestId("calendar-header-actions")).toHaveStyle({
      minHeight: 48,
      paddingHorizontal: 2,
      paddingVertical: 2 - StyleSheet.hairlineWidth,
    });
    for (const action of actions) {
      expect(action).toHaveStyle({ width: 48, height: 44 });
    }
    await fireEvent.press(screen.getByRole("button", { name: "Kalender teilen" }));
    await fireEvent.press(screen.getByRole("button", { name: "2026, Jahresansicht öffnen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Kalender gestalten öffnen" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);
    expect(onOpenYear).toHaveBeenCalledTimes(1);
    expect(onOpenDisplay).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("uses native glass in the selected theme (dark=%s)", async (dark) => {
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(true);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
    jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue(dark ? "dark" : "light");
    const screen = await render(<PlannerHeader plannerActive={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("calendar-header-glass")).toHaveProp(
        "colorScheme",
        dark ? "dark" : "light",
      );
    });
    expect(screen.getByTestId("calendar-header-actions")).toHaveStyle({
      backgroundColor: "transparent",
    });
    expect(screen.getByTestId("calendar-header-glass")).toHaveProp("pointerEvents", "none");
  });

  it.each([false, true])(
    "keeps a readable fallback without native glass (dark=%s)",
    async (dark) => {
      jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      const screen = await render(
        <PlannerHeader plannerActive={false} onOpenSharing={jest.fn()} />,
      );
      expect(screen.queryByTestId("calendar-header-glass")).toBeNull();
      expect(screen.getByTestId("calendar-header-actions")).toHaveStyle({
        backgroundColor: (dark ? DARK_PALETTE : LIGHT_PALETTE).surfaceRaised,
      });
      expect(screen.getAllByRole("button")).toHaveLength(3);
    },
  );

  it("keeps all actions usable on Android without requesting iOS glass", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const screen = await render(<PlannerHeader plannerActive={false} onOpenSharing={jest.fn()} />);
    expect(isGlassEffectAPIAvailable).not.toHaveBeenCalled();
    expect(screen.queryByTestId("calendar-header-glass")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("responds to reduced transparency without hiding the three controls", async () => {
    jest.mocked(isGlassEffectAPIAvailable).mockReturnValue(true);
    jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
    jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
    jest
      .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
      .mockReturnValue("light");
    const events = jest.spyOn(AccessibilityInfo, "addEventListener");
    const screen = await render(<PlannerHeader plannerActive={false} onOpenSharing={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId("calendar-header-glass")).toBeTruthy());
    const onChange = events.mock.calls.find(
      ([event]) => String(event) === "reduceTransparencyChanged",
    )?.[1] as ((enabled: boolean) => void) | undefined;
    expect(onChange).toBeDefined();
    await act(() => onChange?.(true));
    expect(screen.queryByTestId("calendar-header-glass")).toBeNull();
    expect(screen.getByTestId("calendar-header-actions")).toHaveStyle({
      backgroundColor: LIGHT_PALETTE.surfaceRaised,
    });
    expect(screen.getAllByRole("button")).toHaveLength(3);
    await act(() => onChange?.(false));
    expect(screen.getByTestId("calendar-header-glass")).toBeTruthy();
  });

  it("keeps fixed controls but leaves the month title to its scrolling page", async () => {
    const screen = await render(<PlannerHeader pageTitle synchronized plannerActive={false} />);
    expect(screen.queryByRole("header")).toBeNull();
    expect(screen.getByTestId("calendar-header")).toHaveStyle({ backgroundColor: "transparent" });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    await screen.rerender(
      <PlannerHeader pageTitle synchronized plannerActive={false} viewMode="YEAR" />,
    );
    expect(screen.getByRole("header", { name: "2026" })).toBeVisible();
  });
  it("reveals the same photo behind the title and safe top while keeping controls accessible", async () => {
    const screen = await render(<PlannerHeader plannerActive={false} />);
    const initial = StyleSheet.flatten(screen.getByTestId("calendar-header").props.style);
    expect(initial.backgroundColor).not.toBe("transparent");
    await screen.rerender(
      <CalendarBackgroundContext value={{ ...photoBackground, uri: "file:///calendar-photo.jpg" }}>
        <PlannerHeader plannerActive={false} />
      </CalendarBackgroundContext>,
    );
    expect(screen.getByTestId("calendar-header")).toHaveStyle({
      backgroundColor: "transparent",
      paddingTop: initial.paddingTop,
      minHeight: initial.minHeight,
    });
    expect(screen.getByRole("header", { name: "August" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    await screen.rerender(<PlannerHeader plannerActive={false} />);
    expect(screen.getByTestId("calendar-header")).toHaveStyle({
      backgroundColor: initial.backgroundColor,
    });
  });
  it("updates the controlled title in place and keeps the full warning accessible", async () => {
    const notice = "Feiertagsregeln für diesen Zeitraum noch nicht verfügbar.";
    const screen = await render(
      <PlannerHeader synchronized notice={notice} plannerActive={false} />,
    );
    const title = screen.getByRole("header", { name: "August" });
    expect(title.props.entering).toBeUndefined();
    expect(title.props.exiting).toBeUndefined();
    await screen.rerender(
      <PlannerHeader synchronized month="2026-09" notice={notice} plannerActive={false} />,
    );
    expect(screen.getByRole("header", { name: "September" })).toBe(title);
    await fireEvent.press(
      screen.getByRole("button", {
        name: `Kalender gestalten öffnen. Hinweis: ${notice}`,
        includeHiddenElements: true,
      }),
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByTestId("calendar-notice-control")).toBeNull();
    expect(screen.getByTestId("calendar-notice-badge")).toHaveStyle({ position: "absolute" });
  });
  it("keeps one title line and the same height for September 2027 and year view", async () => {
    const screen = await render(
      <PlannerHeader synchronized month="2027-09" referenceMonth="2026-09" plannerActive={false} />,
    );
    const title = screen.getByRole("header", { name: "September 2027" });
    const height = StyleSheet.flatten(title.props.style).height;
    expect(height).toBeGreaterThan(0);
    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.adjustsFontSizeToFit).toBe(true);
    await screen.rerender(
      <PlannerHeader synchronized month="2027-09" viewMode="YEAR" plannerActive={false} />,
    );
    expect(screen.getByRole("header", { name: "2027" })).toHaveStyle({ height });
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
  it("fades and disables the view controls while quick planning is active", async () => {
    const screen = await render(<PlannerHeader />);
    const toolbar = screen.getByTestId("calendar-header-actions", {
      includeHiddenElements: true,
    });

    expect(toolbar.props.pointerEvents).toBe("none");
    expect(toolbar.props.accessibilityElementsHidden).toBe(true);
    expect(toolbar.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(StyleSheet.flatten(toolbar.props.style).opacity).toBe(0);
    expect(screen.getByRole("header", { name: "August" })).toHaveProp(
      "dynamicTypeRamp",
      "largeTitle",
    );
    expect(
      screen.getByRole("button", {
        name: "2026, Jahresansicht öffnen",
        includeHiddenElements: true,
      }),
    ).toHaveStyle({ width: 48, height: 44 });
  });

  it("uses complete eight-point title swaps in both time directions", async () => {
    const nextScreen = await render(<PlannerHeader direction="NEXT" />);
    const nextTitle = nextScreen.getByRole("header", { name: "August" });

    expect(nextTitle.props.entering.durationV).toBe(MOTION.duration.normal);
    expect(nextTitle.props.entering.initialValues).toMatchObject({ translateY: 8 });
    expect(nextTitle.props.exiting.durationV).toBe(MOTION.duration.normal);
    expect(nextTitle.props.exiting.targetValues).toMatchObject({ translateY: -8 });
    await nextScreen.unmount();

    const previousScreen = await render(<PlannerHeader direction="PREVIOUS" />);
    const previousTitle = previousScreen.getByRole("header", { name: "August" });

    expect(previousTitle.props.entering.initialValues).toMatchObject({ translateY: -8 });
    expect(previousTitle.props.exiting.targetValues).toMatchObject({ translateY: 8 });
  });

  it.each([false, true])(
    "keeps the year accent through a transform-free crossfade (dark=%s)",
    async (dark) => {
      const scheme = jest
        .spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useColorScheme")
        .mockReturnValue(dark ? "dark" : "light");
      try {
        const screen = await render(
          <PlannerHeader month="2026-08" titleTransition="CROSSFADE" viewMode="YEAR" />,
        );
        const title = screen.getByRole("header", { name: "2026" });

        expect(title.props.entering.durationV).toBe(CALENDAR_VIEW_ZOOM.duration);
        expect(title).toHaveStyle({
          color: (dark ? DARK_PALETTE : LIGHT_PALETTE).calendarYearAccent,
        });
        expect(title.props.entering.initialValues).toBeUndefined();
        expect(title.props.exiting.durationV).toBe(MOTION.duration.normal);
        expect(title.props.exiting.targetValues).toBeUndefined();
      } finally {
        scheme.mockRestore();
      }
    },
  );

  it("keeps the current year quiet and shows other years for orientation", async () => {
    const current = await render(<PlannerHeader month="2026-08" referenceMonth="2026-09" />);
    expect(current.getByRole("header", { name: "August" })).toBeTruthy();
    await current.unmount();

    for (const year of ["2025", "2027"]) {
      const other = await render(<PlannerHeader month={`${year}-08`} referenceMonth="2026-09" />);
      expect(other.getByRole("header", { name: `August ${year}` })).toBeTruthy();
      await other.unmount();
    }
  });

  it("crossfades the mode controls without moving the header pill", async () => {
    const screen = await render(<PlannerHeader viewMode="YEAR" />);
    const controls = screen.getByTestId("calendar-header-mode-actions", {
      includeHiddenElements: true,
    });

    expect(controls.props.entering.durationV).toBe(CALENDAR_VIEW_ZOOM.duration);
    expect(controls.props.entering.initialValues).toBeUndefined();
    expect(controls.props.exiting.durationV).toBe(MOTION.duration.normal);
    expect(controls.props.exiting.targetValues).toBeUndefined();
  });
});
