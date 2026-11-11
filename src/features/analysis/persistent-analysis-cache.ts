import { serializeRuleResolverForCache, type RuleResolver } from "@/rules/rule-resolver";
import { calendarPerformance } from "@/application/calendar-performance";
import { decodeAnalysisCacheValue, encodeAnalysisCacheValue } from "./analysis-cache-codec";
import { measureAnalysisCache } from "./analysis-cache-performance";
import {
  MAX_ANALYSIS_RESULT_CHARACTERS,
  MAX_ANALYSIS_RESULT_ROWS,
  type AnalysisResultKind,
  type AnalysisResultRepository,
} from "@/infrastructure/database/analysis-result-repository";

type Accept<T> = (value: unknown) => value is T;
let nextCacheInstance = 0;
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
  const instance = ++nextCacheInstance;
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
      let fingerprint: number | undefined;
      const phases = measureAnalysisCache(kind, month);
      const finish = calendarPerformance.span("analysis-cache", {
        instance,
        month: Number(month.replace("-", "")),
        stage: kind === "month" ? 1 : kind === "checks" ? 2 : kind === "annual" ? 4 : 3,
      });
      try {
        return await Promise.race([
          (async () => {
            phases.next(1);
            const hash = await requestHash(kind, month, key, resolver);
            if (hash === null) {
              state = 2;
              return null;
            }
            fingerprint = Number.parseInt(hash.slice(0, 8), 16);
            phases.next(2);
            const saved = await repository.read(kind, month, hash);
            if (!saved) {
              state = 3;
              return null;
            }
            phases.next(10);
            if (
              saved.payload.length > MAX_ANALYSIS_RESULT_CHARACTERS ||
              (await sha256(saved.payload)) !== saved.digest
            ) {
              state = 4;
              return null;
            }
            phases.next(3);
            const value = decodeAnalysisCacheValue(saved.payload);
            phases.next(4);
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
        phases.finish();
        finish({ state, cache: state === 1 ? 1 : 0, fingerprint });
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
      let reason = 0;
      let fingerprint: number | undefined;
      const phases = measureAnalysisCache(kind, month);
      const finish = calendarPerformance.span("analysis-cache", {
        instance,
        month: Number(month.replace("-", "")),
        stage: kind === "month" ? 1 : kind === "checks" ? 2 : kind === "annual" ? 4 : 3,
      });
      try {
        phases.next(5);
        if (!current()) {
          reason = 1;
          return;
        }
        if (!accept(value)) {
          reason = 2;
          return;
        }
        phases.next(6);
        const hash = await requestHash(kind, month, key, resolver);
        if (hash === null) {
          reason = 4;
          return;
        }
        fingerprint = Number.parseInt(hash.slice(0, 8), 16);
        if (!current()) {
          reason = 5;
          return;
        }
        phases.next(7);
        const payload = encodeAnalysisCacheValue(value);
        if (payload.length > MAX_ANALYSIS_RESULT_CHARACTERS) {
          reason = 3;
          return;
        }
        phases.next(8);
        const digest = await sha256(payload);
        if (current()) {
          phases.next(9);
          await repository.write(kind, month, hash, { payload, digest }, current);
          if (current()) state = 9;
          else reason = 5;
        } else reason = 5;
      } catch {
        state = 7;
        reason = 6;
        // Derived results are optional; normal computation and user data remain authoritative.
      } finally {
        phases.finish();
        finish({ state, reason, fingerprint });
      }
    },
  };
}
