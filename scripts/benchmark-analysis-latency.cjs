// node --require tsx/cjs scripts/benchmark-analysis-latency.cjs --compare <source-snapshot>
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module");
const assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto"),
  realClock = require("node:perf_hooks").performance;
const root = process.cwd(),
  ts = require("typescript");
const comparison = process.argv.indexOf("--compare");
if (comparison !== -1) {
  const snapshot = path.resolve(process.argv[comparison + 1]);
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
          "Synthetic CPU plus explicitly modelled idle-callback delay, not iPhone or native frame timing. No SQLite wait is modelled.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const compile = (loaded, filename, source) =>
  loaded._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
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
  for (const extension of [".ts", ".tsx"]) {
    const current = Module._extensions[extension];
    Module._extensions[extension] = (loaded, filename) => {
      const relative = path.relative(root, filename),
        saved = path.join(snapshot, relative);
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
let now = 0,
  idleDelay = 16,
  nextTimer = 0,
  timers = new Map(),
  callbacks = 0;
const schedule = (work, delay) => {
  const id = ++nextTimer;
  timers.set(id, { at: now + Math.max(1, delay), work });
  return id;
};
global.performance = { now: () => now };
global.setTimeout = (work, delay = 0) => schedule(work, delay);
global.clearTimeout = (id) => timers.delete(id);
const idlePath = path.join(root, "src/ui/schedule-idle-work.ts");
require.cache[idlePath] = {
  id: idlePath,
  filename: idlePath,
  loaded: true,
  exports: {
    scheduleIdleWork: (work) => {
      const id = schedule(work, idleDelay);
      return () => timers.delete(id);
    },
  },
};
const { createAnalysisWorkQueue, analysisWorkPriority } = require(
  path.join(root, "src/features/analysis/analysis-work-queue"),
);
const priorityFor = (stage, active) =>
  analysisWorkPriority ? analysisWorkPriority(stage, active) : active ? 0 : stage === 3 ? 2 : 1;
const { forecastProfile, forecastShift } = require(
  path.join(root, "src/engine/net-pay-tvoed-forecast-test-fixtures"),
);
const { automatedSettings } = require(
  path.join(root, "src/domain/net-pay-automation-test-fixtures"),
);
const { bundledRuleResolver } = require(path.join(root, "src/rules/rule-resolver"));
const monthly = require(path.join(root, "src/features/analysis/monthly-analysis"));
const salary = require(path.join(root, "src/features/analysis/analysis-salary"));
const { calculateMonthlyComplianceSteps } = require(path.join(root, "src/engine/compliance"));
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS: pattern } = require(
  path.join(root, "src/engine/simple-pay"),
);
const base = { ...forecastProfile, tariff: null };
const models = [
  ["TVL", { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } }],
  ["TVUK", { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }],
  [
    "VKA",
    {
      ...base,
      vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
    },
  ],
];
const rows = [];
for (const [family, profile] of models)
  for (const delay of [16, 80]) {
    now = 0;
    idleDelay = delay;
    timers = new Map();
    callbacks = 0;
    const enqueue = createAnalysisWorkQueue(),
      resolver = { ...bundledRuleResolver },
      entries = [];
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
    const requests = ["2026-09", "2026-10", "2026-08"].map((month) => ({
      month,
      profile,
      entries,
      tariffDecisions: [],
      workPatternSettings: pattern,
      ruleResolver: resolver,
    }));
    const outcomes = requests.map(() => ({})),
      durations = requests.map(() => ({}));
    let maximumStep = 0,
      cpu = 0,
      maxCallback = 0;
    const measured = (steps) => ({
      next() {
        const start = realClock.now();
        const value = steps.next();
        const elapsed = realClock.now() - start;
        now += elapsed;
        cpu += elapsed;
        maximumStep = Math.max(maximumStep, elapsed);
        return value;
      },
    });
    const fail = (error) => {
      throw error;
    };
    requests.forEach((request, index) => {
      const priority = priorityFor(1, index === 0);
      enqueue(
        measured(monthly.calculateMonthlyAnalysisSteps(request)),
        (result) => {
          outcomes[index].overview = result;
          durations[index].overview = now;
          enqueue(
            measured(
              calculateMonthlyComplianceSteps(
                request.month,
                result.complianceShifts.value,
                profile.timeZone,
                {
                  employmentProfile: profile,
                  federalState: profile.federalState,
                  holidayRegion: profile.holidayRegion,
                  weeklyMinutes: profile.weeklyMinutes,
                  regularRotatingNightWork: profile.regularRotatingNightWork,
                  sundayHolidayWorkEligible: profile.sundayHolidayWorkEligible,
                  allEmploymentWorkRecorded: profile.allEmploymentWorkRecorded,
                  referenceDate: "2026-10-28",
                  ruleResolver: resolver,
                  youthProtection: false,
                },
              ),
            ),
            (checks) => {
              outcomes[index].compliance = checks;
              durations[index].compliance = now;
            },
            fail,
            priorityFor(2, index === 0),
          );
        },
        fail,
        priority,
      );
      const input = {
        month: request.month,
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
      enqueue(
        measured(salary.prepareAnalysisSalarySteps(input, salary.analysisSalaryKey(input))),
        (result) => {
          outcomes[index].salary = result;
          durations[index].salary = now;
        },
        fail,
        priorityFor(3, index === 0),
      );
    });
    while (timers.size) {
      assert.ok(callbacks < 100000, "Queue stalled");
      const [id, timer] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(id);
      now = Math.max(now, timer.at);
      const start = now;
      timer.work();
      maxCallback = Math.max(maxCallback, now - start);
      callbacks++;
    }
    assert.ok(outcomes.every((result) => result.overview && result.compliance && result.salary));
    const hot = [];
    for (let repeat = 0; repeat < 60; repeat++) {
      const start = realClock.now();
      for (const request of requests) assert.ok(monthly.inspectMonthlyAnalysis(request).cached);
      hot.push(realClock.now() - start);
    }
    const digest = createHash("sha256")
      .update(
        JSON.stringify(
          outcomes.map(({ overview, compliance, salary }) => ({ overview, compliance, salary })),
        ),
      )
      .digest("hex");
    rows.push({
      name: `${family}-3x-idle-${delay}`,
      entries: entries.length,
      digest,
      cpuMs: cpu,
      modelledWallMs: now,
      callbacks,
      maximumStepMs: maximumStep,
      maximumCallbackMs: maxCallback,
      months: requests.map((r, i) => ({ month: r.month, ...durations[i] })),
      cachedThreePageInspectionMedianMs: hot.sort((a, b) => a - b)[30],
      salaryKeyCharacters: requests.reduce(
        (total, request) =>
          total +
          salary.analysisSalaryKey({
            month: request.month,
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
          }).length,
        0,
      ),
      monthlyKeyCharacters: requests.reduce(
        (total, request) => total + monthly.inspectMonthlyAnalysis(request).key.length,
        0,
      ),
    });
  }
console.log(JSON.stringify(rows, null, 2));
