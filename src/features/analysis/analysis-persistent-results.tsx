import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSQLiteContext } from "expo-sqlite";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { updateId } from "expo-updates";
import { currentMonth } from "@/engine/calendar";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import {
  createPersistentAnalysisCache,
  type PersistentAnalysisCache,
} from "./persistent-analysis-cache";

const Results = createContext<PersistentAnalysisCache | null>(null);
export function AnalysisPersistentResultsProvider({
  children,
  timeZone,
}: {
  readonly children: ReactNode;
  readonly timeZone: string;
}) {
  const db = useSQLiteContext();
  const cache = useMemo(
    () =>
      typeof updateId !== "string" || updateId.length === 0
        ? null
        : createPersistentAnalysisCache({
            bundleId: updateId,
            repository: createAnalysisResultRepository(db, () => currentMonth(timeZone)),
            sha256: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
          }),
    [db, timeZone],
  );
  return <Results.Provider value={cache}>{children}</Results.Provider>;
}
export function useAnalysisPersistentResults() {
  return useContext(Results);
}
