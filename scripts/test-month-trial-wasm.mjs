import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

const [bindings, corpusPath, output] = process.argv.slice(2).map((p) => path.resolve(p));
if (!bindings || !corpusPath || !output) throw new Error("EXPECTED_BINDINGS_CORPUS_OUTPUT");
mkdirSync(output, { recursive: true });
const entry = path.join(output, "month-bridge.cjs");
await build({
  stdin: {
    contents: `export * from './src/features/analysis/monthly-rust-bridge';
      export {bundledRuleResolver} from './src/rules/rule-resolver';
      export {mapShift} from './src/infrastructure/database/calendar-entry-row';
      export {mapProfileRow} from './src/infrastructure/database/profile-row';
      export {createWorkingTimeCalculationProfile} from './src/engine/working-time-calculation-profile';
      export {calculateMonthlyAnalysis} from './src/features/analysis/monthly-analysis';
      export {createStoredMonthlyRustCalculator} from './src/features/analysis/monthly-rust-source';
      export {migrateDatabase} from './src/infrastructure/database/migrations';
      export {loadRuleCatalogRuntime} from './src/application/rule-catalog-runtime';
      export {reviewedCatalogSnapshot} from './src/testing/reviewed-rule-catalog-fixtures';
      export {canonicalizeRuleJson} from './src/rules/rule-catalog-verification';
      export {loadActiveRuleCatalog} from './src/infrastructure/database/rule-catalog-repository';
      export {createAnalysisResultRepository} from './src/infrastructure/database/analysis-result-repository';
      export {createPersistentAnalysisCache} from './src/features/analysis/persistent-analysis-cache';
      export {persistentMonthValue} from './src/features/analysis/persistent-analysis-values';
      export {inspectMonthlyAnalysis} from './src/features/analysis/monthly-analysis';`,
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
      name: "pure-original-rule-capture",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]rule-computation\.tsx$/ }, ({ path: file }) => {
          const source = readFileSync(file, "utf8");
          const start = source.indexOf("export interface RuleComputationFailure");
          const end = source.indexOf("function ruleFailureMessage");
          assert.ok(start >= 0 && end > start, "Original pure capture span must exist");
          return {
            loader: "ts",
            resolveDir: path.dirname(file),
            contents:
              'import {WorkingTimeTargetError} from "@/domain/working-time-target-validation";\n' +
              'import {RuleResolutionError,type RuleResolutionFailure} from "@/rules/rule-resolver";\n' +
              source.slice(start, end),
          };
        });
      },
    },
  ],
});
const require = createRequire(import.meta.url);
const native = require(bindings);
const api = require(entry);
const info = JSON.parse(native.engineInvoke("info", ""));
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
assert.equal(
  corpus.sourceDigest,
  "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9",
);
const operations = [];
const transport = {
  expectedEngineVersion: info.engineVersion,
  async invoke(operation, json) {
    operations.push(operation);
    const result = native.engineInvoke(operation, json);
    if (process.env.LUNA_MONTH_TRIAL_DEBUG === "1" && JSON.parse(result).ok !== true)
      console.log(JSON.stringify({ operation, reply: JSON.parse(result) }));
    const reply = JSON.parse(result);
    if (operation === "runFinance" && reply.result)
      for (const report of reply.result.reports) delete report.views;
    return JSON.stringify(reply);
  },
  async source(header, body) {
    return native.engineInvokeSource(header, body);
  },
  async calendarRanks(header, body) {
    return native.engineInvokeCalendarRanks(header, body);
  },
  async catalogFinalize(header, body) {
    return native.engineInvokeCatalogFinalize(header, body);
  },
};
const calculate = api.createMonthlyRustBridge(transport);
const ready = (value) => ({
  state: "READY",
  revision: 1,
  coverage: { kind: "ALL_HISTORY" },
  payload: { schemaVersion: 1, data: { kind: "VALUE", value } },
});
const cases = [];
const concurrentCases = [];
let hookCaseSaved = false;
let storedTestCase;
for (const c of corpus.cases.filter((c) => c.input.period.kind === "MONTH")) {
  const i = c.input;
  const request = {
    month: i.period.month,
    profile: api.createWorkingTimeCalculationProfile(
      api.mapProfileRow(i.profile.profileRow),
      null,
      [],
    ),
    entries: i.shiftRows.map(api.mapShift),
    tariffDecisions: [],
    workPatternSettings: undefined,
    ruleResolver: api.bundledRuleResolver,
  };
  const sources = {
    WORK_PROFILE: i.profile,
    REMUNERATION_PROFILES: i.historyRows,
    WORK_PATTERN_SETTINGS: i.patternRows,
    CALENDAR_ENTRIES: {
      shiftRows: i.shiftRows,
      appointmentRows: [],
      platformCollationRanks: i.platformCollationRanks,
    },
    WORKING_TIME_TARGET:
      i.targetRow === null
        ? null
        : {
            ...Object.fromEntries(
              Object.entries(i.targetRow).filter(([k]) => k !== "settings_json"),
            ),
            settings_json_chunks: [i.targetRow.settings_json],
          },
    YOUTH_PREFERENCE: { value: i.youthProtection ? "true" : "false" },
    LEGACY_TARIFF_DECISIONS: [],
    TEST_MONTHS: [],
    ACTUAL_ANNUAL_PAYMENTS: [],
    TARIFF_ANNUAL_CLAIMS: [],
    ...(i.trainingRequested
      ? { TRAINING_PROFILES: i.trainingProfileRows, TRAINING_SHIFT_DETAILS: i.trainingDetailRows }
      : {}),
  };
  const inputs = {
    referenceDate: i.referenceDate,
    sources,
    catalogs: {
      current: {
        selectedPackageIds: {
          tariff: ["tvoed-p-vka-legacy"],
          legal: ["de-arbzg-care-legacy"],
          holiday: ["de-holidays-legacy"],
        },
        tariff: ready({ mode: "COMPILED_LEGACY" }),
        legal: ready({ mode: "COMPILED_LEGACY" }),
        holiday: ready({ mode: "COMPILED_LEGACY" }),
      },
      history: [],
    },
  };
  const start = performance.now();
  const value = await calculate(request, inputs);
  const normalized = JSON.parse(JSON.stringify(value));
  assert.deepEqual(normalized, c.expected.monthlyAnalysis, c.id);
  if (concurrentCases.length === 0 || (concurrentCases.length === 1 && request.entries.length))
    concurrentCases.push({ request, inputs, expected: normalized });
  cases.push({ id: c.id, milliseconds: performance.now() - start });
  if (
    cases.length === 1 ||
    (!hookCaseSaved &&
      request.entries.length &&
      normalized.pay.value.available &&
      i.historyRows.length === 0 &&
      !i.trainingRequested)
  ) {
    writeFileSync(
      path.join(output, "native-month-for-hook.json"),
      JSON.stringify(
        {
          request: { ...request, ruleResolver: undefined },
          value: normalized,
          engineVersion: info.engineVersion,
          id: c.id,
        },
        null,
        2,
      ),
    );
    if (request.entries.length && normalized.pay.value.available) hookCaseSaved = true;
    if (hookCaseSaved) storedTestCase ??= { c, request, value: normalized };
  }
}
assert.equal(
  api.createMonthlyRustBridge(transport),
  calculate,
  "All month pages share one native owner queue",
);
await Promise.all(
  concurrentCases.map(async (item) => {
    const actual = await api.createMonthlyRustBridge(transport)(item.request, item.inputs);
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      item.expected,
      "Parallel page requests stay correctly bound",
    );
  }),
);
assert.ok(storedTestCase, "A nonempty month with actual salary must be exercised");
const sql = new DatabaseSync(":memory:");
const flatten = (args) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
let reads = 0;
const db = {
  async getFirstAsync(text, ...args) {
    reads++;
    return sql.prepare(text).get(...flatten(args)) ?? null;
  },
  async getAllAsync(text, ...args) {
    reads++;
    return sql.prepare(text).all(...flatten(args));
  },
  async runAsync(text, ...args) {
    const r = sql.prepare(text).run(...flatten(args));
    return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
  },
  async execAsync(text) {
    sql.exec(text);
  },
};
await api.migrateDatabase(db);
const insert = (table, row) => {
  const keys = Object.keys(row);
  sql
    .prepare(
      `INSERT OR REPLACE INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    )
    .run(...keys.map((k) => row[k]));
};
const { c: stored, request: storedRequest, value: storedExpected } = storedTestCase;
insert("user_profile", { id: "singleton", ...stored.input.profile.profileRow });
for (const row of stored.input.profile.salaryRows)
  insert("app_preferences", { updated_at: "2026-01-01T00:00:00Z", ...row });
for (const row of stored.input.shiftRows) insert("shift_entries", row);
const beforeNative = operations.length;
const sqlStart = performance.now();
const storedValue = await api.createStoredMonthlyRustCalculator(db, transport, {
  source: "LEGACY_EMBEDDED",
  activeGeneration: null,
  selectedGeneration: null,
  keyId: null,
  fallbackReason: null,
})(storedRequest);
const rustRoundTripMs = performance.now() - sqlStart;
assert.deepEqual(
  JSON.parse(JSON.stringify(storedValue)),
  storedExpected,
  "Existing SQLite -> Rust -> old month DTO",
);
const originalValue = api.calculateMonthlyAnalysis(
  storedRequest.month,
  storedRequest.entries,
  storedRequest.profile,
  storedRequest.tariffDecisions,
  storedRequest.workPatternSettings,
  storedRequest.ruleResolver,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(storedValue)),
  JSON.parse(JSON.stringify(originalValue)),
  "Fresh original TS calculation parity",
);
const editedRequest = {
  ...storedRequest,
  entries: storedRequest.entries.map((entry, index) =>
    index === 0 ? { ...entry, endTime: "15:00", revision: entry.revision + 1 } : entry,
  ),
};
sql
  .prepare("UPDATE shift_entries SET end_time=?,revision=? WHERE id=?")
  .run("15:00", editedRequest.entries[0].revision, editedRequest.entries[0].id);
const editedValue = await api.createStoredMonthlyRustCalculator(db, transport, {
  source: "LEGACY_EMBEDDED",
  activeGeneration: null,
  selectedGeneration: null,
  keyId: null,
  fallbackReason: null,
})(editedRequest);
const originalEdited = api.calculateMonthlyAnalysis(
  editedRequest.month,
  editedRequest.entries,
  editedRequest.profile,
  editedRequest.tariffDecisions,
  editedRequest.workPatternSettings,
  editedRequest.ruleResolver,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(editedValue)),
  JSON.parse(JSON.stringify(originalEdited)),
  "End-time edit must match fresh old TypeScript results",
);
assert.notEqual(
  editedValue.summary.value.actualMinutes,
  storedValue.summary.value.actualMinutes,
  "Edit must change time",
);
writeFileSync(
  path.join(output, "native-month-for-hook.json"),
  JSON.stringify(
    {
      request: { ...storedRequest, ruleResolver: undefined },
      value: storedValue,
      edited: { request: { ...editedRequest, ruleResolver: undefined }, value: editedValue },
      engineVersion: info.engineVersion,
      id: stored.id,
    },
    null,
    2,
  ) + "\n",
);
const sqliteProof = {
  passed: true,
  case: stored.id,
  reads,
  nativeOperations: operations.length - beforeNative,
  rustRoundTripMs,
  changedEndTimeVerified: true,
};
const embedded = (await api.loadRuleCatalogRuntime(async () => null)).runtime;
const embeddedRequest = { ...editedRequest, ruleResolver: embedded.resolver };
const embeddedCalculator = api.createStoredMonthlyRustCalculator(db, transport, embedded.diagnosis);
const embeddedValue = await embeddedCalculator(embeddedRequest);
const embeddedOriginal = api.calculateMonthlyAnalysis(
  embeddedRequest.month,
  embeddedRequest.entries,
  embeddedRequest.profile,
  embeddedRequest.tariffDecisions,
  embeddedRequest.workPatternSettings,
  embeddedRequest.ruleResolver,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(embeddedValue)),
  JSON.parse(JSON.stringify(embeddedOriginal)),
  "Actual app-embedded catalog parity",
);
const cacheRequest = api.monthlyRustRequest(embeddedRequest, embeddedCalculator);
const cacheKey = api.inspectMonthlyAnalysis(cacheRequest).key;
const sha256 = async (text) => createHash("sha256").update(text).digest("hex");
const storedCache = () =>
  api.createPersistentAnalysisCache({
    bundleId: "package1-real-engine-cache",
    sha256,
    repository: api.createAnalysisResultRepository(db, () => embeddedRequest.month),
  });
await storedCache().write(
  "month",
  embeddedRequest.month,
  cacheKey,
  embeddedRequest.ruleResolver,
  embeddedValue,
  api.persistentMonthValue,
);
assert.deepEqual(
  await storedCache().read(
    "month",
    embeddedRequest.month,
    cacheKey,
    embeddedRequest.ruleResolver,
    api.persistentMonthValue,
  ),
  embeddedValue,
  "Cold cache must restore a real Rust result",
);
const otherKey = api.inspectMonthlyAnalysis({
  ...cacheRequest,
  calculationIdentity: "another-engine",
}).key;
assert.equal(
  await storedCache().read(
    "month",
    embeddedRequest.month,
    otherKey,
    embeddedRequest.ruleResolver,
    api.persistentMonthValue,
  ),
  null,
  "A different engine must not reuse the saved result",
);
sqliteProof.appEmbeddedCatalog = true;
sqliteProof.engineBoundColdCache = true;
// Test-only database: exercise the real stored-artifact reader and resolver.
// This does not activate a catalog or change any app/user database.
const catalogFixture = api.reviewedCatalogSnapshot(7);
const timestamp = "2026-11-15T00:00:00.000Z";
insert("rule_catalog_generations", {
  generation: 7,
  manifest_json: api.canonicalizeRuleJson(catalogFixture.catalog.manifest),
  activated_at: timestamp,
});
for (const item of catalogFixture.catalog.packages)
  insert("rule_catalog_packages", {
    generation: 7,
    package_id: item.packageId,
    version_id: item.versionId,
    kind: item.kind,
    payload_json: api.canonicalizeRuleJson(item),
  });
insert("rule_catalog_state", { id: "active", active_generation: 7, updated_at: timestamp });
const storedRuntime = (await api.loadRuleCatalogRuntime(() => api.loadActiveRuleCatalog(db)))
  .runtime;
assert.equal(storedRuntime.diagnosis.source, "STORED");
const externalRequest = { ...editedRequest, ruleResolver: storedRuntime.resolver };
const externalValue = await api.createStoredMonthlyRustCalculator(
  db,
  transport,
  storedRuntime.diagnosis,
)(externalRequest);
assert.deepEqual(
  JSON.parse(JSON.stringify(externalValue)),
  JSON.parse(
    JSON.stringify(
      api.calculateMonthlyAnalysis(
        externalRequest.month,
        externalRequest.entries,
        externalRequest.profile,
        externalRequest.tariffDecisions,
        externalRequest.workPatternSettings,
        externalRequest.ruleResolver,
      ),
    ),
  ),
  "Stored catalog via original SQLite artifacts must match the original TypeScript resolver",
);
sqliteProof.storedCatalog = true;
sql.close();
const proof = {
  passed: true,
  cases,
  operations,
  engineVersion: info.engineVersion,
  corpusSha256: createHash("sha256").update(readFileSync(corpusPath)).digest("hex"),
  sourceDigest: corpus.sourceDigest,
  sqlite: sqliteProof,
  viewsConsumed: false,
  concurrentMonthRequests: concurrentCases.length,
  testFlightChanged: false,
};
writeFileSync(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
console.log(
  JSON.stringify({
    passed: true,
    months: cases.length,
    engineVersion: info.engineVersion,
    operations: operations.length,
  }),
);
