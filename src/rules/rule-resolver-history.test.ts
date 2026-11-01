import { describe, expect, it } from "vitest";
import {
  APP_HISTORICAL_RULE_CATALOG,
  EMBEDDED_REVIEWED_PACKAGE_IDS,
  EMBEDDED_REVIEWED_RULE_CATALOG,
  embeddedReviewedRuleResolver,
} from "./embedded-reviewed-rules";
import {
  bundledRuleResolver,
  createRuleResolver,
  serializeRuleResolverForCache,
} from "./rule-resolver";

describe("explicit historical application defaults", () => {
  it("preserves the previous tariff, legal and holiday packages before each reviewed track", () => {
    expect(embeddedReviewedRuleResolver.resolveTariff("2026-04-30").ok).toBe(true);
    expect(embeddedReviewedRuleResolver.resolveHoliday("2025-10-31").ok).toBe(true);
    expect(embeddedReviewedRuleResolver.resolveLegal("2025-12-31").ok).toBe(true);
    expect(embeddedReviewedRuleResolver.resolveTariff("2026-04-30")).toEqual(
      bundledRuleResolver.resolveTariff("2026-04-30"),
    );
    expect(embeddedReviewedRuleResolver.resolveHoliday("2025-10-31")).toEqual(
      bundledRuleResolver.resolveHoliday("2025-10-31"),
    );
    expect(embeddedReviewedRuleResolver.resolveLegal("2025-12-31")).toEqual(
      bundledRuleResolver.resolveLegal("2025-12-31"),
    );
  });

  it("uses the reviewed track from its first day, including compatible explicit legacy requests", () => {
    const reviewed = embeddedReviewedRuleResolver.resolveTariff("2026-05-01");
    expect(reviewed.ok && reviewed.value.packageId).toBe("tvoed-vka-bt-k");
    expect(embeddedReviewedRuleResolver.resolveTariff("2026-05-01", "tvoed-p-vka-legacy")).toEqual(
      reviewed,
    );
    expect(embeddedReviewedRuleResolver.resolveHoliday("2026-01-01").ok).toBe(true);
  });

  it("does not fill future expiry, unknown selections, invalid dates or gaps with legacy rules", () => {
    expect(embeddedReviewedRuleResolver.resolveTariff("2027-04-01").ok).toBe(false);
    expect(embeddedReviewedRuleResolver.resolveTariff("2027-04-01", "tvoed-p-vka-legacy").ok).toBe(
      false,
    );
    expect(embeddedReviewedRuleResolver.resolveTariff("2026-07-01", "unknown-tariff").ok).toBe(
      false,
    );
    expect(embeddedReviewedRuleResolver.resolveTariff("2026-02-30")).toMatchObject({
      ok: false,
      error: { code: "INVALID_EFFECTIVE_DATE" },
    });
    const tariff = EMBEDDED_REVIEWED_RULE_CATALOG.tariff[0];
    const gap = createRuleResolver(
      {
        ...EMBEDDED_REVIEWED_RULE_CATALOG,
        tariff: [
          { ...tariff, validTo: "2026-06-30" },
          { ...tariff, versionId: "test-after-gap", validFrom: "2026-08-01" },
        ],
      },
      EMBEDDED_REVIEWED_PACKAGE_IDS,
      APP_HISTORICAL_RULE_CATALOG,
    );
    expect(gap.resolveTariff("2026-07-01")).toMatchObject({
      ok: false,
      error: { code: "RULE_PACKAGE_NOT_FOUND" },
    });
    const ambiguous = createRuleResolver(
      { ...EMBEDDED_REVIEWED_RULE_CATALOG, tariff: [tariff, { ...tariff, versionId: "overlap" }] },
      EMBEDDED_REVIEWED_PACKAGE_IDS,
      APP_HISTORICAL_RULE_CATALOG,
    );
    expect(ambiguous.resolveTariff("2026-07-01")).toMatchObject({
      ok: false,
      error: { code: "RULE_PACKAGE_AMBIGUOUS" },
    });
  });

  it("does not apply the TVöD historical track to a different default tariff", () => {
    const changed = createRuleResolver(
      {
        ...EMBEDDED_REVIEWED_RULE_CATALOG,
        tariff: EMBEDDED_REVIEWED_RULE_CATALOG.tariff.map((item) => ({
          ...item,
          packageId: "different-default",
        })),
      },
      { ...EMBEDDED_REVIEWED_PACKAGE_IDS, tariff: "different-default" },
      APP_HISTORICAL_RULE_CATALOG,
    );
    expect(changed.resolveTariff("2026-04-30").ok).toBe(false);
  });

  it("never extends historical fallback when a later catalog starts after the embedded baseline", () => {
    const later = createRuleResolver(
      {
        tariff: EMBEDDED_REVIEWED_RULE_CATALOG.tariff.map((item) => ({
          ...item,
          validFrom: "2027-05-01",
          validTo: "2028-03-31",
        })),
        legal: EMBEDDED_REVIEWED_RULE_CATALOG.legal.map((item) => ({
          ...item,
          validFrom: "2027-01-01",
        })),
        holiday: EMBEDDED_REVIEWED_RULE_CATALOG.holiday.filter(
          (item) => item.validFrom === "2027-01-01",
        ),
      },
      EMBEDDED_REVIEWED_PACKAGE_IDS,
      APP_HISTORICAL_RULE_CATALOG,
    );
    expect(later.resolveTariff("2026-04-30").ok).toBe(true);
    for (const date of ["2026-05-01", "2026-07-01", "2027-04-01"]) {
      expect(later.resolveTariff(date).ok).toBe(false);
      expect(later.resolveTariff(date, "tvoed-p-vka-legacy").ok).toBe(false);
    }
    expect(later.resolveLegal("2025-12-31").ok).toBe(true);
    expect(later.resolveLegal("2026-07-01").ok).toBe(false);
    expect(later.resolveHoliday("2025-12-31").ok).toBe(true);
    expect(later.resolveHoliday("2026-07-01").ok).toBe(false);
    expect(later.resolveTariff("2027-05-01").ok).toBe(true);
  });

  it("gives the application policy a stable, distinct reproducible cache identity", () => {
    const same = createRuleResolver(
      EMBEDDED_REVIEWED_RULE_CATALOG,
      EMBEDDED_REVIEWED_PACKAGE_IDS,
      APP_HISTORICAL_RULE_CATALOG,
    );
    const withoutHistory = createRuleResolver(
      EMBEDDED_REVIEWED_RULE_CATALOG,
      EMBEDDED_REVIEWED_PACKAGE_IDS,
    );
    expect(serializeRuleResolverForCache(embeddedReviewedRuleResolver)).not.toBeNull();
    expect(serializeRuleResolverForCache(same)).toBe(
      serializeRuleResolverForCache(embeddedReviewedRuleResolver),
    );
    expect(serializeRuleResolverForCache(withoutHistory)).not.toBe(
      serializeRuleResolverForCache(same),
    );
    expect(Object.isFrozen(same)).toBe(true);
  });
});
