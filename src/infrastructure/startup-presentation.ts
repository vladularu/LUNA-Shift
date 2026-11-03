export const STARTUP_SPLASH_FADE_MS = 300;

/** One cold-start presentation barrier. Later navigation never re-arms it. */
export function createStartupPresentation() {
  let ready = true;
  let splashHidden = true;
  const listeners = new Set<() => void>();
  const splashListeners = new Set<() => void>();
  return {
    begin() {
      ready = false;
      splashHidden = false;
    },
    isReady: () => ready,
    complete() {
      if (ready) return;
      ready = true;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
    after(task: () => void) {
      if (ready) task();
      else listeners.add(task);
      return () => {
        listeners.delete(task);
      };
    },
    afterSplash(task: () => void) {
      if (splashHidden) task();
      else splashListeners.add(task);
      return () => {
        splashListeners.delete(task);
      };
    },
    finishSplash() {
      if (splashHidden) return;
      splashHidden = true;
      for (const listener of [...splashListeners]) listener();
      splashListeners.clear();
    },
    wait(): Promise<void> {
      return ready ? Promise.resolve() : new Promise((resolve) => listeners.add(resolve));
    },
  };
}

export const startupPresentation = createStartupPresentation();

export async function hideStartupSplash(
  hide: () => Promise<void>,
  startup = startupPresentation,
): Promise<void> {
  try {
    await hide();
  } catch {
    // A missing splash must not prevent the saved native appearance from applying.
  }
  // hideAsync resolves before UIKit's cross-dissolve finishes. Keep the launch
  // storyboard in its initial system appearance throughout that animation.
  setTimeout(() => requestAnimationFrame(() => startup.finishSplash()), STARTUP_SPLASH_FADE_MS);
}
