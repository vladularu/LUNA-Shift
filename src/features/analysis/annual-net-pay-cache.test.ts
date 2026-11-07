import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRuleResolver, BUNDLED_RULE_CATALOG } from "@/rules/rule-resolver";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import { createAnalysisResultRepository } from "@/infrastructure/database/analysis-result-repository";
import { createPersistentAnalysisCache } from "./persistent-analysis-cache";
import {
  annualNetPaySteps,
  summarizeAnnualNetPay,
  type AnnualNetPay,
  type AnnualNetPayRequest,
} from "./annual-net-pay";
import {
  annualNetPayKey,
  annualNetPayPeriod,
  persistentAnnualNetPay,
} from "./annual-net-pay-cache";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (calculate: () => unknown) => ({ ok: true, value: calculate() }),
}));
class Adapter {
  readonly raw = new Database(":memory:");
  async execAsync(sql: string) {
    this.raw.exec(sql);
  }
  async runAsync(sql: string, ...params: unknown[]) {
    return this.raw.prepare(sql).run(...params);
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params) as T | undefined) ?? null;
  }
}
const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");
let db: Adapter;
beforeEach(() => {
  db = new Adapter();
});
afterEach(() => db.raw.close());
const cache = (bundleId = "preview-d") =>
  createPersistentAnalysisCache({
    bundleId,
    sha256,
    repository: createAnalysisResultRepository(db as unknown as SQLiteDatabase, () => "2026-07"),
  });
function input(): AnnualNetPayRequest {
  return {
    year: 2026,
    profile: structuredClone(forecastProfile),
    timeline: [
      {
        settings: automatedSettings("2026-01"),
        revision: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    preferences: DEFAULT_SALARY_PAYMENT_PREFERENCES,
    context: {
      entries: [forecastShift()],
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: createRuleResolver(),
      testMonths: [],
    },
  };
}
const accept = (value: unknown): value is AnnualNetPay => persistentAnnualNetPay(value, 2026);
function calculate(request: AnnualNetPayRequest) {
  const steps = annualNetPaySteps(request);
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
const sample = () =>
  summarizeAnnualNetPay(
    2026,
    Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      netCents: i < 7 ? 250000 : null,
      status: i < 7 ? null : "Nicht verfügbar",
      notes: [],
      preliminary: false,
    })),
  );
const write = (request: AnnualNetPayRequest, value = sample(), store = cache()) =>
  store.write(
    "salary",
    annualNetPayPeriod(request.year),
    annualNetPayKey(request),
    request.context.resolver,
    value,
    accept,
  );
const read = (request: AnnualNetPayRequest, store = cache()) =>
  store.read(
    "salary",
    annualNetPayPeriod(request.year),
    annualNetPayKey(request),
    request.context.resolver,
    accept,
  );

describe("persistent annual net across process restarts", () => {
  it("loads a real calculated year through a new cache and resolver without recalculation", async () => {
    const request = input(),
      result = calculate(request);
    expect(result.availableMonthCount).toBeGreaterThan(0);
    expect(accept(result)).toBe(true);
    await write(request, result);
    const restarted = {
      ...structuredClone({ ...request, context: { ...request.context, resolver: undefined } }),
      context: { ...request.context, resolver: createRuleResolver() },
    };
    expect(await read(restarted)).toEqual(result);
    expect(
      db.raw.prepare("SELECT month FROM analysis_result_cache_v2 WHERE kind='salary'").all(),
    ).toEqual([{ month: "2026" }]);
  });
  it.each([
    "entries",
    "profile",
    "timeline",
    "payment",
    "testMonths",
    "rules",
    "bundle",
    "year",
  ] as const)("rejects saved values after changed %s", async (change) => {
    const request = input();
    await write(request);
    let next = request;
    if (change === "entries")
      next = {
        ...request,
        context: { ...request.context, entries: [forecastShift({ endTime: "05:00" })] },
      };
    if (change === "profile")
      next = { ...request, profile: { ...request.profile, weeklyMinutes: 1200 } };
    if (change === "timeline")
      next = {
        ...request,
        timeline: [
          {
            ...request.timeline[0],
            settings: {
              ...request.timeline[0].settings,
              profile: { ...request.timeline[0].settings.profile, taxClass: 4 },
            },
          },
        ],
      };
    if (change === "payment")
      next = { ...request, preferences: setSalaryPaymentLag(request.preferences, "2026-01", 1) };
    if (change === "testMonths")
      next = { ...request, context: { ...request.context, testMonths: ["2026-07"] } };
    if (change === "rules")
      next = {
        ...request,
        context: {
          ...request.context,
          resolver: createRuleResolver({ ...BUNDLED_RULE_CATALOG, tariff: [] }),
        },
      };
    if (change === "year") next = { ...request, year: 2027 };
    expect(await read(next, cache(change === "bundle" ? "preview-next" : "preview-d"))).toBeNull();
  });
  it.each([
    "months",
    "total",
    "count",
    "duplicate",
    "year",
    "notes",
    "status",
    "preliminary",
    "fraction",
    "overflow",
  ])("rejects corrupt %s even with a matching checksum", async (field) => {
    const request = input(),
      value = sample();
    await write(request, value);
    const bad = JSON.parse(JSON.stringify(value));
    if (field === "months") bad.months.pop();
    if (field === "total") bad.netCents++;
    if (field === "count") bad.availableMonthCount++;
    if (field === "duplicate") bad.months[1].month = "2026-01";
    if (field === "year") bad.year++;
    if (field === "notes") bad.notes = ["wrong"];
    if (field === "status") bad.months[0].status = "missing";
    if (field === "preliminary") bad.preliminary = true;
    if (field === "fraction") bad.months[0].netCents = 1.5;
    if (field === "overflow") bad.months[0].netCents = Number.MAX_SAFE_INTEGER + 1;
    const payload = JSON.stringify(bad);
    db.raw
      .prepare("UPDATE analysis_result_cache_v2 SET value_json=?,value_hash=? WHERE kind='salary'")
      .run(payload, await sha256(payload));
    expect(await read(request)).toBeNull();
  });
  it("does not persist a transient failed month as a valid annual result", async () => {
    const request = input();
    const failed = summarizeAnnualNetPay(
      2026,
      sample().months.map((month, index) =>
        index === 0
          ? {
              ...month,
              netCents: null,
              status: "Die vollständige Gehaltsprognose konnte nicht berechnet werden.",
              notes: [],
              preliminary: false,
            }
          : month,
      ),
    );
    await write(request, failed);
    expect(await read(request)).toBeNull();
  });
  it("does not let a superseded annual computation overwrite newer inputs", async () => {
    const request = input(),
      store = cache(),
      period = annualNetPayPeriod(2026);
    const old = store.claim!("salary", period);
    const newer = store.claim!("salary", period);
    const next = { ...request, profile: { ...request.profile, weeklyMinutes: 1200 } };
    await store.write(
      "salary",
      period,
      annualNetPayKey(next),
      next.context.resolver,
      sample(),
      accept,
      newer,
    );
    await store.write(
      "salary",
      period,
      annualNetPayKey(request),
      request.context.resolver,
      sample(),
      accept,
      old,
    );
    expect(await read(next)).toEqual(sample());
    expect(await read(request)).toBeNull();
  });
});
