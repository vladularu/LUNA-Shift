/** Keep synchronous widget publication out of an active calendar editing session. */
const listeners = new Set<() => void>();
let owners = 0;

export const calendarWidgetDeferral = {
  getSnapshot: () => owners > 0,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  begin() {
    owners += 1;
    if (owners === 1) for (const listener of listeners) listener();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      owners -= 1;
      if (owners === 0) for (const listener of listeners) listener();
    };
  },
};
