import { useEffect } from "react";
import { startupPresentation } from "@/infrastructure/startup-presentation";

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
