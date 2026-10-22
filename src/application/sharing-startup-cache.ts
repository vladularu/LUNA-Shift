import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import type { SharingAuthPort, SharingAuthUser } from "@/domain/calendar-sharing-ports";

export interface SharingStartupDisplay {
  readonly accountId: string | null;
  readonly calendars: readonly CachedSharedCalendar[];
}

/** Read-only presentation prefetch. Never activates an account or authorizes cloud work. */
export function createSharingStartupCache(
  auth: Pick<SharingAuthPort, "isConfigured" | "getCachedSession" | "subscribe">,
  readCaches: (accountId: string) => Promise<readonly CachedSharedCalendar[]>,
) {
  let revision = 0;
  let observed: SharingAuthUser | null | undefined;
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let pending: Promise<SharingStartupDisplay & { revision: number }> | null = null;
  async function read() {
    for (;;) {
      const ticket = revision;
      if (stopped || !auth.isConfigured) return { accountId: null, calendars: [], revision };
      const user =
        observed !== undefined ? observed : await auth.getCachedSession?.().catch(() => null);
      if (ticket !== revision) continue;
      observed = user ?? null;
      let calendars: readonly CachedSharedCalendar[];
      try {
        calendars = user ? await readCaches(user.id) : [];
      } catch (error) {
        if (ticket !== revision) continue;
        throw error;
      }
      if (ticket === revision) return { accountId: user?.id ?? null, calendars, revision };
    }
  }
  return {
    start() {
      if (unsubscribe || !auth.isConfigured) return;
      stopped = false;
      unsubscribe = auth.subscribe((next) => {
        if (observed === undefined || observed?.id !== next?.id) ++revision;
        observed = next;
      });
      pending = read();
      // The consumer still receives a storage failure; an early failure is not unhandled.
      void pending.catch(() => {});
    },
    async take(): Promise<SharingStartupDisplay> {
      const initial = pending;
      pending = null;
      let value = await (initial ?? read());
      if (value.revision !== revision) value = await read();
      return { accountId: value.accountId, calendars: value.calendars };
    },
    stop() {
      stopped = true;
      ++revision;
      observed = undefined;
      pending = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

export type SharingStartupCache = ReturnType<typeof createSharingStartupCache>;
