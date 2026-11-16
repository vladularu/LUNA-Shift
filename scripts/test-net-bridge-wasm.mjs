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
const entry = path.join(output, "net-bridge.cjs");
await build({
  stdin: {
    contents: `
export * from './src/features/analysis/monthly-rust-net';
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
let operations = 0;
const transport = {
  expectedEngineVersion: info.engineVersion,
  async invoke(operation, json) {
    operations++;
    const result = JSON.parse(native.engineInvoke(operation, json));
    if (operation === "runFinance" && result.result)
      for (const report of result.result.reports) delete report.views;
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
const normalize = (value) => JSON.parse(JSON.stringify(value));
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
  const settings = api.resolveNetPaySettings(candidate.month, input.timeline).settings;
  const payment = {
    preferences: input.preferences,
    perspective: input.perspective,
    sourceSettings: input.timeline,
  };
  const request = {
    month: candidate.month,
    profile,
    settings,
    annualPayments: api.collectAnnualSalaryPayments(input.timeline),
    context,
    ...(input.perspective === "PAYOUT" ? { payment } : {}),
  };
  const calculator = api.createStoredMonthlyRustNetCalculator(db, transport, diagnosis);
  const before = operations,
    start = performance.now();
  const value = await calculator(request);
  const elapsedMs = performance.now() - start;
  const expected = api.prepareAutomaticNetPay(
    request.month,
    settings,
    profile,
    context,
    input.perspective === "PAYOUT" ? payment : undefined,
  );
  assert.deepEqual(normalize(value), normalize(expected), item.id + " native vs fresh original TS");
  if (value.result.status === "available") {
    assert.deepEqual(
      value.result.pay,
      candidate.result.result.pay,
      item.id + " frozen net/tax/insurance amounts",
    );
    const used = operations;
    assert.deepEqual(await calculator(request), value);
    assert.equal(operations, used, "Unchanged net must skip every native operation");
  }
  if (
    (!savedFixture ||
      savedFixture.full.annual.proposal === null ||
      !savedFixture.request.payment) &&
    value.result.status === "available"
  ) {
    const typed = api.monthlyRustNetRequest(request, calculator);
    const full = await drain(
      api.prepareAnalysisSalarySteps(typed, api.analysisSalaryKey(typed), undefined, calculator),
    );
    assert.equal(
      api.persistentSalaryValue(full, typed),
      true,
      "Old salary cache accepts native net",
    );
    const cache = () =>
      api.createPersistentAnalysisCache({
        repository: api.createAnalysisResultRepository(db, () => request.month),
        sha256: async (text) => createHash("sha256").update(text).digest("hex"),
        bundleId: "net-package2-real-sqlite",
      });
    const key = api.analysisSalaryKey(typed);
    await cache().write("salary", request.month, key, request.context.resolver, full, (value) =>
      api.persistentSalaryValue(value, typed),
    );
    assert.deepEqual(
      normalize(
        await cache().read("salary", request.month, key, request.context.resolver, (value) =>
          api.persistentSalaryValue(value, typed),
        ),
      ),
      normalize(full),
      "Cold full salary snapshot restores native net",
    );
    assert.equal(
      await cache().read(
        "salary",
        request.month,
        api.analysisSalaryKey({ ...typed, netCalculationIdentity: "different-engine" }),
        request.context.resolver,
        (value) => api.persistentSalaryValue(value, typed),
      ),
      null,
      "Another engine cannot reuse saved net",
    );
    engineCacheIsolation = true;
    const score = (full.annual.proposal ? 2 : 0) + (request.payment ? 1 : 0);
    const previousScore = savedFixture
      ? (savedFixture.full.annual.proposal ? 2 : 0) + (savedFixture.request.payment ? 1 : 0)
      : -1;
    if (score > previousScore) {
      savedFixture = {
        request: { ...request, context: { ...context, resolver: undefined } },
        value,
        full,
        engineVersion: info.engineVersion,
      };
      writeFileSync(
        path.join(output, "native-net-for-hook.json"),
        JSON.stringify(savedFixture, null, 2) + "\n",
      );
    }
    if (score === 3 && !appEmbeddedCatalog) {
      const embedded = (await api.loadRuleCatalogRuntime(async () => null)).runtime;
      const embeddedRequest = { ...request, context: { ...context, resolver: embedded.resolver } };
      const embeddedValue = await api.createStoredMonthlyRustNetCalculator(
        db,
        transport,
        embedded.diagnosis,
      )(embeddedRequest);
      assert.deepEqual(
        normalize(embeddedValue),
        normalize(
          api.prepareAutomaticNetPay(
            request.month,
            settings,
            profile,
            embeddedRequest.context,
            payment,
          ),
        ),
        "Actual app-embedded net catalog parity",
      );
      appEmbeddedCatalog = true;
      const fixture = api.reviewedCatalogSnapshot(7);
      sql
        .prepare(
          "INSERT INTO rule_catalog_generations(generation,manifest_json,activated_at) VALUES(?,?,?)",
        )
        .run(7, api.canonicalizeRuleJson(fixture.catalog.manifest), "2026-11-15T00:00:00Z");
      for (const item of fixture.catalog.packages)
        sql
          .prepare(
            "INSERT INTO rule_catalog_packages(generation,package_id,version_id,kind,payload_json) VALUES(?,?,?,?,?)",
          )
          .run(7, item.packageId, item.versionId, item.kind, api.canonicalizeRuleJson(item));
      sql
        .prepare("INSERT INTO rule_catalog_state(id,active_generation,updated_at) VALUES(?,?,?)")
        .run("active", 7, "2026-11-15T00:00:00Z");
      const external = (await api.loadRuleCatalogRuntime(() => api.loadActiveRuleCatalog(db)))
        .runtime;
      assert.equal(external.diagnosis.source, "STORED");
      const externalRequest = { ...request, context: { ...context, resolver: external.resolver } };
      const externalValue = await api.createStoredMonthlyRustNetCalculator(
        db,
        transport,
        external.diagnosis,
      )(externalRequest);
      assert.deepEqual(
        normalize(externalValue),
        normalize(
          api.prepareAutomaticNetPay(
            request.month,
            settings,
            profile,
            externalRequest.context,
            payment,
          ),
        ),
        "Stored original catalog artifacts net parity",
      );
      storedCatalog = true;
    }
  }
  if (!taxEditVerified && item.id === "manual-positive-2026-base-0-EARNED") {
    const changedSettings = { ...settings, profile: { ...settings.profile, taxClass: 3 } };
    sql
      .prepare("UPDATE net_pay_profiles SET settings_json=?,revision=revision+1 WHERE month=?")
      .run(JSON.stringify(changedSettings), settings.month);
    const changed = { ...request, settings: changedSettings };
    const changedValue = await calculator(changed);
    assert.deepEqual(
      normalize(changedValue),
      normalize(api.prepareAutomaticNetPay(changed.month, changed.settings, profile, context)),
      "Tax edit must match fresh original TS",
    );
    assert.notEqual(
      changedValue.result.pay.netCents,
      value.result.pay.netCents,
      "Tax-class change must affect net",
    );
    const monthRequest = {
      month: request.month,
      profile,
      entries,
      tariffDecisions: context.tariffDecisions,
      workPatternSettings: context.workPatternSettings,
      ruleResolver: context.resolver,
    };
    // Force another net operation while an ordinary month job uses the same owner.
    const concurrentSettings = {
      ...changedSettings,
      profile: { ...changedSettings.profile, taxClass: 4 },
    };
    sql
      .prepare("UPDATE net_pay_profiles SET settings_json=?,revision=revision+1 WHERE month=?")
      .run(JSON.stringify(concurrentSettings), settings.month);
    const [ordinary, concurrent] = await Promise.all([
      api.createStoredMonthlyRustCalculator(db, transport, diagnosis)(monthRequest),
      calculator({ ...request, settings: concurrentSettings }),
    ]);
    assert.equal(ordinary.pay.ok, true);
    assert.deepEqual(
      normalize(concurrent),
      normalize(api.prepareAutomaticNetPay(request.month, concurrentSettings, profile, context)),
      "Shared month/net owner queue must not supersede either result",
    );
    sharedOwnerVerified = true;
    taxEditVerified = true;
  }
  cases.push({
    id: item.id,
    month: request.month,
    perspective: input.perspective,
    status: value.result.status,
    operations: operations - before,
    milliseconds: elapsedMs,
  });
  sql.close();
}
assert.ok(savedFixture);
assert.ok(taxEditVerified && engineCacheIsolation && sharedOwnerVerified);
assert.ok(appEmbeddedCatalog && storedCatalog);
assert.ok(
  cases.some((item) => item.perspective === "EARNED") &&
    cases.some((item) => item.perspective === "PAYOUT"),
);
const proof = {
  passed: true,
  cases,
  excluded,
  engineVersion: info.engineVersion,
  sourceCorpusSha256: createHash("sha256").update(readFileSync(corpusPath)).digest("hex"),
  nativeViewsConsumed: false,
  oldSqliteSchema: true,
  oldFullSalaryColdCache: true,
  taxEditVerified,
  engineCacheIsolation,
  sharedOwnerVerified,
  appEmbeddedCatalog,
  storedCatalog,
  testFlightChanged: false,
};
writeFileSync(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(
  JSON.stringify({
    passed: true,
    cases: cases.length,
    available: cases.filter((c) => c.status === "available").length,
    operations,
    engineVersion: info.engineVersion,
  }),
);
