import { serializeRuleResolverForCache, type RuleResolver } from "@/rules/rule-resolver";
import { calendarPerformance } from "@/application/calendar-performance";
import {
  MAX_ANALYSIS_RESULT_CHARACTERS,
  MAX_ANALYSIS_RESULT_ROWS,
  type AnalysisResultKind,
  type AnalysisResultRepository,
} from "@/infrastructure/database/analysis-result-repository";

type Accept<T> = (value: unknown) => value is T;
export interface PersistentAnalysisCache {
  claim?(kind: AnalysisResultKind, month: string): () => boolean;
  read<T>(
    kind: AnalysisResultKind,
    month: string,
    key: string,
    resolver: RuleResolver,
    accept: Accept<T>,
  ): Promise<T | null>;
  write<T>(
    kind: AnalysisResultKind,
    month: string,
    key: string,
    resolver: RuleResolver,
    value: T,
    accept: Accept<T>,
    current?: () => boolean,
  ): Promise<void>;
}

/** Cache trouble must never become a reporting failure or an unbounded loading state. */
export function createPersistentAnalysisCache({
  repository,
  sha256,
  bundleId,
  lookupTimeoutMs = 150,
}: {
  readonly repository: AnalysisResultRepository;
  readonly sha256: (text: string) => Promise<string>;
  readonly bundleId: string;
  readonly lookupTimeoutMs?: number;
}): PersistentAnalysisCache {
  const catalogs = new WeakMap<RuleResolver, Promise<string | null>>();
  const writers = new Map<string, { active: boolean }>();
  const claim = (kind: AnalysisResultKind, month: string) => {
    const id = `${kind}:${month}`,
      previous = writers.get(id);
    if (previous) previous.active = false;
    const token = { active: true },
      current = repository.claim?.(kind, month);
    writers.delete(id);
    writers.set(id, token);
    if (writers.size > MAX_ANALYSIS_RESULT_ROWS) {
      const oldest = writers.keys().next().value!;
      writers.get(oldest)!.active = false;
      writers.delete(oldest);
    }
    return () => token.active && (current?.() ?? true);
  };
  async function requestHash(
    kind: AnalysisResultKind,
    month: string,
    key: string,
    resolver: RuleResolver,
  ) {
    if (!bundleId) return null;
    let catalog = catalogs.get(resolver);
    if (!catalog) {
      const source = serializeRuleResolverForCache(resolver);
      catalog = source === null ? Promise.resolve(null) : sha256(source);
      catalogs.set(resolver, catalog);
    }
    const catalogHash = await catalog;
    return catalogHash === null
      ? null
      : sha256(JSON.stringify([1, bundleId, catalogHash, kind, month, key]));
  }
  return {
    claim,
    async read<T>(
      kind: AnalysisResultKind,
      month: string,
      key: string,
      resolver: RuleResolver,
      accept: Accept<T>,
    ) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let state = 0;
      const finish = calendarPerformance.span("analysis-cache", {
        month: Number(month.replace("-", "")),
        stage: kind === "month" ? 1 : kind === "checks" ? 2 : 3,
      });
      try {
        return await Promise.race([
          (async () => {
            const hash = await requestHash(kind, month, key, resolver);
            if (hash === null) {
              state = 2;
              return null;
            }
            const saved = await repository.read(kind, month, hash);
            if (!saved) {
              state = 3;
              return null;
            }
            if (
              saved.payload.length > MAX_ANALYSIS_RESULT_CHARACTERS ||
              (await sha256(saved.payload)) !== saved.digest
            ) {
              state = 4;
              return null;
            }
            const value: unknown = JSON.parse(saved.payload);
            const accepted = accept(value);
            state = accepted ? 1 : 5;
            return accepted ? value : null;
          })(),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              state = 6;
              resolve(null);
            }, lookupTimeoutMs);
          }),
        ]);
      } catch {
        state = 7;
        return null;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        finish({ state, cache: state === 1 ? 1 : 0 });
      }
    },
    async write<T>(
      kind: AnalysisResultKind,
      month: string,
      key: string,
      resolver: RuleResolver,
      value: T,
      accept: Accept<T>,
      current = claim(kind, month),
    ) {
      let state = 8;
      const finish = calendarPerformance.span("analysis-cache", {
        month: Number(month.replace("-", "")),
        stage: kind === "month" ? 1 : kind === "checks" ? 2 : 3,
      });
      try {
        if (!current() || !accept(value)) return;
        const hash = await requestHash(kind, month, key, resolver);
        if (hash === null || !current()) return;
        const payload = JSON.stringify(value, (_key, child: unknown) => {
          if (typeof child === "number" && !Number.isFinite(child))
            throw new Error("Non-finite cache value");
          return child;
        });
        if (payload.length > MAX_ANALYSIS_RESULT_CHARACTERS) return;
        const digest = await sha256(payload);
        if (current()) {
          await repository.write(kind, month, hash, { payload, digest }, current);
          if (current()) state = 9;
        }
      } catch {
        state = 7;
        // Derived results are optional; normal computation and user data remain authoritative.
      } finally {
        finish({ state });
      }
    },
  };
}
