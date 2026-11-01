import { Temporal } from "@js-temporal/polyfill";

import type {
  RuleHolidayPackage,
  RuleLegalPackage,
  RuleManifest,
  RulePackage,
  RuleTariffPackage,
} from "./contracts.generated";
import type { ValidatedRuleCatalog } from "./validation";
import { canonicalizeRuleJson } from "./rule-catalog-verification";
import {
  BUNDLED_HOLIDAY_RULES,
  BUNDLED_LEGAL_RULES,
  BUNDLED_TARIFF_RULES,
  LEGACY_RULE_PACKAGE_IDS,
} from "./bundled-rules";

export type RuleResolutionErrorCode =
  "INVALID_EFFECTIVE_DATE" | "RULE_PACKAGE_NOT_FOUND" | "RULE_PACKAGE_AMBIGUOUS";

export interface RuleResolutionFailure {
  readonly code: RuleResolutionErrorCode;
  readonly kind: RulePackage["kind"];
  readonly packageId: string;
  readonly effectiveDate: string;
  readonly message: string;
}

export type RuleResolution<T extends RulePackage> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RuleResolutionFailure };

export interface RuleResolverCatalog {
  readonly tariff: readonly RuleTariffPackage[];
  readonly legal: readonly RuleLegalPackage[];
  readonly holiday: readonly RuleHolidayPackage[];
}

export interface RuleResolverPackageIds {
  readonly tariff: string;
  readonly legal: string;
  readonly holiday: string;
}

export interface RuleResolverHistoricalCatalog {
  readonly catalog: RuleResolverCatalog;
  readonly packageIds: RuleResolverPackageIds;
  readonly compatiblePackageIds: RuleResolverPackageIds;
  /** Fixed end of historical fallback; a later catalog must never move it forward. */
  readonly validBefore: RuleResolverPackageIds;
}

interface HistoricalDefault {
  readonly beforeDate: string;
  readonly packageId: string;
}

export interface SimpleTariffData {
  readonly tables: NonNullable<RuleTariffPackage["rules"]["simpleTariffTables"]>["tables"];
  readonly sources: RuleTariffPackage["sources"];
}

export interface RuleResolver {
  readonly simpleTariffData?: SimpleTariffData;
  /** Optional for legacy custom adapters; absence never authorizes a fallback. */
  readonly tariffPackageIds?: readonly string[];
  readonly annualTariffCandidates?: (
    packageId: string,
    year: number,
  ) => readonly RuleTariffPackage[];
  readonly resolveTariff: (
    effectiveDate: string,
    packageId?: string,
  ) => RuleResolution<RuleTariffPackage>;
  readonly resolveLegal: (effectiveDate: string) => RuleResolution<RuleLegalPackage>;
  readonly resolveHoliday: (effectiveDate: string) => RuleResolution<RuleHolidayPackage>;
}

export class RuleResolutionError extends Error {
  readonly failure: RuleResolutionFailure;

  constructor(failure: RuleResolutionFailure) {
    super(failure.message);
    this.name = "RuleResolutionError";
    this.failure = failure;
  }
}

export class RuleCatalogCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleCatalogCompatibilityError";
  }
}

export const BUNDLED_RULE_CATALOG: RuleResolverCatalog = Object.freeze({
  tariff: BUNDLED_TARIFF_RULES,
  legal: BUNDLED_LEGAL_RULES,
  holiday: BUNDLED_HOLIDAY_RULES,
});

function packageIdsFromManifest(manifest: RuleManifest): RuleResolverPackageIds | null {
  const { tracks } = manifest;
  const packageIdFor = (kind: RulePackage["kind"]): string | null => {
    const matches = tracks.filter((track) => track.kind === kind);
    return matches.length === 1 ? matches[0].packageId : null;
  };
  const tariff =
    manifest.schemaVersion === 2
      ? (manifest.legacyTariffPackageId ?? null)
      : packageIdFor("TARIFF");
  if (tracks.filter((track) => track.kind === "TARIFF" && track.packageId === tariff).length !== 1)
    return null;
  const legal = packageIdFor("LEGAL");
  const holiday = packageIdFor("HOLIDAY");
  return tariff !== null && legal !== null && holiday !== null
    ? Object.freeze({ tariff, legal, holiday })
    : null;
}

export function isRuleCatalogRuntimeCompatible(catalog: ValidatedRuleCatalog): boolean {
  return packageIdsFromManifest(catalog.manifest) !== null;
}

function isValidDate(value: string): boolean {
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
}

function resolvePackage<T extends RulePackage>(
  packages: readonly T[],
  kind: T["kind"],
  packageId: string,
  effectiveDate: string,
): RuleResolution<T> {
  if (!isValidDate(effectiveDate)) {
    return {
      ok: false,
      error: {
        code: "INVALID_EFFECTIVE_DATE",
        kind,
        packageId,
        effectiveDate,
        message: `Invalid effective date for ${packageId}: ${effectiveDate}.`,
      },
    };
  }

  const matches = packages.filter(
    (rulePackage) =>
      rulePackage.packageId === packageId &&
      rulePackage.validFrom <= effectiveDate &&
      (rulePackage.validTo === null || effectiveDate <= rulePackage.validTo),
  );
  if (matches.length === 1) return { ok: true, value: matches[0] };

  const code = matches.length === 0 ? "RULE_PACKAGE_NOT_FOUND" : "RULE_PACKAGE_AMBIGUOUS";
  return {
    ok: false,
    error: {
      code,
      kind,
      packageId,
      effectiveDate,
      message:
        matches.length === 0
          ? `No ${kind} package ${packageId} covers ${effectiveDate}.`
          : `Multiple ${kind} packages ${packageId} cover ${effectiveDate}.`,
    },
  };
}

const cacheSources = new WeakMap<RuleResolver, () => string>();

/** Only factory-owned resolvers have a reproducible identity across app processes. */
export function serializeRuleResolverForCache(resolver: RuleResolver): string | null {
  return cacheSources.get(resolver)?.() ?? null;
}

function historicalDefault(
  kind: keyof RuleResolverPackageIds,
  catalog: RuleResolverCatalog,
  packageIds: RuleResolverPackageIds,
  historical: RuleResolverHistoricalCatalog | undefined,
): HistoricalDefault | undefined {
  if (!historical || packageIds[kind] !== historical.compatiblePackageIds[kind]) return;
  const firstCurrentDate = catalog[kind]
    .filter((item) => item.packageId === packageIds[kind])
    .map((item) => item.validFrom)
    .sort()[0];
  if (
    !firstCurrentDate ||
    !historical.catalog[kind].some((item) => item.packageId === historical.packageIds[kind])
  )
    return;
  const beforeDate =
    firstCurrentDate < historical.validBefore[kind]
      ? firstCurrentDate
      : historical.validBefore[kind];
  return Object.freeze({ beforeDate, packageId: historical.packageIds[kind] });
}

function addHistoricalPackages<T extends RulePackage>(
  current: readonly T[],
  historical: readonly T[],
  selection: HistoricalDefault | undefined,
): readonly T[] {
  if (!selection) return current;
  const key = (item: T) => `${item.packageId}/${item.validFrom}/${item.versionId}`;
  const currentKeys = new Set(current.map(key));
  return Object.freeze(
    [
      ...current,
      ...historical.filter(
        (item) => item.packageId === selection.packageId && !currentKeys.has(key(item)),
      ),
    ].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)),
  );
}

function resolveWithHistory<T extends RulePackage>(
  packages: readonly T[],
  kind: T["kind"],
  defaultPackageId: string,
  requestedPackageId: string,
  effectiveDate: string,
  historical: HistoricalDefault | undefined,
): RuleResolution<T> {
  let selected = requestedPackageId;
  if (
    historical &&
    (requestedPackageId === defaultPackageId || requestedPackageId === historical.packageId)
  ) {
    selected =
      effectiveDate < historical.beforeDate && isValidDate(effectiveDate)
        ? historical.packageId
        : defaultPackageId;
  }
  return resolvePackage(packages, kind, selected, effectiveDate);
}

export function createRuleResolver(
  catalog: RuleResolverCatalog = BUNDLED_RULE_CATALOG,
  packageIds: RuleResolverPackageIds = LEGACY_RULE_PACKAGE_IDS,
  historical?: RuleResolverHistoricalCatalog,
): RuleResolver {
  const history = {
    tariff: historicalDefault("tariff", catalog, packageIds, historical),
    legal: historicalDefault("legal", catalog, packageIds, historical),
    holiday: historicalDefault("holiday", catalog, packageIds, historical),
  };
  const hasHistory = Object.values(history).some(Boolean);
  const source =
    historical && hasHistory
      ? {
          tariff: addHistoricalPackages(catalog.tariff, historical.catalog.tariff, history.tariff),
          legal: addHistoricalPackages(catalog.legal, historical.catalog.legal, history.legal),
          holiday: addHistoricalPackages(
            catalog.holiday,
            historical.catalog.holiday,
            history.holiday,
          ),
        }
      : catalog;
  // Every reviewed carrier contains a complete snapshot, including historical periods.
  const carrier = source.tariff
    .filter((item) => item.engineContractVersion === 19 && item.rules.simpleTariffTables)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  const resolver: RuleResolver = Object.freeze({
    ...(carrier
      ? {
          simpleTariffData: Object.freeze({
            tables: carrier.rules.simpleTariffTables!.tables,
            sources: carrier.sources,
          }),
        }
      : {}),
    tariffPackageIds: Object.freeze([...new Set(source.tariff.map((item) => item.packageId))]),
    annualTariffCandidates: (packageId: string, year: number) =>
      Object.freeze(
        Number.isInteger(year) && year >= 1900 && year <= 4099
          ? source.tariff.filter(
              (item) =>
                item.packageId === packageId &&
                item.validFrom <= year + "-12-31" &&
                (item.validTo === null || item.validTo >= year + "-01-01"),
            )
          : [],
      ),
    resolveTariff: (effectiveDate: string, packageId: string = packageIds.tariff) =>
      resolveWithHistory(
        source.tariff,
        "TARIFF",
        packageIds.tariff,
        packageId,
        effectiveDate,
        history.tariff,
      ),
    resolveLegal: (effectiveDate: string) =>
      resolveWithHistory(
        source.legal,
        "LEGAL",
        packageIds.legal,
        packageIds.legal,
        effectiveDate,
        history.legal,
      ),
    resolveHoliday: (effectiveDate: string) =>
      resolveWithHistory(
        source.holiday,
        "HOLIDAY",
        packageIds.holiday,
        packageIds.holiday,
        effectiveDate,
        history.holiday,
      ),
  });
  let serialized: string | null = null;
  cacheSources.set(resolver, () => {
    if (serialized !== null) return serialized;
    serialized = hasHistory
      ? canonicalizeRuleJson(["APP_HISTORICAL_DEFAULTS_V1", packageIds, source, history])
      : JSON.stringify([packageIds, catalog]);
    return serialized;
  });
  return resolver;
}

export function createRuleResolverFromCatalog(
  catalog: ValidatedRuleCatalog,
  historical?: RuleResolverHistoricalCatalog,
): RuleResolver {
  const packageIds = packageIdsFromManifest(catalog.manifest);
  if (packageIds === null) {
    throw new RuleCatalogCompatibilityError(
      "The rule resolver requires an unambiguous legacy tariff selection and exactly one legal and holiday track.",
    );
  }
  return createRuleResolver(
    {
      tariff: catalog.packages.filter(
        (rulePackage): rulePackage is RuleTariffPackage => rulePackage.kind === "TARIFF",
      ),
      legal: catalog.packages.filter(
        (rulePackage): rulePackage is RuleLegalPackage => rulePackage.kind === "LEGAL",
      ),
      holiday: catalog.packages.filter(
        (rulePackage): rulePackage is RuleHolidayPackage => rulePackage.kind === "HOLIDAY",
      ),
    },
    packageIds,
    historical,
  );
}

export const bundledRuleResolver = createRuleResolver();

export function requireResolvedPackage<T extends RulePackage>(resolution: RuleResolution<T>): T {
  if (!resolution.ok) throw new RuleResolutionError(resolution.error);
  return resolution.value;
}
