import type { RuleTariffPackage } from "@/rules/contracts.generated";
import type { RuleResolver, SimpleTariffData } from "@/rules/rule-resolver";
import {
  coversPayrollDate,
  isPayrollTariffContinuation,
  latestExpiredPayrollValue,
  recordPayrollTariffContinuation,
  type DatedPayrollValue,
} from "./payroll-tariff-dates";

type Table = SimpleTariffData["tables"][number];
export type SimpleTariffFamily = Table["tariffId"];

// Minimum term or earliest termination date of the current pay agreement.
const payReviewDates: Partial<Record<SimpleTariffFamily, string>> = {
  TVL_KR: "2028-01-31",
  TVAL_PFLEGE: "2028-01-31",
  TVH_KR: "2028-02-29",
  TVUK_PUK: "2028-07-31",
};

function recordPayReview(
  resolver: RuleResolver,
  date: string,
  reviewDate: string | undefined,
  table: DatedPayrollValue | null | undefined,
) {
  // Explicit coverage or a successor effective after the review date confirms the stand.
  if (reviewDate && date > reviewDate && table?.validTo === null && table.validFrom <= reviewDate)
    recordPayrollTariffContinuation(resolver, date, reviewDate);
}

/** Catalog validation has already checked dates, completeness, sources and overlaps. */
export function selectSimpleTariffTable(
  resolver: RuleResolver,
  family: SimpleTariffFamily,
  date: string,
): Table | null {
  const matches =
    resolver.simpleTariffData?.tables.filter(
      (table) =>
        table.tariffId === family &&
        table.validFrom <= date &&
        (table.validTo === null || date <= table.validTo),
    ) ?? [];
  if (matches.length > 1) throw new Error("Mehrdeutige geprüfte Tariftabelle.");
  return matches[0] ?? null;
}

/** A verified table can supersede an older bundled table even if that table had an open end. */
export function selectPayrollTable(
  resolver: RuleResolver,
  family: SimpleTariffFamily,
  date: string,
  bundledVersion?: DatedPayrollValue | null,
): Table | null {
  const reviewDate = payReviewDates[family];
  const exact = selectSimpleTariffTable(resolver, family, date);
  if (exact && (!reviewDate || !bundledVersion || exact.validFrom >= bundledVersion.validFrom)) {
    recordPayReview(resolver, date, reviewDate, exact);
    return exact;
  }
  if (!isPayrollTariffContinuation(resolver)) return null;

  const previous = latestExpiredPayrollValue(
    (resolver.simpleTariffData?.tables ?? []).filter((table) => table.tariffId === family),
    date,
  );
  if (previous && (!bundledVersion || previous.validFrom >= bundledVersion.validFrom)) {
    recordPayrollTariffContinuation(resolver, date, previous.validTo!);
    return previous;
  }
  if (bundledVersion && coversPayrollDate(bundledVersion, date))
    recordPayReview(resolver, date, reviewDate, bundledVersion);
  return null;
}

export function selectBundledPayrollTable<T extends DatedPayrollValue>(
  resolver: RuleResolver,
  values: readonly T[],
  date: string,
  hasCatalogTable: boolean,
): T | null {
  const exact = values.find((value) => coversPayrollDate(value, date));
  if (exact) return exact;
  if (!hasCatalogTable && !isPayrollTariffContinuation(resolver)) return null;
  const previous = latestExpiredPayrollValue(values, date);
  if (previous && !hasCatalogTable)
    recordPayrollTariffContinuation(resolver, date, previous.validTo!);
  return previous ?? null;
}

export function simpleTariffTableAmount(table: Table, group: string, step: string): number {
  const rows = table.entries.filter((row) => row.groupId === group && row.stepId === step);
  if (rows.length !== 1) throw new Error("Unvollständige geprüfte Tariftabelle.");
  return rows[0].monthlyCents;
}

export function overlaySimpleTariffPackage(
  local: RuleTariffPackage,
  table: Table | null,
  resolver: RuleResolver,
): RuleTariffPackage {
  if (!table) return local;
  const sources = resolver.simpleTariffData!.sources.filter((source) =>
    table.sourceIds.includes(source.id),
  );
  return {
    ...local,
    validFrom: table.validFrom,
    validTo: table.validTo,
    sources: [
      ...local.sources.filter((source) => !table.sourceIds.includes(source.id)),
      ...sources,
    ] as RuleTariffPackage["sources"],
    rules: {
      ...local.rules,
      payTables: local.rules.payTables.map((payTable) =>
        payTable.id === local.rules.selector.payTableId
          ? { ...payTable, entries: table.entries, sourceIds: table.sourceIds }
          : payTable,
      ) as RuleTariffPackage["rules"]["payTables"],
    },
  };
}
