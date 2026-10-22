import { useEffect } from "react";
import { useSegments } from "expo-router";
import { startupPresentation } from "@/infrastructure/startup-presentation";

export function StartupRoutePresentation() {
  const segments: readonly string[] = useSegments();
  useEffect(() => {
    // The calendar releases after its pager is positioned. Other entry routes
    // (onboarding, invitations, widgets, settings) must remain independently usable.
    if (segments.length === 0 || segments[0] === "index") return;
    if (segments[0] === "(tabs)" && (segments.length < 2 || segments[1] === "(calendar)")) return;
    const frame = requestAnimationFrame(() => startupPresentation.complete());
    return () => cancelAnimationFrame(frame);
  }, [segments]);
  return null;
}
