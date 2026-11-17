const separatePresentations = new Set([
  "(tabs)",
  "quick-add",
  "day-editor",
  "shift-editor",
  "appointment-editor",
  "day-details",
  "info-details",
  "tariff-assessment",
  "check-issue",
  "shift-selection",
  "location-picker",
  "onboarding",
  "dev-tools",
]);

const options = Object.freeze({ gestureEnabled: true, fullScreenGestureEnabled: true });
// A hidden native bar can disable UIKit's edge recognizer. Use the content-pop
// recognizer, restricted to the edge so the photo slider keeps its horizontal touch area.
const calendarDesignOptions = Object.freeze({
  ...options,
  gestureResponseDistance: { start: 0, end: 32 },
});
const reportOptions = Object.freeze({ ...options, freezeOnBlur: true });
const reports = new Set([
  "salary",
  "salary-details",
  "worktime-details",
  "annual-details",
  "premium-details",
  "compliance-details",
]);

/** Include automatic card routes while preserving modal, vertical-editor and tab gestures. */
export function horizontalBackGestureOptions(routeName: string) {
  if (routeName === "calendar-design") return calendarDesignOptions;
  return separatePresentations.has(routeName)
    ? undefined
    : reports.has(routeName)
      ? reportOptions
      : options;
}
