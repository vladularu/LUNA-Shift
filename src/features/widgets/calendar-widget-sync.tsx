import Constants from "expo-constants";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { widgetCalendarHighlights } from "./widget-calendar-highlights";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { calendarWidgetDeferral } from "@/application/calendar-widget-deferral";
import { calendarPerformance } from "@/application/calendar-performance";

import { useCalendarPreferences } from "@/features/calendar/calendar-preferences";
import { useCalendarBackground } from "@/features/settings/calendar-background-context";
import { useAppearancePreferences } from "@/features/settings/appearance-preferences";
import {
  prepareCalendarWidgetBackground,
  pruneCalendarWidgetBackgrounds,
} from "./calendar-widget-background";

import type { PflegeShiftPorts } from "@/application/pflegeshift-ports";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTemplates,
} from "@/application/pflegeshift-provider";
import {
  buildCalendarWidgetTimeline,
  nextWidgetMidnight,
  widgetEntryRange,
} from "./calendar-widget-data";
import { calendarWidgetsAvailable, publishCalendarWidgetTimeline } from "./native-calendar-widget";

export function CalendarWidgetSync({ ports }: { readonly ports: PflegeShiftPorts }) {
  // Unsupported binaries/platforms do not depend on display providers or photos.
  if (!calendarWidgetsAvailable()) return null;
  return <SupportedCalendarWidgetSync ports={ports} />;
}

function SupportedCalendarWidgetSync({ ports }: { readonly ports: PflegeShiftPorts }) {
  const deferred = useSyncExternalStore(
    calendarWidgetDeferral.subscribe,
    calendarWidgetDeferral.getSnapshot,
    calendarWidgetDeferral.getSnapshot,
  );
  const { ready, error } = usePflegeShiftStatus();
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { resolver } = useRuleCatalogRuntime();
  const { entries } = usePflegeShiftEntries();
  const { templates } = usePflegeShiftTemplates();
  const sharedCalendars = useVisibleSharedCalendars();
  const sequence = useRef(0);
  const publicationQueue = useRef<Promise<void>>(Promise.resolve());
  const display = useCalendarPreferences();
  const background = useCalendarBackground();
  const appearance = useAppearancePreferences();

  useEffect(() => {
    if (
      !calendarWidgetsAvailable() ||
      !ready ||
      error !== null ||
      !display.ready ||
      !background.ready ||
      !appearance.ready
    ) {
      sequence.current += 1;
      return;
    }
    let active = true;
    let appState = AppState.currentState;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeZone = profile?.timeZone ?? "Europe/Berlin";
    const configuredScheme = Constants.expoConfig?.scheme;
    const scheme =
      (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) ?? "pflegeshift";
    const shouldDefer = () => calendarWidgetDeferral.getSnapshot() && appState !== "background";
    async function refresh() {
      if (!active) return;
      if (shouldDefer()) {
        calendarPerformance.record("widget-work", { phase: 3 });
        return;
      }
      const revision = ++sequence.current;
      const isCurrent = () => active && revision === sequence.current && !shouldDefer();
      try {
        const now = new Date();
        const range = widgetEntryRange(now, timeZone);
        // Provider entries may belong to a different year; query today's own range.
        const loaded =
          profile === null
            ? []
            : await ports.repository.listCalendarEntries(range.startDate, range.endDate);
        if (!isCurrent()) return;
        // Serialize photo-copy + publication so an older pending photo cannot
        // overwrite or remove a newer snapshot during rapid settings changes.
        const publication = publicationQueue.current.then(async () => {
          if (!isCurrent()) return;
          let backgroundFileName: string | null = null;
          try {
            backgroundFileName = await prepareCalendarWidgetBackground(
              profile ? background.uri : null,
            );
          } catch (cause) {
            if (active && revision === sequence.current)
              ports.diagnostics.record("provider", "CALENDAR_WIDGET_BACKGROUND_FAILED", cause);
          }
          if (!isCurrent()) return;
          const publishedAt = new Date();
          const currentRange = widgetEntryRange(publishedAt, timeZone);
          if (
            currentRange.startDate !== range.startDate ||
            currentRange.endDate !== range.endDate
          ) {
            void refresh();
            return;
          }
          let timeline: ReturnType<typeof buildCalendarWidgetTimeline>;
          const finishBuild = calendarPerformance.span("widget-work", {
            phase: 1,
            input: loaded.length,
          });
          try {
            timeline = buildCalendarWidgetTimeline({
              entries: loaded,
              sharedCalendars,
              now: publishedAt,
              timeZone,
              scheme,
              hasProfile: profile !== null,
              dayLabels:
                profile && display.showHolidays
                  ? widgetCalendarHighlights(currentRange, profile, resolver)
                  : undefined,
              display: {
                labelMode: display.labelMode,
                showShiftTimes: display.showShiftTimes,
                showShiftDuration: display.showShiftDuration,
                showShifts: display.showShifts,
                showAppointments: display.showAppointments,
                pastelColors: display.pastelColors,
                showHolidays: display.showHolidays,
                holidayColor: display.holidayColor,
              },
              themeMode: appearance.mode,
              backgroundFileName,
              backgroundStrength: background.strength,
            });
          } finally {
            finishBuild();
          }
          const finishPublish = calendarPerformance.span("widget-work", {
            phase: 2,
            count: timeline.length,
          });
          try {
            publishCalendarWidgetTimeline(timeline);
          } finally {
            finishPublish();
          }
          try {
            pruneCalendarWidgetBackgrounds(backgroundFileName);
          } catch (cause) {
            ports.diagnostics.record(
              "provider",
              "CALENDAR_WIDGET_BACKGROUND_CLEANUP_FAILED",
              cause,
            );
          }
        });
        publicationQueue.current = publication.catch(() => {});
        await publication;
      } catch (cause) {
        if (active && revision === sequence.current)
          ports.diagnostics.record("provider", "CALENDAR_WIDGET_SYNC_FAILED", cause);
      }
    }
    function schedule() {
      if (timer !== undefined) clearTimeout(timer);
      const now = new Date();
      timer = setTimeout(
        () => {
          void refresh();
          schedule();
        },
        Math.max(1000, nextWidgetMidnight(now, timeZone).getTime() - now.getTime() + 100),
      );
    }
    const cancelStartup = startupPresentation.after(() => {
      void refresh();
      schedule();
    });
    const subscription = AppState.addEventListener("change", (state) => {
      appState = state;
      if (state === "active") {
        if (!startupPresentation.isReady()) return;
        void refresh();
        schedule();
      } else if (state === "background" && startupPresentation.isReady()) {
        // A selected tool can remain active when the user goes Home. Publish
        // the saved state then, while foreground taps no longer compete.
        void refresh();
      }
    });
    return () => {
      cancelStartup();
      active = false;
      sequence.current += 1;
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, [
    ports,
    deferred,
    ready,
    error,
    profile,
    resolver,
    entries,
    templates,
    sharedCalendars,
    display.ready,
    display.labelMode,
    display.showShiftTimes,
    display.showShiftDuration,
    display.showShifts,
    display.showAppointments,
    display.pastelColors,
    display.showHolidays,
    display.holidayColor,
    background.ready,
    background.uri,
    background.strength,
    appearance.ready,
    appearance.mode,
  ]);
  return null;
}
