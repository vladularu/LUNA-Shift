const separatePresentations = new Set([
  "(tabs)",
  "quick-add",
  "day-editor",
  "shift-editor",
  "appointment-editor",
  "day-details",
  "info-details",
  "tariff-assessment",
  "shift-selection",
  "location-picker",
  "onboarding",
  "dev-tools",
]);

const options = Object.freeze({ gestureEnabled: true, fullScreenGestureEnabled: true });
const periodOptions = Object.freeze({
  ...options,
  fullScreenGestureEnabled: false,
  freezeOnBlur: true,
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
  return separatePresentations.has(routeName)
    ? undefined
    : routeName === "salary" || routeName === "salary-details"
      ? periodOptions
      : reports.has(routeName)
        ? reportOptions
        : options;
}
