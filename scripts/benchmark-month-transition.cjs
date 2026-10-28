const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
// node --require tsx/cjs scripts/benchmark-month-transition.cjs --compare <preview-base>
const comparison = process.argv.indexOf("--compare");
if (comparison !== -1) {
  const ref = process.argv[comparison + 1];
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
    after.map(({ scenario, year, digest }) => ({ scenario, year, digest })),
    before.map(({ scenario, year, digest }) => ({ scenario, year, digest })),
  );
  console.log(JSON.stringify({ resultsIdentical: true, before, after }, null, 2));
  process.exit(0);
}
const { createHash } = require("node:crypto");
const path = require("node:path");
const root = process.cwd();
// Load the real pure boundary without importing native presentation components in Node.
const fs = require("node:fs");
const Module = require("node:module");
const ts = require(path.join(root, "node_modules/typescript"));
const boundaryPath = path.join(root, "src/features/analysis/rule-computation.tsx");
const source = ts.createSourceFile(
  boundaryPath,
  fs.readFileSync(boundaryPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const boundary = source.statements.find(
  (s) => ts.isFunctionDeclaration(s) && s.name?.text === "captureRuleComputation",
);
const pureModule = new Module(boundaryPath, module);
pureModule.filename = boundaryPath;
pureModule.paths = Module._nodeModulePaths(path.dirname(boundaryPath));
require.cache[boundaryPath] = pureModule;
pureModule._compile(
  ts.transpileModule(
    'import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";import { RuleResolutionError } from "@/rules/rule-resolver";' +
      boundary.getText(source),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  boundaryPath,
);
const baseline = process.argv.indexOf("--baseline");
if (baseline !== -1) {
  const ref = process.argv[baseline + 1];
  assert.match(ref, /^[0-9a-f]{7,40}$/i);
  for (const file of [
    "src/engine/monthly-summary.ts",
    "src/features/analysis/analysis-metrics.ts",
    "src/engine/compliance-sunday-holiday-rest.ts",
    "src/engine/compliance.ts",
    "src/features/analysis/monthly-analysis.ts",
  ]) {
    const filename = path.join(root, file);
    const previous = new Module(filename, module);
    previous.filename = filename;
    previous.paths = Module._nodeModulePaths(path.dirname(filename));
    require.cache[filename] = previous;
    previous._compile(
      ts.transpileModule(execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" }), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      filename,
    );
  }
}
const { generateTestPlan } = require(path.join(root, "src/engine/test-data-generator"));
const { forecastProfile, forecastShift } = require(
  path.join(root, "src/engine/net-pay-tvoed-forecast-test-fixtures"),
);
const { bundledRuleResolver: resolver } = require(path.join(root, "src/rules/rule-resolver"));
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS: pattern } = require(
  path.join(root, "src/engine/simple-pay"),
);
const { calculateMonthlyAnalysis, calculateMonthlyAnalysisSteps } = require(
  path.join(root, "src/features/analysis/monthly-analysis"),
);
const { calculateMonthlyComplianceSteps } = require(path.join(root, "src/engine/compliance"));
const { calculateMonthlySummary } = require(path.join(root, "src/engine/monthly-summary"));
const { buildMonthlyShiftTypeAnalysis } = require(
  path.join(root, "src/features/analysis/analysis-metrics"),
);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [];
for (const year of [2026, 2027])
  for (const scenario of ["NORMAL_ROTATION", "UI_STRESS"]) {
    const month = `${year}-09`;
    const plan = generateTestPlan({ startMonth: `${year}-01`, range: 12, scenario }, "NW");
    const current = plan.shifts.map((s, i) =>
      forecastShift({ ...s, id: `${scenario}-${i}`, templateId: s.templateId ?? null }),
    );
    const history = Array.from({ length: 10000 }, (_, i) => ({
      ...current[i % current.length],
      id: `old-${i}`,
      date: "2020-01-01",
    }));
    const entries = [...current, ...history];
    const overview = [],
      summary = [],
      types = [],
      chunks = [],
      completed = [];
    let result;
    for (let repeat = 0; repeat < 5; repeat++) {
      const start = performance.now();
      result = calculateMonthlyAnalysis(month, entries, forecastProfile, [], pattern, resolver);
      overview.push(performance.now() - start);
      let t = performance.now();
      calculateMonthlySummary(month, result.monthShifts, forecastProfile, resolver);
      summary.push(performance.now() - t);
      t = performance.now();
      buildMonthlyShiftTypeAnalysis(
        month,
        entries.filter((s) => s.date.startsWith(month)),
        forecastProfile,
        resolver,
      );
      types.push(performance.now() - t);
    }
    const shifts = result.complianceShifts.value;
    const start = performance.now();
    const steps = calculateMonthlyComplianceSteps(month, shifts, forecastProfile.timeZone, {
      employmentProfile: forecastProfile,
      federalState: forecastProfile.federalState,
      holidayRegion: forecastProfile.holidayRegion,
      weeklyMinutes: forecastProfile.weeklyMinutes,
      regularRotatingNightWork: forecastProfile.regularRotatingNightWork,
      sundayHolidayWorkEligible: forecastProfile.sundayHolidayWorkEligible,
      allEmploymentWorkRecorded: forecastProfile.allEmploymentWorkRecorded,
      referenceDate: `${year}-10-28`,
      ruleResolver: resolver,
      youthProtection: false,
    });
    while (true) {
      const t = performance.now();
      const s = steps.next();
      const duration = performance.now() - t;
      chunks.push(duration);
      if (duration > 8)
        completed.push({ index: chunks.length, yield: s.value, durationMs: +duration.toFixed(2) });
      if (s.done) {
        result = { overview: result, compliance: s.value };
        break;
      }
    }
    const complianceMs = performance.now() - start;
    const overviewChunks = [];
    if (calculateMonthlyAnalysisSteps) {
      const prepared = calculateMonthlyAnalysisSteps({
        month,
        entries,
        profile: forecastProfile,
        tariffDecisions: [],
        workPatternSettings: pattern,
        ruleResolver: { ...resolver },
      });
      while (true) {
        const t = performance.now();
        const next = prepared.next();
        overviewChunks.push(performance.now() - t);
        if (next.done) break;
      }
    }
    rows.push({
      scenario,
      year,
      entries: entries.length,
      complianceShifts: shifts.length,
      overviewFirstMs: overview[0],
      overviewMedianMs: median(overview),
      summaryMedianMs: median(summary),
      typesMedianMs: median(types),
      complianceMs,
      maxChunkMs: Math.max(...chunks),
      maxOverviewChunkMs: overviewChunks.length ? Math.max(...overviewChunks) : null,
      chunks: chunks.length,
      longChunks: completed.map((s) => ({
        ...s,
        yield: typeof s.yield === "object" ? "done" : s.yield,
      })),
      digest: hash(result),
    });
  }
console.log(JSON.stringify(rows, null, 2));
