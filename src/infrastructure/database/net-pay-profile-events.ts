import type { SQLiteDatabase } from "expo-sqlite";

const listeners = new WeakMap<SQLiteDatabase, Set<() => void>>();
/** Publish only after the keyed connection's transaction committed successfully. */
export function netPayProfilesChanged(db: SQLiteDatabase) {
  for (const listener of [...(listeners.get(db) ?? [])]) {
    try {
      listener();
    } catch {
      /* A derived subscriber cannot undo a committed settings write. */
    }
  }
}
export function subscribeNetPayProfiles(db: SQLiteDatabase, listener: () => void) {
  const current = listeners.get(db) ?? new Set<() => void>();
  listeners.set(db, current);
  current.add(listener);
  return () => {
    current.delete(listener);
  };
}
