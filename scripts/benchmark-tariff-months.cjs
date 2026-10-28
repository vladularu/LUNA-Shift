// node --require tsx/cjs scripts/benchmark-tariff-months.cjs --compare <saved-phase3-directory>
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module");
const assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process"),
  { createHash } = require("node:crypto");
const root = process.cwd(),
  base = "6b571f85d453c09ea50756e13299231e0883bda4";
const compare = process.argv.indexOf("--compare");
if (compare !== -1) {
  const snapshot = path.resolve(process.argv[compare + 1]);
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, ["--require", "tsx/cjs", __filename, ...args], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  const before = run(["--baseline", snapshot]),
    after = run([]);
  assert.deepEqual(
    after.map(({ name, digest }) => ({ name, digest })),
    before.map(({ name, digest }) => ({ name, digest })),
  );
  console.log(
    JSON.stringify(
      {
        resultsIdentical: true,
        before,
        after,
        limits:
          "Synthetic Node CPU only, no SQLite, React, scheduler waiting or iPhone frames. Complete monthly overview, annual payment and net results are hashed.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const ts = require("typescript");
const compile = (file, source) => {
  const filename = path.join(root, file),
    loaded = require.cache[filename] ?? new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = loaded;
  loaded._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
};
// Keep the exact pure rule boundary without importing native presentation modules in Node.
const boundaryPath = "src/features/analysis/rule-computation.tsx";
const boundarySource = ts.createSourceFile(
  boundaryPath,
  fs.readFileSync(path.join(root, boundaryPath), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const boundary = boundarySource.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "captureRuleComputation",
);
compile(
  boundaryPath,
  'import { WorkingTimeTargetError } from "@/domain/working-time-target-validation"; import { RuleResolutionError } from "@/rules/rule-resolver";' +
    boundary.getText(boundarySource),
);
const baseline = process.argv.indexOf("--baseline");
if (baseline !== -1) {
  const snapshot = path.resolve(process.argv[baseline + 1]);
  const files = [
    "src/engine/simple-tvl-family-shift.ts",
    "src/engine/simple-tvl-kr-pay.ts",
    "src/engine/simple-tvuk-nursing-pay.ts",
    "src/features/analysis/analysis-result-cache.ts",
    "src/features/salary/salary-month-input.ts",
    "src/features/salary/annual-salary-proposal-cache.ts",
    "src/features/salary/annual-salary-proposal.ts",
    "src/features/salary/annual-salary-forecast.ts",
    "src/features/salary/automatic-net-pay-preparation.ts",
    "src/features/analysis/analysis-salary.ts",
    "src/features/analysis/monthly-analysis.ts",
  ];
  for (const file of files) {
    const filename = path.join(root, file);
    require.cache[filename] = new Module(filename, module);
  }
  for (const file of files) {
    const saved = path.join(snapshot, file);
    compile(
      file,
      fs.existsSync(saved)
        ? fs.readFileSync(saved, "utf8")
        : execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }),
    );
  }
}
const { forecastProfile, forecastShift } = require(
  path.join(root, "src/engine/net-pay-tvoed-forecast-test-fixtures"),
);
const { bundledRuleResolver } = require(path.join(root, "src/rules/rule-resolver"));
const { automatedSettings } = require(
  path.join(root, "src/domain/net-pay-automation-test-fixtures"),
);
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } = require(path.join(root, "src/engine/simple-pay"));
const { calculateMonthlyAnalysisSteps, getCachedMonthlyAnalysis } = require(
  path.join(root, "src/features/analysis/monthly-analysis"),
);
const { prepareAnalysisSalarySteps, analysisSalaryKey, readAnalysisSalary } = require(
  path.join(root, "src/features/analysis/analysis-salary"),
);
const drain = (steps) => {
  const durations = [];
  while (true) {
    const start = performance.now(),
      next = steps.next();
    durations.push(performance.now() - start);
    if (next.done)
      return {
        value: next.value,
        maximumStepMs: Math.max(...durations),
        cpuMs: durations.reduce((a, b) => a + b, 0),
        steps: durations.length,
      };
  }
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rows = [];
for (const family of ["TVL_KR", "TVUK"])
  for (const perDay of [1, 3])
    for (const month of ["2026-10", "2027-01"]) {
      const profile =
        family === "TVL_KR"
          ? {
              ...forecastProfile,
              tariff: null,
              tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
            }
          : {
              ...forecastProfile,
              tariff: null,
              federalState: "BW",
              tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
            };
      const year = Number(month.slice(0, 4)),
        resolver = { ...bundledRuleResolver };
      const entries = [];
      for (const selected of [7, 8, 9, 10, 11, 1])
        for (let day = 1; day <= 28; day++)
          for (let part = 0; part < perDay; part++)
            entries.push(
              forecastShift({
                id: `${selected}-${day}-${part}`,
                date: `${year}-${String(selected).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                allDay: false,
                type: perDay === 1 ? "NIGHT" : "DAY",
                startTime: perDay === 1 ? "21:00" : ["07:00", "12:00", "18:00"][part],
                endTime: perDay === 1 ? "07:00" : ["11:00", "16:00", "22:00"][part],
                breakMinutes: perDay === 1 ? 60 : 0,
              }),
            );
      for (let i = 0; i < 10000; i++)
        entries.push({ ...entries[0], id: `history-${i}`, date: "2010-01-01" });
      const request = {
        month,
        profile,
        entries,
        tariffDecisions: [],
        workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
        ruleResolver: resolver,
      };
      const salaryRequest = {
        month,
        profile,
        settings: automatedSettings(`${year}-01`),
        annualPayments: [],
        context: {
          entries,
          tariffDecisions: [],
          workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
          resolver,
          testMonths: [],
        },
      };
      const overview = drain(calculateMonthlyAnalysisSteps(request));
      const salary = drain(
        prepareAnalysisSalarySteps(salaryRequest, analysisSalaryKey(salaryRequest)),
      );
      const started = performance.now();
      const cachedOverview = getCachedMonthlyAnalysis(request),
        salaryKey = analysisSalaryKey(salaryRequest),
        cachedSalary = readAnalysisSalary(salaryRequest, salaryKey);
      const cachedMs = performance.now() - started;
      assert.equal(overview.value.pay.ok && overview.value.pay.value.available, true);
      assert.ok(cachedOverview !== null);
      if (year === 2026) assert.equal(salary.value.forecast.result.status, "available");
      rows.push({
        name: `${family}-${perDay}x-${month}`,
        entries: entries.length,
        digest: hash({ overview: overview.value, salary: salary.value }),
        overviewCpuMs: overview.cpuMs,
        overviewMaximumStepMs: overview.maximumStepMs,
        salaryCpuMs: salary.cpuMs,
        salaryMaximumStepMs: salary.maximumStepMs,
        cachedMs,
        completeSalaryReused: cachedSalary !== null,
      });
    }
console.log(JSON.stringify(rows, null, 2));
