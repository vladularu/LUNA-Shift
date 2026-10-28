// node --require tsx/cjs scripts/benchmark-persisted-analysis.cjs --output-dir <artifact-directory>
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module");
const { execFileSync } = require("node:child_process"),
  { createHash } = require("node:crypto");
const assert = require("node:assert/strict"),
  clock = require("node:perf_hooks").performance;
const root = process.cwd(),
  ts = require("typescript");
const mode = process.argv[2];
if (mode === "--output-dir") {
  const output = path.resolve(process.argv[3]);
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const family of ["TVL", "TVUK", "VKA"])
    for (let repetition = 1; repetition <= 3; repetition++) {
      const database = path.join(output, `${family}-${Date.now()}-${repetition}.sqlite`);
      const run = (task) =>
        JSON.parse(
          execFileSync(
            process.execPath,
            ["--require", "tsx/cjs", __filename, task, family, database],
            { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
          ),
        );
      const cold = run("--calculate"),
        reopened = run("--read");
      assert.equal(cold.digest, reopened.digest);
      results.push({ family, repetition, cold, reopened });
    }
  console.log(
    JSON.stringify(
      {
        resultsIdentical: true,
        results,
        limits:
          "Fresh Node processes, real SQLite and SHA-256, 11,008 entries. Includes input-key formation and catalog hashing. Excludes app boot, React, native crypto bridge, SQLCipher and iPhone frames. This measures retained successful results in the same app version; the first computation is still necessary.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
assert.ok(["--calculate", "--read"].includes(mode));
// Reuse the real error boundary's pure capture function without importing native UI in Node.
const boundaryPath = path.join(root, "src/features/analysis/rule-computation.tsx");
const source = ts.createSourceFile(
  boundaryPath,
  fs.readFileSync(boundaryPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const capture = source.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "captureRuleComputation",
);
const shim = new Module(boundaryPath, module);
shim.filename = boundaryPath;
shim.paths = Module._nodeModulePaths(path.dirname(boundaryPath));
require.cache[boundaryPath] = shim;
shim._compile(
  ts.transpileModule(
    'import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";import { RuleResolutionError } from "@/rules/rule-resolver";' +
      capture.getText(source),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  boundaryPath,
);

const Database = require("better-sqlite3"),
  database = new Database(process.argv[4]);
const db = {
  execAsync: async (sql) => {
    database.exec(sql);
  },
  runAsync: async (sql, ...params) => database.prepare(sql).run(...params),
  getFirstAsync: async (sql, ...params) => database.prepare(sql).get(...params) ?? null,
};
const from = (file) => require(path.join(root, file));
const { forecastProfile, forecastShift } = from("src/engine/net-pay-tvoed-forecast-test-fixtures");
const { automatedSettings } = from("src/domain/net-pay-automation-test-fixtures");
const { createRuleResolver } = from("src/rules/rule-resolver");
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS: pattern } = from("src/engine/simple-pay");
const monthly = from("src/features/analysis/monthly-analysis"),
  salary = from("src/features/analysis/analysis-salary");
const { calculateMonthlyComplianceSteps } = from("src/engine/compliance");
const { createAnalysisResultRepository } = from(
  "src/infrastructure/database/analysis-result-repository",
);
const { createPersistentAnalysisCache } = from("src/features/analysis/persistent-analysis-cache");
const { persistentMonthValue, persistentCheckValue, persistentSalaryValue } = from(
  "src/features/analysis/persistent-analysis-values",
);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const drain = (steps) => {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};
async function main() {
  const family = process.argv[3],
    base = { ...forecastProfile, tariff: null };
  const profile =
    family === "TVL"
      ? { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } }
      : family === "TVUK"
        ? { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }
        : {
            ...base,
            vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
          };
  const entries = [];
  for (let month = 1; month <= 12; month++)
    for (let day = 1; day <= 28; day++)
      for (let part = 0; part < 3; part++)
        entries.push(
          forecastShift({
            id: `${month}-${day}-${part}`,
            date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            type: "DAY",
            startTime: ["07:00", "12:00", "18:00"][part],
            endTime: ["11:00", "16:00", "22:00"][part],
            breakMinutes: 0,
          }),
        );
  for (let i = 0; i < 10000; i++)
    entries.push({ ...entries[0], id: `archive-${i}`, date: "2010-01-01" });
  const resolver = createRuleResolver(),
    month = "2026-10",
    request = {
      month,
      profile,
      entries,
      tariffDecisions: [],
      workPatternSettings: pattern,
      ruleResolver: resolver,
    };
  const payInput = {
    month,
    profile,
    settings: automatedSettings("2026-01"),
    annualPayments: [],
    context: {
      entries,
      tariffDecisions: [],
      workPatternSettings: pattern,
      resolver,
      testMonths: [],
    },
  };
  const store = createPersistentAnalysisCache({
    repository: createAnalysisResultRepository(db, () => month),
    sha256: async (text) => hash(text),
    bundleId: "same-app-version-benchmark",
    lookupTimeoutMs: 1000,
  });
  const begin = clock.now(),
    monthKey = monthly.inspectMonthlyAnalysis(request).key,
    payKey = salary.analysisSalaryKey(payInput),
    keysMs = clock.now() - begin;
  let overview,
    checks,
    pay,
    calculationMs = 0,
    storeMs = 0;
  if (mode === "--calculate") overview = drain(monthly.calculateMonthlyAnalysisSteps(request));
  else overview = await store.read("month", month, monthKey, resolver, persistentMonthValue);
  assert.ok(overview);
  assert.ok(overview.complianceShifts.ok);
  const shifts = overview.complianceShifts.value,
    referenceDate = "2026-10-28";
  const checkKey = JSON.stringify([month, profile, referenceDate, shifts, false]);
  if (mode === "--calculate") {
    checks = drain(
      calculateMonthlyComplianceSteps(month, shifts, profile.timeZone, {
        employmentProfile: profile,
        federalState: profile.federalState,
        holidayRegion: profile.holidayRegion,
        weeklyMinutes: profile.weeklyMinutes,
        regularRotatingNightWork: profile.regularRotatingNightWork,
        sundayHolidayWorkEligible: profile.sundayHolidayWorkEligible,
        allEmploymentWorkRecorded: profile.allEmploymentWorkRecorded,
        referenceDate,
        ruleResolver: resolver,
        youthProtection: false,
      }),
    );
    pay = drain(salary.prepareAnalysisSalarySteps(payInput, payKey));
    calculationMs = clock.now() - begin;
    const save = clock.now();
    await store.write("month", month, monthKey, resolver, overview, persistentMonthValue);
    await store.write("checks", month, checkKey, resolver, checks, persistentCheckValue);
    await store.write("salary", month, payKey, resolver, pay, persistentSalaryValue);
    storeMs = clock.now() - save;
  } else {
    checks = await store.read("checks", month, checkKey, resolver, persistentCheckValue);
    pay = await store.read("salary", month, payKey, resolver, persistentSalaryValue);
  }
  assert.ok(checks);
  assert.ok(pay);
  const elapsedMs = clock.now() - begin;
  const digest = hash(JSON.stringify({ overview, checks, pay }));
  const cacheTable = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('analysis_result_cache_v1','analysis_result_cache_v2') ORDER BY name DESC LIMIT 1",
    )
    .get().name;
  const bytes = database
    .prepare(`SELECT SUM(length(CAST(value_json AS BLOB))) AS bytes FROM ${cacheTable}`)
    .get().bytes;
  database.close();
  console.log(
    JSON.stringify({
      mode,
      entries: entries.length,
      keysMs,
      calculationMs,
      storeMs,
      elapsedMs,
      payloadBytes: bytes,
      digest,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
