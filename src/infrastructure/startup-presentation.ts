/** One cold-start presentation barrier. Later navigation never re-arms it. */
export function createStartupPresentation() {
  let ready = true;
  const listeners = new Set<() => void>();
  return {
    begin() {
      ready = false;
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
    wait(): Promise<void> {
      return ready ? Promise.resolve() : new Promise((resolve) => listeners.add(resolve));
    },
  };
}

export const startupPresentation = createStartupPresentation();
