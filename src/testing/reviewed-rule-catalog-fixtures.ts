import { createHash } from "node:crypto";
import manifestFixture from "../../rules/examples/manifest.valid.json";
import type { StoredRuleCatalogSnapshot } from "@/application/rule-catalog-runtime";
import type { RulePackage } from "@/rules/contracts.generated";
import {
  EMBEDDED_REVIEWED_PREVIEW_GENERATION,
  EMBEDDED_REVIEWED_RULE_CATALOG,
} from "@/rules/embedded-reviewed-rules";
import { canonicalizeRuleJson } from "@/rules/rule-catalog-verification";
import { validateRuleCatalog } from "@/rules/validation";

/** Structural runtime fixture only; it does not sign, publish, or bypass remote verification. */
export function reviewedCatalogSnapshot(
  generation = EMBEDDED_REVIEWED_PREVIEW_GENERATION,
): StoredRuleCatalogSnapshot {
  const packages = JSON.parse(
    JSON.stringify([
      ...EMBEDDED_REVIEWED_RULE_CATALOG.tariff,
      ...EMBEDDED_REVIEWED_RULE_CATALOG.legal,
      ...EMBEDDED_REVIEWED_RULE_CATALOG.holiday,
    ]),
  ) as RulePackage[];
  for (const item of packages) {
    item.status = "PUBLISHED";
    item.review.status = "PUBLISHED";
  }
  const tracks = [...new Set(packages.map((item) => item.packageId))].map((packageId) => {
    const versions = packages
      .filter((item) => item.packageId === packageId)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    return {
      packageId,
      kind: versions[0].kind,
      coverageFrom: versions[0].validFrom,
      coverageTo: versions.at(-1)!.validTo,
      coverage: "COMPLETE" as const,
    };
  });
  const result = validateRuleCatalog(
    {
      ...manifestFixture,
      generation,
      tracks,
      packages: packages.map((item) => {
        const json = canonicalizeRuleJson(item);
        return {
          packageId: item.packageId,
          versionId: item.versionId,
          kind: item.kind,
          engineContractVersion: item.engineContractVersion,
          validFrom: item.validFrom,
          validTo: item.validTo,
          path: `packages/${item.packageId}/${item.versionId}.json`,
          sizeBytes: new TextEncoder().encode(json).byteLength,
          sha256: createHash("sha256").update(json).digest("hex"),
        };
      }),
    },
    packages,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return {
    generation,
    activeGeneration: generation,
    recoveredFromGeneration: null,
    catalog: result.value,
  };
}
