// Shared overview/net preparation: pure CPU/results, no database, React or device timings.
// node --require tsx/cjs scripts/benchmark-salary-calculations.cjs --compare <base-commit>
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
    "Gross or annual-payment calculation changed",
  );
  console.log(JSON.stringify({ resultsIdentical: true, before, after }, null, 2));
} else {
  const baseline = process.argv.indexOf("--baseline");
  if (baseline !== -1) {
    const ref = process.argv[baseline + 1];
    assert.match(ref, /^[0-9a-f]{7,40}$/i);
    const Module = require("node:module");
    const ts = require("typescript");
    for (const relative of [
      "src/features/salary/salary-month-input.ts",
      "src/features/salary/annual-salary-proposal.ts",
    ]) {
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
  }
  const { generateTestPlan } = require("../src/engine/test-data-generator");
  const {
    forecastProfile,
    forecastShift,
  } = require("../src/engine/net-pay-tvoed-forecast-test-fixtures");
  const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } = require("../src/engine/simple-pay");
  const { bundledRuleResolver } = require("../src/rules/rule-resolver");
  const { salaryMonthInput } = require("../src/features/salary/salary-month-input");
  const { annualSalaryForecast } = require("../src/features/salary/annual-salary-forecast");
  const results = [];
  for (const scenario of ["NORMAL_ROTATION", "UI_STRESS"]) {
    const plan = generateTestPlan({ startMonth: "2026-01", range: 12, scenario }, "NW");
    const entries = plan.shifts.map((shift, index) =>
      forecastShift({
        ...shift,
        id: `salary-benchmark-${index}`,
        templateId: shift.templateId ?? null,
      }),
    );
    const context = {
      entries,
      tariffDecisions: [],
      workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
      resolver: bundledRuleResolver,
      testMonths: [],
    };
    const samples = [];
    let output;
    for (let sample = 0; sample < 7; sample++) {
      const started = performance.now();
      output = ["2026-09", "2026-10", "2026-11"].map((month) => ({
        overview: salaryMonthInput(month, forecastProfile, context),
        overviewAnnual: annualSalaryForecast(2026, forecastProfile, context),
        netBasis: salaryMonthInput(month, forecastProfile, context),
        netAnnual: annualSalaryForecast(2026, forecastProfile, context),
      }));
      samples.push(performance.now() - started);
    }
    const ordered = [...samples].sort((a, b) => a - b);
    results.push({
      key: scenario,
      digest: createHash("sha256").update(JSON.stringify(output)).digest("hex"),
      firstMs: +samples[0].toFixed(2),
      medianMs: +ordered[3].toFixed(2),
      samplesMs: samples.map((value) => +value.toFixed(2)),
    });
  }
  console.log(JSON.stringify(results, null, 2));
}
