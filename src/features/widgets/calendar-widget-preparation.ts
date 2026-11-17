/** Yield to native/input work; this is preparation in the app, not the isolated widget renderer. */
function pauseWidgetWork(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 50 });
    else setTimeout(resolve, 0);
  });
}

/** A step cannot be interrupted, so both elapsed time and a step count bound each turn. */
export async function prepareWidgetWork<T>(
  work: Generator<void, T>,
  {
    isCurrent,
    foreground = () => true,
    pause = pauseWidgetWork,
    clock = () => performance.now(),
    onSlice = (_duration: number) => {},
  }: {
    readonly isCurrent: () => boolean;
    readonly foreground?: () => boolean;
    readonly pause?: () => Promise<void>;
    readonly clock?: () => number;
    readonly onSlice?: (duration: number) => void;
  },
): Promise<T | null> {
  try {
    while (isCurrent()) {
      if (foreground()) await pause();
      if (!isCurrent()) return null;
      const started = clock();
      let steps = 0;
      try {
        do {
          if (!isCurrent()) return null;
          const next = work.next();
          if (next.done) return next.value;
          steps += 1;
        } while (!foreground() || (steps < 32 && clock() - started < 4));
      } finally {
        onSlice(Math.max(0, clock() - started));
      }
    }
    return null;
  } finally {
    work.return(undefined as never);
  }
}
