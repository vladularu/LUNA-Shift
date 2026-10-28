// node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare <published-source-snapshot>
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module");
const assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process"),
  { createHash } = require("node:crypto");
const root = process.cwd();
const holdout = process.argv.includes("--holdout");
const empty = process.argv.includes("--empty");
const compare = process.argv.indexOf("--compare");
if (compare !== -1) {
  const snapshot = path.resolve(process.argv[compare + 1]);
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, ["--require", "tsx/cjs", __filename, ...args], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
  const mode = [...(holdout ? ["--holdout"] : []), ...(empty ? ["--empty"] : [])];
  const before = run(["--baseline", snapshot, ...mode]),
    after = run(mode);
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
          "Synthetic Node CPU. Complete overview, compliance, annual and net outputs before/after one edit. No SQLite, scheduler waiting, React/native frames or iPhone timing.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const ts = require("typescript");
const compile = (loaded, filename, source) =>
  loaded._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
// Load the exact pure error boundary without importing native presentation in Node.
const boundaryPath = path.join(root, "src/features/analysis/rule-computation.tsx");
const boundarySource = ts.createSourceFile(
  boundaryPath,
  fs.readFileSync(boundaryPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const boundary = boundarySource.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "captureRuleComputation",
);
const pure = new Module(boundaryPath, module);
pure.filename = boundaryPath;
pure.paths = Module._nodeModulePaths(path.dirname(boundaryPath));
require.cache[boundaryPath] = pure;
compile(
  pure,
  boundaryPath,
  'import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";import { RuleResolutionError } from "@/rules/rule-resolver";' +
    boundary.getText(boundarySource),
);
const baseline = process.argv.indexOf("--baseline");
if (baseline !== -1) {
  const snapshot = path.resolve(process.argv[baseline + 1]);
  // Let Node load dependencies in their original order, including cyclic imports.
  for (const extension of [".ts", ".tsx"]) {
    const current = Module._extensions[extension];
    Module._extensions[extension] = (loaded, filename) => {
      const relative = path.relative(root, filename);
      const saved = path.join(snapshot, relative);
      if (
        !relative.startsWith("..") &&
        !relative.startsWith("node_modules") &&
        fs.existsSync(saved)
      )
        compile(loaded, filename, fs.readFileSync(saved, "utf8"));
      else current(loaded, filename);
    };
  }
}
const { forecastProfile, forecastShift } = require(
  path.join(root, "src/engine/net-pay-tvoed-forecast-test-fixtures"),
);
const { bundledRuleResolver } = require(path.join(root, "src/rules/rule-resolver"));
const { automatedSettings } = require(
  path.join(root, "src/domain/net-pay-automation-test-fixtures"),
);
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS: pattern } = require(
  path.join(root, "src/engine/simple-pay"),
);
const { calculateMonthlyAnalysisSteps, getCachedMonthlyAnalysis } = require(
  path.join(root, "src/features/analysis/monthly-analysis"),
);
const { prepareAnalysisSalarySteps, analysisSalaryKey, readAnalysisSalary } = require(
  path.join(root, "src/features/analysis/analysis-salary"),
);
const { calculateMonthlyComplianceSteps } = require(path.join(root, "src/engine/compliance"));
const base = { ...forecastProfile, tariff: null };
const canonicalModels = [
  ["TVOED_P", forecastProfile],
  [
    "VKA_E",
    {
      ...base,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
  ],
  [
    "TVH_KR",
    {
      ...base,
      federalState: "HE",
      tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
    },
  ],
  [
    "TVAOED",
    { ...base, nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" } },
  ],
  ["TVAL", { ...base, tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" } }],
  [
    "TVL_KR_CONTROL",
    { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } },
  ],
  [
    "TVUK_CONTROL",
    { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } },
  ],
  ["MANUAL_CONTROL", { ...base, manualMonthlyGrossCents: 500000 }],
];
const models = holdout
  ? [
      [
        "TVOED_P_BT_B_BW",
        {
          ...forecastProfile,
          federalState: "BW",
          tariff: {
            ...forecastProfile.tariff,
            sector: "BT_B",
            tariffRegion: "KAV_BW",
            fullTimeWeeklyMinutes: 2340,
          },
        },
      ],
      [
        "VKA_E_BT_B_BW",
        {
          ...base,
          federalState: "BW",
          vkaETariff: { payGroup: "E8", payLevel: 3, sector: "BT_B", tariffRegion: "KAV_BW" },
        },
      ],
      [
        "TVAOED_YEAR3_BT_B_BW",
        {
          ...base,
          federalState: "BW",
          nursingTrainingTariff: { trainingYear: 3, sector: "BT_B", tariffRegion: "KAV_BW" },
        },
      ],
      [
        "TVH_KR13_PART_TIME",
        {
          ...base,
          federalState: "HE",
          weeklyMinutes: 1800,
          tvhKrTariff: { payGroup: "KR13", payLevel: 5, fullTimeWeeklyMinutes: 2400 },
        },
      ],
      [
        "TVAL_YEAR3_EAST",
        {
          ...base,
          weeklyMinutes: 2100,
          tvalPflegeTariff: { trainingYear: 3, universityRegion: "EAST" },
        },
      ],
    ]
  : canonicalModels;
const drain = (steps) => {
  const durations = [];
  while (true) {
    const start = performance.now(),
      next = steps.next();
    durations.push(performance.now() - start);
    if (next.done)
      return {
        value: next.value,
        cpuMs: durations.reduce((a, b) => a + b, 0),
        maximumStepMs: Math.max(...durations),
        steps: durations.length,
      };
  }
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const overview = (request) => drain(calculateMonthlyAnalysisSteps(request));
const salary = (request) => drain(prepareAnalysisSalarySteps(request, analysisSalaryKey(request)));
const checks = (request, result) =>
  drain(
    calculateMonthlyComplianceSteps(
      request.month,
      result.complianceShifts.value,
      request.profile.timeZone,
      {
        employmentProfile: request.profile,
        federalState: request.profile.federalState,
        holidayRegion: request.profile.holidayRegion,
        weeklyMinutes: request.profile.weeklyMinutes,
        regularRotatingNightWork: request.profile.regularRotatingNightWork,
        sundayHolidayWorkEligible: request.profile.sundayHolidayWorkEligible,
        allEmploymentWorkRecorded: request.profile.allEmploymentWorkRecorded,
        referenceDate: "2026-10-28",
        ruleResolver: request.ruleResolver,
        youthProtection: false,
      },
    ),
  );
const rows = [];
for (const [family, profile] of models)
  for (const perDay of empty ? [0, 1, 2] : [1, 3])
    for (const month of empty ? ["2026-11", "2027-01"] : ["2026-10", "2027-01"]) {
      const year = Number(month.slice(0, 4)),
        resolver = { ...bundledRuleResolver };
      const entries = [];
      for (const selected of [1, 7, 8, 9, 10, 11])
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
      const history = entries[0] ?? forecastShift({ id: "seed", date: "2010-01-01" });
      for (let i = 0; i < 10000; i++)
        entries.push({ ...history, id: `history-${i}`, date: "2010-01-01" });
      if (empty) {
        const selected =
          perDay === 0
            ? entries.filter((entry) => entry.date === "2010-01-01")
            : perDay === 1
              ? entries.filter((entry) => !entry.date.startsWith(month))
              : [
                  ...entries.filter((entry) => entry.date === "2010-01-01"),
                  forecastShift({
                    id: "overnight-boundary",
                    date: new Date(Date.UTC(year, Number(month.slice(5)) - 1, 0))
                      .toISOString()
                      .slice(0, 10),
                    type: "NIGHT",
                    startTime: "21:00",
                    endTime: "08:00",
                    breakMinutes: 60,
                  }),
                  forecastShift({
                    id: "following-month",
                    date: new Date(Date.UTC(year, Number(month.slice(5)), 1))
                      .toISOString()
                      .slice(0, 10),
                  }),
                ];
        entries.splice(0, entries.length, ...selected);
      }
      const request = {
        month,
        profile,
        entries,
        tariffDecisions: [],
        workPatternSettings: pattern,
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
          workPatternSettings: pattern,
          resolver,
          testMonths: [],
        },
      };
      const first = overview(request),
        firstSalary = salary(salaryRequest),
        firstChecks = checks(request, first.value);
      assert.equal(
        first.value.pay.ok && first.value.pay.value.available,
        true,
        `${family} valid gross fixture`,
      );
      if (year === 2026)
        assert.equal(
          firstSalary.value.forecast.result.status,
          "available",
          `${family} valid full net fixture`,
        );
      const changedEntries = empty
        ? [
            ...entries,
            forecastShift({
              id: "new-0",
              date: `${month}-03`,
              type: "NIGHT",
              startTime: "21:00",
              endTime: "07:00",
              breakMinutes: 60,
            }),
          ]
        : entries.map((entry) =>
            entry.date === `${month}-03` && entry.id.endsWith("-0")
              ? { ...entry, endTime: perDay === 1 ? "08:00" : "11:30" }
              : entry,
          );
      const changedRequest = { ...request, entries: changedEntries };
      const changedSalaryRequest = {
        ...salaryRequest,
        context: { ...salaryRequest.context, entries: changedEntries },
      };
      const changed = overview(changedRequest),
        changedSalary = salary(changedSalaryRequest),
        changedChecks = checks(changedRequest, changed.value);
      const started = performance.now(),
        cachedOverview = getCachedMonthlyAnalysis(changedRequest),
        key = analysisSalaryKey(changedSalaryRequest),
        cachedSalary = readAnalysisSalary(changedSalaryRequest, key),
        cachedMs = performance.now() - started;
      assert.ok(cachedOverview !== null);
      rows.push({
        name: `${family}-${empty ? "empty-" : ""}${perDay}x-${month}`,
        entries: entries.length,
        digest: hash({
          overview: first.value,
          salary: firstSalary.value,
          checks: firstChecks.value,
          changed: changed.value,
          changedSalary: changedSalary.value,
          changedChecks: changedChecks.value,
        }),
        firstOverviewMs: first.cpuMs,
        firstOverviewMaximumMs: first.maximumStepMs,
        firstSalaryMs: firstSalary.cpuMs,
        firstSalaryMaximumMs: firstSalary.maximumStepMs,
        changedOverviewMs: changed.cpuMs,
        changedOverviewMaximumMs: changed.maximumStepMs,
        changedSalaryMs: changedSalary.cpuMs,
        changedSalaryMaximumMs: changedSalary.maximumStepMs,
        complianceMs: firstChecks.cpuMs,
        complianceMaximumMs: firstChecks.maximumStepMs,
        cachedMs,
        completeSalaryReused: cachedSalary !== null,
        netStatus: firstSalary.value.forecast?.result.status,
      });
    }
console.log(JSON.stringify(rows, null, 2));
