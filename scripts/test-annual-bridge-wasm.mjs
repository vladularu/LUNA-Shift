import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const [bindings, corpusPath, output] = process.argv.slice(2, 5).map((value) => path.resolve(value));
const limit = Number(process.argv[5] ?? 60);
assert.ok(Number.isSafeInteger(limit) && limit > 0);
mkdirSync(output, { recursive: true });
const entry = path.join(output, "annual-bridge.cjs");
await build({
  stdin: {
    contents: `
export * from './src/features/analysis/monthly-rust-net';
export * from './src/features/analysis/annual-rust-bridge';
export * from './src/features/analysis/annual-analysis';
export {createWorkingTimeCalculationProfile} from './src/engine/working-time-calculation-profile';
export * from './src/features/analysis/annual-net-pay';
export * from './src/features/analysis/annual-net-pay-cache';
export {persistentAnnualValue} from './src/features/analysis/persistent-analysis-values';
export {annualSalaryForecast} from './src/features/salary/annual-salary-forecast';
export {createStoredMonthlyRustCalculator} from './src/features/analysis/monthly-rust-source';
export {migrateDatabase} from './src/infrastructure/database/migrations';
export {saveProfile} from './src/infrastructure/database/profile-repository';
export {saveShift} from './src/infrastructure/database/calendar-entry-repository';
export {bundledRuleResolver} from './src/rules/rule-resolver';
export {prepareAutomaticNetPay} from './src/features/salary/automatic-net-pay-preparation';
export {prepareAnalysisSalarySteps,analysisSalaryKey} from './src/features/analysis/analysis-salary';
export {resolveNetPaySettings,collectAnnualSalaryPayments} from './src/domain/net-pay-profile';
export {createAnalysisResultRepository} from './src/infrastructure/database/analysis-result-repository';
export {createPersistentAnalysisCache} from './src/features/analysis/persistent-analysis-cache';
export {persistentSalaryValue} from './src/features/analysis/persistent-salary-value';
export {loadRuleCatalogRuntime} from './src/application/rule-catalog-runtime';
export {loadActiveRuleCatalog} from './src/infrastructure/database/rule-catalog-repository';
export {reviewedCatalogSnapshot} from './src/testing/reviewed-rule-catalog-fixtures';
export {canonicalizeRuleJson} from './src/rules/rule-catalog-verification';
`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  tsconfig: path.resolve("tsconfig.json"),
  logLevel: "silent",
  plugins: [
    {
      name: "original-pure-rule-capture",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]rule-computation\.tsx$/ }, ({ path: file }) => {
          const source = readFileSync(file, "utf8"),
            start = source.indexOf("export interface RuleComputationFailure"),
            end = source.indexOf("function ruleFailureMessage");
          assert.ok(start >= 0 && end > start);
          return {
            loader: "ts",
            resolveDir: path.dirname(file),
            contents:
              'import {WorkingTimeTargetError} from "@/domain/working-time-target-validation";\nimport {RuleResolutionError,type RuleResolutionFailure} from "@/rules/rule-resolver";\n' +
              source.slice(start, end),
          };
        });
      },
    },
  ],
});
const require = createRequire(import.meta.url),
  api = require(entry),
  native = require(bindings);
const info = JSON.parse(native.engineInvoke("info", ""));
let maxNativeReplyBytes = 0,
  monthlyGrossCalls = 0,
  yearGrossCalls = 0;
let operations = 0,
  lastFinance,
  lastChecks;
const transport = {
  expectedEngineVersion: info.engineVersion,
  async invoke(operation, json) {
    operations++;
    if (operation === "admitFinance") {
      const request = JSON.parse(json).command.request;
      if (request.sections.gross) {
        if (request.periods.some((p) => p.kind === "YEAR")) yearGrossCalls++;
        else monthlyGrossCalls++;
      }
      assert.equal(yearGrossCalls, 0, "Build 54 must never receive a gross YEAR request");
    }
    const raw = native.engineInvoke(operation, json);
    maxNativeReplyBytes = Math.max(maxNativeReplyBytes, Buffer.byteLength(raw));
    const result = JSON.parse(raw);
    if (operation === "runChecks" && result.result) lastChecks = result.result.reports[0];
    if (operation === "runFinance" && result.result)
      for (const report of result.result.reports) {
        lastFinance = structuredClone(report);
        const page = report.views?.payrollPage;
        const forecast = page?.value?.annualEditor;
        report.views = {
          payrollPage:
            page?.state === "READY"
              ? {
                  state: "READY",
                  value: {
                    annualEditor: forecast
                      ? {
                          payments: forecast.payments,
                          proposal: forecast.proposal,
                          automatic: forecast.automatic,
                          issue: forecast.issue,
                        }
                      : undefined,
                  },
                }
              : page,
          time: { poison: "never consume" },
          core: { poison: "never consume" },
        };
      }
    return JSON.stringify(result);
  },
  async source(header, body) {
    operations++;
    return native.engineInvokeSource(header, body);
  },
  async calendarRanks(header, body) {
    operations++;
    return native.engineInvokeCalendarRanks(header, body);
  },
  async catalogFinalize(header, body) {
    operations++;
    return native.engineInvokeCatalogFinalize(header, body);
  },
};
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const eligible = corpus.cases.filter(
  (item) => item.expected.forecasts?.length && JSON.parse(item.inputJson).testMonths.length === 0,
);
const first = eligible.find((item) => item.id === "manual-positive-2026-base-0-EARNED");
assert.ok(first);
const sampled = ["EARNED", "PAYOUT"].flatMap((perspective) => {
  const group = eligible.filter((item) => JSON.parse(item.inputJson).perspective === perspective);
  const quota = Math.max(1, Math.floor(limit / 2));
  return group.filter((_, index) => index % Math.ceil(group.length / quota) === 0).slice(0, quota);
});
const selected = [first, ...sampled.filter((item) => item !== first)].slice(0, limit);
const diagnosis = {
  source: "LEGACY_EMBEDDED",
  activeGeneration: null,
  selectedGeneration: null,
  keyId: null,
  fallbackReason: null,
};
const cases = [];
const excluded = [];
let savedFixture;
let appEmbeddedCatalog = false,
  storedCatalog = false;
let taxEditVerified = false,
  engineCacheIsolation = false,
  sharedOwnerVerified = false;
const normalize = (value) =>
  JSON.parse(JSON.stringify(value, (_key, item) => (item instanceof Map ? [...item] : item)));
async function drain(steps) {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
    if (next.value instanceof Promise) await next.value;
  }
}
for (const item of selected) {
  const input = JSON.parse(item.inputJson);
  const bound = item.expected.forecasts.filter((value) =>
    api.resolveNetPaySettings(value.month, input.timeline),
  );
  const candidate =
    bound.find((value) => input.entries.some((entry) => entry.date.startsWith(value.month))) ??
    bound[0];
  if (!candidate) continue;
  const sql = new DatabaseSync(":memory:");
  const flatten = (args) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  const db = {
    async execAsync(text) {
      sql.exec(text);
    },
    async getFirstAsync(text, ...args) {
      return sql.prepare(text).get(...flatten(args)) ?? null;
    },
    async getAllAsync(text, ...args) {
      return sql.prepare(text).all(...flatten(args));
    },
    async runAsync(text, ...args) {
      const result = sql.prepare(text).run(...flatten(args));
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
    },
  };
  await api.migrateDatabase(db);
  let profile;
  try {
    profile = await api.saveProfile(db, input.profile);
  } catch (error) {
    if (error?.name !== "ValidationError") throw error;
    excluded.push({
      id: item.id,
      reason: "The original profile writer rejects this intentionally invalid source fixture",
      message: error.message,
    });
    sql.close();
    continue;
  }
  const entries = [];
  for (const shift of input.entries) {
    assert.equal(shift.kind, "SHIFT");
    entries.push(await api.saveShift(db, { ...shift, id: undefined, templateId: null }));
  }
  for (const saved of input.timeline)
    sql
      .prepare(
        "INSERT INTO net_pay_profiles(month,settings_json,revision,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        saved.settings.month,
        JSON.stringify(saved.settings),
        saved.revision,
        saved.createdAt,
        saved.updatedAt,
      );
  sql
    .prepare("INSERT OR REPLACE INTO app_preferences(key,value,updated_at) VALUES(?,?,?)")
    .run("salary_payment_v1", JSON.stringify(input.preferences), "2026-01-01T00:00:00Z");
  for (const decision of input.tariffDecisions)
    sql
      .prepare(
        "INSERT INTO monthly_tariff_decisions(month,allowance_status,revision,confirmed_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        decision.month,
        decision.allowanceStatus,
        decision.revision,
        decision.confirmedAt,
        decision.updatedAt,
      );
  const context = {
    entries,
    tariffDecisions: input.tariffDecisions,
    workPatternSettings: input.workPatternSettings,
    resolver: api.bundledRuleResolver,
    testMonths: input.testMonths,
  };

  const year = Number(candidate.month.slice(0, 4));
  const calculationProfile = api.createWorkingTimeCalculationProfile(
    profile,
    null,
    [],
    "ready",
    entries,
    false,
  );
  const base = {
    year,
    entries,
    profile: calculationProfile,
    tariffDecisions: input.tariffDecisions,
    workPatternSettings: input.workPatternSettings,
    referenceDate: "2026-11-16",
    youthProtection: false,
    ruleResolver: api.bundledRuleResolver,
  };
  const calc = api.createStoredAnnualRustCalculator(db, transport, diagnosis, entries);
  const netRequest = {
    year,
    profile,
    timeline: input.timeline,
    preferences: input.preferences,
    context,
  };
  const start = performance.now();
  const actual = await calc.report(base);
  const rustReportMs = performance.now() - start,
    tsStart = performance.now();
  const rawBase = {
    period: lastFinance.period,
    sections: { ...lastFinance.sections, checks: lastChecks.sections.checks },
  };
  const expected = await drain(
    api.prepareAnnualAnalysisSteps(base, api.annualAnalysisKey(base), null),
  );
  assert.deepEqual(
    normalize(actual),
    normalize(expected),
    item.id + " annual time/gross/check parity",
  );
  const tsReportMs = performance.now() - tsStart,
    netStart = performance.now();
  const net = await calc.net(netRequest);
  const rustNetMs = performance.now() - netStart,
    tsNetStart = performance.now();
  const expectedNet = await drain(api.annualNetPaySteps(netRequest));
  const tsNetMs = performance.now() - tsNetStart;
  const { salaryForecast, ...pureNet } = net;
  assert.deepEqual(
    normalize(pureNet),
    normalize(expectedNet),
    item.id + " annual payout net parity",
  );
  const expectedForecast = api.annualSalaryForecast(
    year,
    profile,
    context,
    api.collectAnnualSalaryPayments(input.timeline),
  );
  assert.deepEqual(
    normalize(salaryForecast),
    normalize(expectedForecast),
    item.id + " annual salary forecast parity",
  );

  if (!sharedOwnerVerified) {
    const monthRequest = {
      month: candidate.month,
      profile: calculationProfile,
      entries,
      tariffDecisions: input.tariffDecisions,
      workPatternSettings: input.workPatternSettings,
      ruleResolver: api.bundledRuleResolver,
    };
    const saved = api.resolveNetPaySettings(candidate.month, input.timeline);
    const monthlyNet = {
      month: candidate.month,
      profile,
      settings: saved.settings,
      annualPayments: api.collectAnnualSalaryPayments(input.timeline),
      context,
      payment: {
        preferences: input.preferences,
        perspective: "PAYOUT",
        sourceSettings: input.timeline,
      },
    };
    const values = await Promise.all([
      calc.report(base),
      calc.net(netRequest),
      api.createStoredMonthlyRustCalculator(db, transport, diagnosis)(monthRequest),
      api.createStoredMonthlyRustNetCalculator(db, transport, diagnosis)(monthlyNet),
    ]);
    assert.deepEqual(normalize(values[0]), normalize(actual));
    assert.deepEqual(normalize(values[1]), normalize(net));
    assert.equal(values[2].pay.ok, true);
    assert.equal(values[3].result.status, "available");
    sharedOwnerVerified = true;
    sql
      .prepare(
        "INSERT INTO training_profiles(effective_from,data_json,revision,updated_at) VALUES(?,?,?,?)",
      )
      .run("2026-01-01", "{}", 1, "2026-11-16T00:00:00Z");
    assert.deepEqual(
      normalize(await calc.report(base)),
      normalize(actual),
      "Separate invalid training rows must not change or block the simple annual report",
    );
    sql.prepare("DELETE FROM training_profiles").run();
    const typed = api.annualRustRequest(base, calc),
      key = api.annualAnalysisKey(typed);
    const cache = () =>
      api.createPersistentAnalysisCache({
        repository: api.createAnalysisResultRepository(db, () => candidate.month),
        sha256: async (text) => createHash("sha256").update(text).digest("hex"),
        bundleId: "annual-package3-real-sqlite",
      });
    const before = operations;
    await cache().write(
      "annual",
      year + "-01",
      key,
      base.ruleResolver,
      actual,
      api.persistentAnnualValue,
    );
    const restored = await cache().read(
      "annual",
      year + "-01",
      key,
      base.ruleResolver,
      api.persistentAnnualValue,
    );
    assert.deepEqual(
      normalize(restored),
      normalize(actual),
      "Cold year cache must preserve Map and every DTO field",
    );
    const netKey = api.annualNetPayKey(api.annualRustNetRequest(netRequest, calc));
    await cache().write("salary", String(year), netKey, context.resolver, net, (v) =>
      api.persistentAnnualNetPay(v, year, true),
    );
    assert.deepEqual(
      await cache().read("salary", String(year), netKey, context.resolver, (v) =>
        api.persistentAnnualNetPay(v, year, true),
      ),
      net,
      "Cold net cache retains forecast",
    );
    assert.equal(
      operations,
      before,
      "Restoring unchanged persisted results must run zero native operations",
    );
    const edited = await api.saveShift(db, {
      ...entries[0],
      expectedRevision: entries[0].revision,
      endTime: "08:30",
    });
    const revised = entries.map((entry) => (entry.id === edited.id ? edited : entry)),
      editedProfile = api.createWorkingTimeCalculationProfile(
        profile,
        null,
        [],
        "ready",
        revised,
        false,
      );
    const changed = { ...base, entries: revised, profile: editedProfile };
    const changedCalculator = api.createStoredAnnualRustCalculator(
      db,
      transport,
      diagnosis,
      revised,
    );
    const changedValue = await changedCalculator.report(changed),
      changedExpected = await drain(
        api.prepareAnnualAnalysisSteps(changed, api.annualAnalysisKey(changed), null),
      );
    assert.deepEqual(
      normalize(changedValue),
      normalize(changedExpected),
      "End-time edit year parity",
    );
    assert.notEqual(
      changedValue.actualMinutes,
      actual.actualMinutes,
      "End-time edit must affect annual hours",
    );
    assert.notEqual(api.annualAnalysisKey(api.annualRustRequest(changed, changedCalculator)), key);
    // Restore the real database before subsequent comparisons in this case.
    entries[0] = await api.saveShift(db, { ...entries[0], expectedRevision: edited.revision });
  }
  if (salaryForecast.proposal && !appEmbeddedCatalog) {
    const embedded = (await api.loadRuleCatalogRuntime(async () => null)).runtime;
    const verifyCatalog = async (runtime) => {
      const r = { ...base, ruleResolver: runtime.resolver },
        n = { ...netRequest, context: { ...context, resolver: runtime.resolver } };
      const calc = api.createStoredAnnualRustCalculator(db, transport, runtime.diagnosis, entries);
      assert.deepEqual(
        normalize(await calc.report(r)),
        normalize(await drain(api.prepareAnnualAnalysisSteps(r, api.annualAnalysisKey(r), null))),
        "Selected catalog year parity",
      );
      const value = await calc.net(n),
        { salaryForecast: forecast, ...raw } = value;
      assert.deepEqual(
        normalize(raw),
        normalize(await drain(api.annualNetPaySteps(n))),
        "Selected catalog net parity",
      );
      assert.deepEqual(
        normalize(forecast),
        normalize(
          api.annualSalaryForecast(
            year,
            profile,
            n.context,
            api.collectAnnualSalaryPayments(input.timeline),
          ),
        ),
      );
    };
    await verifyCatalog(embedded);
    appEmbeddedCatalog = true;
    const catalog = api.reviewedCatalogSnapshot(7);
    sql
      .prepare(
        "INSERT INTO rule_catalog_generations(generation,manifest_json,activated_at) VALUES(?,?,?)",
      )
      .run(7, api.canonicalizeRuleJson(catalog.catalog.manifest), "2026-11-16T00:00:00Z");
    for (const item of catalog.catalog.packages)
      sql
        .prepare(
          "INSERT INTO rule_catalog_packages(generation,package_id,version_id,kind,payload_json) VALUES(?,?,?,?,?)",
        )
        .run(7, item.packageId, item.versionId, item.kind, api.canonicalizeRuleJson(item));
    sql
      .prepare("INSERT INTO rule_catalog_state(id,active_generation,updated_at) VALUES(?,?,?)")
      .run("active", 7, "2026-11-16T00:00:00Z");
    const stored = (await api.loadRuleCatalogRuntime(() => api.loadActiveRuleCatalog(db))).runtime;
    assert.equal(stored.diagnosis.source, "STORED");
    await verifyCatalog(stored);
    storedCatalog = true;
  }

  cases.push({ id: item.id, year, rustReportMs, tsReportMs, rustNetMs, tsNetMs });
  if (!savedFixture || (!savedFixture.net.salaryForecast.proposal && salaryForecast.proposal))
    savedFixture = {
      base: normalize(base),
      netRequest: normalize(netRequest),
      report: normalize(actual),
      net: normalize(net),
    };
  sql.close();
}
writeFileSync(
  path.join(output, "annual-bridge-results.json"),
  JSON.stringify(
    {
      passed: true,
      cases,
      excluded,
      operations,
      sharedOwnerVerified,
      appEmbeddedCatalog,
      storedCatalog,
      engineVersion: info.engineVersion,
      maxNativeReplyBytes,
      monthlyGrossCalls,
      yearGrossCalls,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  path.join(output, "annual-bridge.fixture.json"),
  JSON.stringify(savedFixture, null, 2) + "\n",
);
console.log(
  JSON.stringify({ passed: true, cases: cases.length, excluded: excluded.length, operations }),
);
