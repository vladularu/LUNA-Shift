import { WorkplaceHistoryContext } from "@/application/working-time-provider";
import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  WORKPLACE_RULES_KEY,
  dataSchema,
  emptyWorkplaceData,
  type WorkplaceData,
} from "@/domain/workplace-rules";
import { withImmediateTransaction } from "@/infrastructure/database/transaction";

export async function readWorkplaceData(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_preferences WHERE key=?",
    WORKPLACE_RULES_KEY,
  );
  return row ? dataSchema.parse(JSON.parse(row.value)) : emptyWorkplaceData;
}
export async function updateWorkplaceData(
  db: SQLiteDatabase,
  update: (current: WorkplaceData) => WorkplaceData,
) {
  return withImmediateTransaction(db, async (tx) => {
    const next = dataSchema.parse(update(await readWorkplaceData(tx)));
    await tx.runAsync(
      "INSERT INTO app_preferences(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      WORKPLACE_RULES_KEY,
      JSON.stringify(next),
      new Date().toISOString(),
    );
    return next;
  });
}
const listeners = new WeakMap<SQLiteDatabase, Set<() => void>>();
export const WorkplaceDatabase = createContext<SQLiteDatabase | null>(null);
export const WorkplaceDataContext = createContext<WorkplaceData | null>(null);
export function WorkplaceCalculationSettings({ children }: PropsWithChildren) {
  const { data } = useWorkplaceData();
  return (
    <WorkplaceHistoryContext.Provider value={data?.history}>
      <WorkplaceDataContext.Provider value={data}>{children}</WorkplaceDataContext.Provider>
    </WorkplaceHistoryContext.Provider>
  );
}
export function useWorkplaceData() {
  const db = useContext(WorkplaceDatabase);
  const [data, setData] = useState<WorkplaceData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!db) return;
    let active = true;
    readWorkplaceData(db).then(
      (value) => {
        if (active) {
          setData(value);
          setError("");
        }
      },
      () => {
        if (active) setError("Die Betriebsregeln konnten nicht geladen werden.");
      },
    );
    const subscribed = listeners.get(db) ?? new Set<() => void>();
    listeners.set(db, subscribed);
    const refresh = () => {
      active = false;
      setRevision((v) => v + 1);
    };
    subscribed.add(refresh);
    return () => {
      active = false;
      subscribed.delete(refresh);
    };
  }, [db, revision]);
  const save = useCallback(
    async (update: (previous: WorkplaceData) => WorkplaceData) => {
      if (!db) throw new Error("Datenbank wird geöffnet.");
      const next = await updateWorkplaceData(db, update);
      listeners.get(db)?.forEach((refresh) => refresh());
      setData(next);
    },
    [db],
  );
  return { available: !!db, data, error, save, retry: () => setRevision((v) => v + 1) };
}
