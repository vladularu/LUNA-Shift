import { Redirect } from "expo-router";

// Native widgets can retain old per-day links after an app update.
export function WidgetCalendarRedirect() {
  return <Redirect href="/" />;
}
