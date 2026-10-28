// Pure CPU/result comparison; no database, React, native paging or iPhone timings.
// node --require tsx/cjs scripts/benchmark-monthly-analysis.cjs --compare <base-commit>
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const path = require("node:path");

const compare = process.argv.indexOf("--compare");
if (compare !== -1) {
  const ref = process.argv[compare + 1];
  assert.match(ref, /^[0-9a-f]{7,40}$/i);
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, ["--require", "tsx/cjs", __filename, ...args], {
        encoding: "utf8",
      }),
    );
  const before = run(["--baseline", ref]);
  const after = run([]);
  assert.deepEqual(
    after.map(({ key, digest }) => ({ key, digest })),
    before.map(({ key, digest }) => ({ key, digest })),
    "Monthly time ledgers or shift-type results changed",
  );
  console.log(JSON.stringify({ resultsIdentical: true, before, after }, null, 2));
} else {
  const baseline = process.argv.indexOf("--baseline");
  if (baseline !== -1) {
    const ref = process.argv[baseline + 1];
    assert.match(ref, /^[0-9a-f]{7,40}$/i);
    const Module = require("node:module");
    const ts = require("typescript");
    const relative = "src/engine/working-time-target.ts";
    const filename = path.resolve(relative);
    const source = execFileSync("git", ["show", `${ref}:${relative}`], { encoding: "utf8" });
    const baselineModule = new Module(filename, module.parent);
    baselineModule.filename = filename;
    baselineModule.paths = Module._nodeModulePaths(path.dirname(filename));
    require.cache[filename] = baselineModule;
    baselineModule._compile(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      filename,
    );
    baselineModule.loaded = true;
  }
  const { generateTestPlan } = require("../src/engine/test-data-generator");
  const {
    forecastProfile,
    forecastShift,
  } = require("../src/engine/net-pay-tvoed-forecast-test-fixtures");
  const {
    createWorkingTimeCalculationProfile,
  } = require("../src/engine/working-time-calculation-profile");
  const { calculateMonthlySummary } = require("../src/engine/monthly-summary");
  const { buildMonthlyShiftTypeAnalysis } = require("../src/features/analysis/analysis-metrics");
  const { calculateMonthlyWorkingTimeTarget } = require("../src/engine/working-time-target");
  const results = [];
  for (const year of [2026, 2027]) {
    for (const scenario of ["NORMAL_ROTATION", "UI_STRESS"]) {
      const month = `${year}-07`;
      const plan = generateTestPlan({ startMonth: `${year}-01`, range: 12, scenario }, "NW");
      const entries = plan.shifts
        .map((shift, index) =>
          forecastShift({
            ...shift,
            id: `benchmark-${index}`,
            templateId: shift.templateId ?? null,
          }),
        )
        .filter((shift) => shift.date.startsWith(month));
      const profile = createWorkingTimeCalculationProfile(
        forecastProfile,
        null,
        [],
        "ready",
        [],
        false,
      );
      const samples = [];
      let output;
      for (let sample = 0; sample < 7; sample++) {
        const started = performance.now();
        output = {
          summary: calculateMonthlySummary(month, entries, profile),
          shiftTypes: buildMonthlyShiftTypeAnalysis(month, entries, profile),
          ledger: calculateMonthlyWorkingTimeTarget(month, profile),
        };
        samples.push(performance.now() - started);
      }
      const ordered = [...samples].sort((a, b) => a - b);
      results.push({
        key: `${scenario}/${year}`,
        digest: createHash("sha256").update(JSON.stringify(output)).digest("hex"),
        firstMs: +samples[0].toFixed(2),
        medianMs: +ordered[3].toFixed(2),
        samplesMs: samples.map((value) => +value.toFixed(2)),
      });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}
