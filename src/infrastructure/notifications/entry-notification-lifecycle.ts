import type { SQLiteDatabase } from "expo-sqlite";

type State = { generation: number; pauses: number; writes: Set<Promise<void>> };
const states = new WeakMap<SQLiteDatabase, State>();
function stateFor(db: SQLiteDatabase): State {
  let state = states.get(db);
  if (!state) {
    state = { generation: 0, pauses: 0, writes: new Set() };
    states.set(db, state);
  }
  return state;
}

export function captureEntryNotificationGeneration(db: SQLiteDatabase): () => boolean {
  const state = stateFor(db);
  const generation = state.generation;
  const permitted = state.pauses === 0;
  return () => permitted && state.pauses === 0 && state.generation === generation;
}

export function pauseEntryNotifications(db: SQLiteDatabase): () => void {
  const state = stateFor(db);
  state.generation++;
  state.pauses++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.pauses--;
  };
}

export async function invalidateEntryNotifications(db: SQLiteDatabase): Promise<void> {
  const state = stateFor(db);
  state.generation++;
  // These are bare SQL writes, never tasks waiting for the transaction queue.
  // Do not wait for permission dialogs or pending native scheduling calls.
  await Promise.allSettled([...state.writes]);
}

export async function writeEntryNotificationSchedule(
  db: SQLiteDatabase,
  isCurrent: () => boolean,
  write: () => Promise<void>,
): Promise<void> {
  if (!isCurrent()) return;
  const state = stateFor(db);
  const pending = write();
  state.writes.add(pending);
  try {
    await pending;
  } finally {
    state.writes.delete(pending);
  }
}
