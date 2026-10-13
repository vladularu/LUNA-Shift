import Constants from "expo-constants";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

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
  const { ready, error } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { templates } = usePflegeShiftTemplates();
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeZone = profile?.timeZone ?? "Europe/Berlin";
    const configuredScheme = Constants.expoConfig?.scheme;
    const scheme =
      (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) ?? "pflegeshift";
    async function refresh() {
      const revision = ++sequence.current;
      try {
        const now = new Date();
        const range = widgetEntryRange(now, timeZone);
        // Provider entries may belong to a different year; query today's own range.
        const loaded =
          profile === null
            ? []
            : await ports.repository.listCalendarEntries(range.startDate, range.endDate);
        if (!active || revision !== sequence.current) return;
        // Serialize photo-copy + publication so an older pending photo cannot
        // overwrite or remove a newer snapshot during rapid settings changes.
        const publication = publicationQueue.current.then(async () => {
          if (!active || revision !== sequence.current) return;
          let backgroundFileName: string | null = null;
          try {
            backgroundFileName = await prepareCalendarWidgetBackground(
              profile ? background.uri : null,
            );
          } catch (cause) {
            if (active && revision === sequence.current)
              ports.diagnostics.record("provider", "CALENDAR_WIDGET_BACKGROUND_FAILED", cause);
          }
          if (!active || revision !== sequence.current) return;
          const publishedAt = new Date();
          const currentRange = widgetEntryRange(publishedAt, timeZone);
          if (
            currentRange.startDate !== range.startDate ||
            currentRange.endDate !== range.endDate
          ) {
            void refresh();
            return;
          }
          publishCalendarWidgetTimeline(
            buildCalendarWidgetTimeline({
              entries: loaded,
              now: publishedAt,
              timeZone,
              scheme,
              hasProfile: profile !== null,
              display: {
                labelMode: display.labelMode,
                showShiftTimes: display.showShiftTimes,
                showShiftDuration: display.showShiftDuration,
                showShifts: display.showShifts,
              },
              themeMode: appearance.mode,
              backgroundFileName,
              backgroundStrength: background.strength,
            }),
          );
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
    void refresh();
    schedule();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
        schedule();
      }
    });
    return () => {
      active = false;
      sequence.current += 1;
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, [
    ports,
    ready,
    error,
    profile,
    entries,
    templates,
    display.ready,
    display.labelMode,
    display.showShiftTimes,
    display.showShiftDuration,
    display.showShifts,
    background.ready,
    background.uri,
    background.strength,
    appearance.ready,
    appearance.mode,
  ]);
  return null;
}
