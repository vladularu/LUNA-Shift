import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSQLiteContext } from "expo-sqlite";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { currentMonth } from "@/engine/calendar";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import {
  createPersistentAnalysisCache,
  type PersistentAnalysisCache,
} from "./persistent-analysis-cache";
import { measureAnalysisCache } from "./analysis-cache-performance";
import { ANALYSIS_RESULT_CALCULATION_VERSION } from "./analysis-cache-version.generated";
import {
  observeAnnualCacheRead,
  observeAnnualMonthCache,
} from "@/composition/analysis-cache-diagnostics";

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
      observeAnnualMonthCache(
        createPersistentAnalysisCache({
          bundleId: ANALYSIS_RESULT_CALCULATION_VERSION,
          repository: createAnalysisResultRepository(
            db,
            () => currentMonth(timeZone),
            measureAnalysisCache,
            observeAnnualCacheRead,
          ),
          sha256: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
        }),
      ),
    [db, timeZone],
  );
  return <Results.Provider value={cache}>{children}</Results.Provider>;
}
export function useAnalysisPersistentResults() {
  return useContext(Results);
}
