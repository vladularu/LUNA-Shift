import type { CachedSharedCalendar } from "@/domain/calendar-sharing";

type Choice = { visible: boolean; saved: boolean; revision: number; tail: Promise<void> };

/** Local display choices must not wait behind the network worker. */
export function createSharingLocalVisibility(port: {
  actor(): { ticket: number; accountId: string };
  check(ticket: number, accountId: string): void;
  read(): readonly CachedSharedCalendar[];
  changed(): void;
  save(accountId: string, calendarId: string, visible: boolean): Promise<void>;
}) {
  const choices = new Map<string, Choice>();
  const writes = new Set<Promise<void>>();
  return {
    clear: () => choices.clear(),
    settled: () => Promise.all(writes),
    remove: (calendarId: string) => choices.delete(calendarId),
    apply(items: readonly CachedSharedCalendar[]) {
      return items.map((item) => {
        const choice = choices.get(item.calendar.id);
        return choice && choice.visible !== item.visible
          ? { ...item, visible: choice.visible }
          : item;
      });
    },
    async set(calendarId: string, visible: boolean) {
      const { ticket, accountId } = port.actor();
      port.check(ticket, accountId);
      const cached = port
        .read()
        .find((item) => item.accountId === accountId && item.calendar.id === calendarId);
      if (!cached) throw new Error("SHARE_NOT_FOUND");
      let choice = choices.get(calendarId);
      if (!choice) {
        choice = {
          visible: cached.visible,
          saved: cached.visible,
          revision: 0,
          tail: Promise.resolve(),
        };
        choices.set(calendarId, choice);
      }
      const current = choice;
      const revision = ++current.revision;
      current.visible = visible;
      port.changed();
      const check = () => {
        port.check(ticket, accountId);
        if (choices.get(calendarId) !== current) throw new Error("SHARE_NOT_FOUND");
      };
      const task = current.tail
        .then(async () => {
          check();
          await port.save(accountId, calendarId, visible);
          check();
          current.saved = visible;
        })
        .catch((error: unknown) => {
          check();
          if (current.revision === revision) {
            current.visible = current.saved;
            port.changed();
          }
          throw error;
        });
      current.tail = task.catch(() => {});
      const settled = current.tail;
      writes.add(settled);
      void settled.then(() => writes.delete(settled));
      await task;
    },
  };
}

/** SQLite parses JSON anew. Reuse immutable data only when all its values agree. */
export function retainSharingCaches(
  previous: readonly CachedSharedCalendar[],
  incoming: readonly CachedSharedCalendar[],
): readonly CachedSharedCalendar[] {
  const byId = new Map(previous.map((item) => [item.calendar.id, item]));
  return incoming.map((item) => {
    const old = byId.get(item.calendar.id);
    if (!old || old.accountId !== item.accountId) return item;
    const entries =
      JSON.stringify(old.entries) === JSON.stringify(item.entries) ? old.entries : item.entries;
    const calendar =
      JSON.stringify(old.calendar) === JSON.stringify(item.calendar) ? old.calendar : item.calendar;
    return entries === old.entries &&
      calendar === old.calendar &&
      old.visible === item.visible &&
      old.localColor === item.localColor &&
      old.fetchedAt === item.fetchedAt
      ? old
      : { ...item, entries, calendar };
  });
}
