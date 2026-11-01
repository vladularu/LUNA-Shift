import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import release from "../../rules/releases/preview-generation-6.json";
import { canonicalizeRuleJson } from "./rule-catalog-verification";
import {
  EMBEDDED_REVIEWED_PREVIEW_GENERATION,
  EMBEDDED_REVIEWED_RULE_CATALOG,
  embeddedReviewedRuleResolver,
} from "./embedded-reviewed-rules";
import { validateRulePackage } from "./validation";

const hashes = {
  "tvoed-vka-bt-k/2026-05-r4": "0a10e8e37f668af630d0d48746ffc126c3a8fbd9ba1ed1d0f23ad0708a45040b",
  "de-arbzg-care/2026-01": "aa09f85ee637603008ba2c74976f94758587ebe01bbfa6d260535d634a2b9db2",
  "de-holidays/2026": "c46c85d967d290d0e22edaba88fe5b6b19f01cad161439da4706b9c3a56cb2cd",
  "de-holidays/2027": "c8e962ba7a142cc269b81cb018671632307f8d2cb994a0b12ea2fdf6f32f5263",
};
const packages = [
  ...EMBEDDED_REVIEWED_RULE_CATALOG.tariff,
  ...EMBEDDED_REVIEWED_RULE_CATALOG.legal,
  ...EMBEDDED_REVIEWED_RULE_CATALOG.holiday,
];

describe("embedded reviewed application catalog", () => {
  it("contains exactly the reviewed data of the verified published Preview baseline", () => {
    expect(EMBEDDED_REVIEWED_PREVIEW_GENERATION).toBe(release.generation);
    expect(packages).toHaveLength(release.packageSources.length);
    for (const item of packages) {
      expect(item.status).toBe("REVIEWED");
      expect(validateRulePackage(item).ok).toBe(true);
      const published = {
        ...item,
        status: "PUBLISHED",
        review: { ...item.review, status: "PUBLISHED" },
      };
      const hash = createHash("sha256").update(canonicalizeRuleJson(published)).digest("hex");
      expect(hash).toBe(hashes[`${item.packageId}/${item.versionId}` as keyof typeof hashes]);
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.rules)).toBe(true);
    }
  });

  it("keeps the complete multi-tariff snapshot and reviewed validity boundaries", () => {
    expect(embeddedReviewedRuleResolver.simpleTariffData?.tables.length).toBeGreaterThan(20);
    const selected = embeddedReviewedRuleResolver.resolveTariff("2026-07-01");
    expect(selected.ok && selected.value.versionId).toBe("2026-05-r4");
    expect(embeddedReviewedRuleResolver.resolveTariff("2027-04-01").ok).toBe(false);
    expect(embeddedReviewedRuleResolver.resolveHoliday("2025-01-01").ok).toBe(true);
    expect(embeddedReviewedRuleResolver.resolveHoliday("2027-01-01").ok).toBe(true);
  });
});
