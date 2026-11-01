import { useSQLiteContext } from "expo-sqlite";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  DEFAULT_SALARY_PAYMENT_PREFERENCES,
  type SalaryPaymentPreferences,
  type SalaryPerspective,
} from "@/domain/salary-payment";
import {
  loadSalaryPaymentPreferences,
  saveSalaryPaymentPreferences,
} from "@/infrastructure/database/salary-payment-repository";
import { recordDiagnostic } from "@/infrastructure/diagnostics";

interface SalaryPaymentState {
  readonly preferences: SalaryPaymentPreferences;
  readonly perspective: SalaryPerspective;
  readonly ready: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly setPerspective: (value: SalaryPerspective) => void;
  readonly save: (next: SalaryPaymentPreferences) => Promise<void>;
  readonly reload: () => Promise<void>;
}

const SalaryPaymentContext = createContext<SalaryPaymentState | null>(null);

/** Shared inputs only: salary calculations remain in the prepared-analysis pipeline. */
export function SalaryPaymentPreferencesProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [preferences, setPreferences] = useState(DEFAULT_SALARY_PAYMENT_PREFERENCES);
  const [perspective, setPerspective] = useState<SalaryPerspective>("PAYOUT");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(DEFAULT_SALARY_PAYMENT_PREFERENCES);
  const loaded = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const epoch = useRef(0);

  const reload = useCallback(async () => {
    if (busy.current) return;
    const version = ++epoch.current;
    try {
      const next = await loadSalaryPaymentPreferences(db);
      if (!mounted.current || version !== epoch.current) return;
      current.current = next;
      loaded.current = true;
      setPreferences(next);
      setReady(true);
      setError(null);
    } catch (cause) {
      recordDiagnostic("preferences", "SALARY_PAYMENT_LOAD_FAILED", cause);
      if (mounted.current && version === epoch.current)
        setError("Dein Zahlungsrhythmus konnte nicht geladen werden.");
    }
  }, [db]);

  useEffect(() => {
    mounted.current = true;
    loaded.current = false;
    setReady(false);
    void reload();
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, [reload]);

  const save = useCallback(
    async (next: SalaryPaymentPreferences) => {
      if (!loaded.current || busy.current)
        throw new Error("Bitte warte, bis der Zahlungsrhythmus bereit ist.");
      busy.current = true;
      const version = ++epoch.current;
      const expected = current.current;
      setSaving(true);
      setError(null);
      try {
        await saveSalaryPaymentPreferences(db, next, expected);
        if (!mounted.current || version !== epoch.current) return;
        current.current = next;
        setPreferences(next);
      } catch (cause) {
        recordDiagnostic("preferences", "SALARY_PAYMENT_SAVE_FAILED", cause);
        if (mounted.current && version === epoch.current)
          setError("Nicht gespeichert. Lade den Zahlungsrhythmus neu und prüfe deine Auswahl.");
        throw cause;
      } finally {
        busy.current = false;
        if (mounted.current && version === epoch.current) setSaving(false);
      }
    },
    [db],
  );

  const value = useMemo(
    () => ({ preferences, perspective, ready, saving, error, setPerspective, save, reload }),
    [preferences, perspective, ready, saving, error, save, reload],
  );
  return <SalaryPaymentContext value={value}>{children}</SalaryPaymentContext>;
}

export function useSalaryPaymentPreferences() {
  const value = useContext(SalaryPaymentContext);
  if (value === null) throw new Error("Der Zahlungsrhythmus ist hier nicht verfügbar.");
  return value;
}
