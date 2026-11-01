import {
  bundledRuleResolver,
  createRuleResolverFromCatalog,
  type RuleResolver,
} from "@/rules/rule-resolver";
import type { ValidatedRuleCatalog } from "@/rules/validation";
import {
  APP_HISTORICAL_RULE_CATALOG,
  EMBEDDED_REVIEWED_PREVIEW_GENERATION,
  embeddedReviewedRuleResolver,
} from "@/rules/embedded-reviewed-rules";

export type RuleCatalogFallbackReason =
  "NO_STORED_CATALOG" | "ACTIVE_GENERATION_INVALID" | "NO_VALID_STORED_CATALOG";

export interface StoredRuleCatalogSnapshot {
  readonly activeGeneration: number;
  readonly generation: number;
  readonly recoveredFromGeneration: number | null;
  readonly catalog: ValidatedRuleCatalog;
}

export interface RuleCatalogRuntimeDiagnosis {
  readonly source: "STORED" | "LEGACY_EMBEDDED" | "APP_EMBEDDED";
  readonly embeddedPreviewGeneration?: number;
  readonly activeGeneration: number | null;
  readonly selectedGeneration: number | null;
  readonly keyId: string | null;
  readonly fallbackReason: RuleCatalogFallbackReason | null;
}

export interface RuleCatalogRuntimeSnapshot {
  readonly resolver: RuleResolver;
  readonly diagnosis: RuleCatalogRuntimeDiagnosis;
}

export interface RuleCatalogRuntimeLoadResult {
  readonly runtime: RuleCatalogRuntimeSnapshot;
  readonly loadError: unknown | null;
}

export type LoadStoredRuleCatalog = () => Promise<StoredRuleCatalogSnapshot | null>;

function freezeRuntime(
  resolver: RuleResolver,
  diagnosis: RuleCatalogRuntimeDiagnosis,
): RuleCatalogRuntimeSnapshot {
  return Object.freeze({ resolver, diagnosis: Object.freeze(diagnosis) });
}

function activeGenerationFrom(error: unknown): number | null {
  if (error === null || typeof error !== "object") return null;
  const value = Reflect.get(error, "activeGeneration");
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export function legacyRuleCatalogRuntime(
  fallbackReason: RuleCatalogFallbackReason,
  activeGeneration: number | null = null,
): RuleCatalogRuntimeSnapshot {
  return freezeRuntime(bundledRuleResolver, {
    source: "LEGACY_EMBEDDED",
    activeGeneration,
    selectedGeneration: null,
    keyId: null,
    fallbackReason,
  });
}

export function storedRuleCatalogRuntime(
  stored: StoredRuleCatalogSnapshot,
): RuleCatalogRuntimeSnapshot {
  return freezeRuntime(createRuleResolverFromCatalog(stored.catalog, APP_HISTORICAL_RULE_CATALOG), {
    source: "STORED",
    activeGeneration: stored.activeGeneration,
    selectedGeneration: stored.generation,
    keyId: stored.catalog.manifest.signing.keyId,
    fallbackReason: stored.recoveredFromGeneration === null ? null : "ACTIVE_GENERATION_INVALID",
  });
}

export function embeddedRuleCatalogRuntime(
  fallbackReason: RuleCatalogFallbackReason | null,
  activeGeneration: number | null = null,
): RuleCatalogRuntimeSnapshot {
  return freezeRuntime(embeddedReviewedRuleResolver, {
    source: "APP_EMBEDDED",
    embeddedPreviewGeneration: EMBEDDED_REVIEWED_PREVIEW_GENERATION,
    activeGeneration,
    selectedGeneration: null,
    keyId: null,
    fallbackReason,
  });
}

export async function loadRuleCatalogRuntime(
  loadStoredCatalog: LoadStoredRuleCatalog,
): Promise<RuleCatalogRuntimeLoadResult> {
  let observedActiveGeneration: number | null = null;
  try {
    const stored = await loadStoredCatalog();
    observedActiveGeneration = stored?.activeGeneration ?? null;
    const storedRuntime = stored === null ? null : storedRuleCatalogRuntime(stored);
    return Object.freeze({
      runtime:
        stored === null
          ? embeddedRuleCatalogRuntime("NO_STORED_CATALOG")
          : stored.catalog.manifest.channel === "PREVIEW" &&
              stored.generation <= EMBEDDED_REVIEWED_PREVIEW_GENERATION
            ? embeddedRuleCatalogRuntime(
                stored.recoveredFromGeneration === null ? null : "ACTIVE_GENERATION_INVALID",
                stored.activeGeneration,
              )
            : storedRuntime!,
      loadError: null,
    });
  } catch (loadError) {
    return Object.freeze({
      runtime: embeddedRuleCatalogRuntime(
        "NO_VALID_STORED_CATALOG",
        activeGenerationFrom(loadError) ?? observedActiveGeneration,
      ),
      loadError,
    });
  }
}
