// node --require tsx/cjs scripts/benchmark-analysis-salary.cjs --compare <saved-phase2-directory>
// Actual published JS sources in the snapshot take precedence over the unchanged Git base.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const root = process.cwd();
const base = "6b571f85d453c09ea50756e13299231e0883bda4";
const compare = process.argv.indexOf("--compare");
if (compare !== -1) {
  const snapshot = path.resolve(process.argv[compare + 1]);
  assert.ok(fs.statSync(snapshot).isDirectory());
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, ["--require", "tsx/cjs", __filename, ...args], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  const before = run(["--baseline", snapshot]);
  const after = run([]);
  assert.deepEqual(
    after.map(({ name, digest }) => ({ name, digest })),
    before.map(({ name, digest }) => ({ name, digest })),
  );
  console.log(
    JSON.stringify(
      {
        resultsIdentical: true,
        base,
        before,
        after,
        limits:
          "Synthetic Node CPU times. Includes full annual/gross/net preparation and key lookup, excludes SQLite, scheduler waiting, React and iPhone frame times.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const baseline = process.argv.indexOf("--baseline");
if (baseline !== -1) {
  const snapshot = path.resolve(process.argv[baseline + 1]);
  const ts = require("typescript");
  // Insert all module placeholders before compiling dependencies. Each case runs in a separate process.
  const files = [
    "src/engine/net-pay-sfn.ts",
    "src/features/salary/salary-month-input.ts",
    "src/features/salary/annual-salary-proposal-cache.ts",
    "src/features/salary/annual-salary-proposal.ts",
    "src/features/salary/annual-salary-forecast.ts",
    "src/engine/net-pay-automatic-forecast.ts",
    "src/engine/net-pay-automatic-cache.ts",
  ];
  const previous = files.map((file) => {
    const filename = path.join(root, file);
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    require.cache[filename] = loaded;
    const saved = path.join(snapshot, file);
    const source = fs.existsSync(saved)
      ? fs.readFileSync(saved, "utf8")
      : execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
    return { loaded, source, filename };
  });
  for (const { loaded, source, filename } of previous)
    loaded._compile(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      filename,
    );
}
const { generateTestPlan } = require(path.join(root, "src/engine/test-data-generator"));
const { forecastProfile, forecastShift } = require(
  path.join(root, "src/engine/net-pay-tvoed-forecast-test-fixtures"),
);
const { automatedSettings } = require(
  path.join(root, "src/domain/net-pay-automation-test-fixtures"),
);
const { bundledRuleResolver } = require(path.join(root, "src/rules/rule-resolver"));
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } = require(path.join(root, "src/engine/simple-pay"));
const { annualSalaryForecast } = require(
  path.join(root, "src/features/salary/annual-salary-forecast"),
);
const { salaryMonthInput } = require(path.join(root, "src/features/salary/salary-month-input"));
const { calculateAutomaticNetPayForecast } = require(
  path.join(root, "src/engine/net-pay-automatic-forecast"),
);
const { createAutomaticNetPayCache } = require(
  path.join(root, "src/engine/net-pay-automatic-cache"),
);
const preparation =
  baseline === -1 ? require(path.join(root, "src/features/analysis/analysis-salary")) : null;
const netCache = createAutomaticNetPayCache();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const output = [];
for (const year of [2026, 2027])
  for (const scenario of ["NORMAL_ROTATION", "DENSE_VALID", "UI_STRESS"])
    for (const selectedMonth of [9, 10, 11]) {
      const month = `${year}-${String(selectedMonth).padStart(2, "0")}`;
      const plan = generateTestPlan(
        {
          startMonth: `${year}-01`,
          range: 12,
          scenario: scenario === "DENSE_VALID" ? "NORMAL_ROTATION" : scenario,
        },
        "NW",
      );
      const shifts =
        scenario === "DENSE_VALID"
          ? plan.shifts.flatMap((shift) => [
              { ...shift, startTime: "07:00", endTime: "11:00", breakMinutes: 0, type: "EARLY" },
              { ...shift, startTime: "12:00", endTime: "16:00", breakMinutes: 0, type: "DAY" },
              { ...shift, startTime: "18:00", endTime: "22:00", breakMinutes: 0, type: "LATE" },
            ])
          : plan.shifts;
      const current = shifts.map((shift, index) =>
        forecastShift({
          ...shift,
          ...(scenario === "DENSE_VALID" ? { allDay: false } : {}),
          id: `${scenario}-${index}`,
          templateId: shift.templateId ?? null,
        }),
      );
      const entries = [
        ...current,
        ...Array.from({ length: 10000 }, (_, index) => ({
          ...current[index % current.length],
          id: `old-${index}`,
          date: "2010-01-01",
        })),
      ];
      const context = {
        entries,
        tariffDecisions: [],
        workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
        resolver: { ...bundledRuleResolver },
        testMonths: [],
      };
      const request = {
        month,
        profile: forecastProfile,
        context,
        settings: automatedSettings(`${year}-01`),
        annualPayments: [],
      };
      const samples = [],
        chunks = [],
        keys = [];
      let result;
      for (let repeat = 0; repeat < 5; repeat++) {
        const start = performance.now();
        if (preparation) {
          const key = preparation.analysisSalaryKey(request);
          keys.push(performance.now() - start);
          result = preparation.readAnalysisSalary(request, key);
          if (result === null) {
            const steps = preparation.prepareAnalysisSalarySteps(request, key);
            while (true) {
              const tick = performance.now();
              const step = steps.next();
              if (repeat === 0) chunks.push(performance.now() - tick);
              if (step.done) {
                result = step.value;
                break;
              }
            }
          }
        } else {
          const annual = annualSalaryForecast(
            year,
            request.profile,
            context,
            request.annualPayments,
          );
          const { shifts, pay } = salaryMonthInput(month, request.profile, context);
          const netAnnual = annualSalaryForecast(
            year,
            request.profile,
            context,
            request.settings.automation?.annualPayments,
          );
          const settings = {
            ...request.settings,
            automation: { ...request.settings.automation, annualPayments: netAnnual.payments },
          };
          const input = { month, profile: request.profile, settings, shifts, pay };
          result = {
            annual,
            forecast: netCache(input, context.resolver, () =>
              calculateAutomaticNetPayForecast(input, context.resolver),
            ),
          };
        }
        samples.push(performance.now() - start);
      }
      if (scenario === "DENSE_VALID" && year === 2026)
        assert.equal(result.forecast.result.status, "available");
      output.push({
        name: `${scenario}-${month}`,
        entries: entries.length,
        status: result.forecast?.result.status,
        ...(result.forecast?.result.status === "unavailable"
          ? { reason: result.forecast.result.reason }
          : {}),
        digest: hash(result),
        firstMs: samples[0],
        repeatedMedianMs: median(samples.slice(1)),
        ...(chunks.length
          ? {
              maximumStepMs: Math.max(...chunks),
              stepCount: chunks.length,
              keyMedianMs: median(keys),
              retainedKeyBytes: Buffer.byteLength(preparation.analysisSalaryKey(request)),
            }
          : {}),
      });
    }
console.log(JSON.stringify(output, null, 2));
