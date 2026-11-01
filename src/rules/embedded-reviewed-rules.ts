import legalValue from "../../rules/packages/reviewed/de-arbzg-care/2026-01.json";
import holiday2026Value from "../../rules/packages/reviewed/de-holidays/2026.json";
import holiday2027Value from "../../rules/packages/reviewed/de-holidays/2027.json";
import tariffValue from "../../rules/packages/reviewed/tvoed-vka-bt-k/2026-05-r4.json";
import { LEGACY_RULE_PACKAGE_IDS } from "./bundled-rules";
import type { RulePackage } from "./contracts.generated";
import {
  BUNDLED_RULE_CATALOG,
  createRuleResolver,
  type RuleResolverHistoricalCatalog,
} from "./rule-resolver";
import { validateRulePackage } from "./validation";

/** Data baseline of the already published Preview release, not a Production remote generation. */
export const EMBEDDED_REVIEWED_PREVIEW_GENERATION = 6;
export const EMBEDDED_REVIEWED_PACKAGE_IDS = Object.freeze({
  tariff: "tvoed-vka-bt-k",
  legal: "de-arbzg-care",
  holiday: "de-holidays",
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function reviewed<K extends RulePackage["kind"]>(
  value: unknown,
  kind: K,
): Extract<RulePackage, { kind: K }> {
  const result = validateRulePackage(value);
  if (!result.ok || result.value.kind !== kind || result.value.status !== "REVIEWED") {
    throw new Error(`Invalid embedded reviewed ${kind} package.`);
  }
  return deepFreeze(result.value) as Extract<RulePackage, { kind: K }>;
}

export const EMBEDDED_REVIEWED_RULE_CATALOG = Object.freeze({
  tariff: Object.freeze([reviewed(tariffValue, "TARIFF")]),
  legal: Object.freeze([reviewed(legalValue, "LEGAL")]),
  holiday: Object.freeze([
    reviewed(holiday2026Value, "HOLIDAY"),
    reviewed(holiday2027Value, "HOLIDAY"),
  ]),
});

/** Only the pre-reviewed era of these compatible tracks may use the embedded historical rules. */
export const APP_HISTORICAL_RULE_CATALOG: RuleResolverHistoricalCatalog = Object.freeze({
  catalog: BUNDLED_RULE_CATALOG,
  packageIds: LEGACY_RULE_PACKAGE_IDS,
  compatiblePackageIds: EMBEDDED_REVIEWED_PACKAGE_IDS,
  validBefore: Object.freeze({
    tariff: "2026-05-01",
    legal: "2026-01-01",
    holiday: "2026-01-01",
  }),
});

export const embeddedReviewedRuleResolver = createRuleResolver(
  EMBEDDED_REVIEWED_RULE_CATALOG,
  EMBEDDED_REVIEWED_PACKAGE_IDS,
  APP_HISTORICAL_RULE_CATALOG,
);
