// node --require tsx/cjs scripts/benchmark-analysis-warmup.cjs --compare <published-source-snapshot>
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"),
  { createHash } = require("node:crypto"),
  real = require("node:perf_hooks").performance;
const root = process.cwd(),
  ts = require("typescript");
if (process.argv[2] === "--compare") {
  const baseline = path.resolve(process.argv[3]),
    results = [];
  for (const family of ["TVL", "TVUK", "VKA"]) {
    const run = (mode) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ["--require", "tsx/cjs", __filename, "--worker", family, mode, baseline],
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
        ),
      );
    const cold = run("baseline"),
      warm = run("warm"),
      editCold = run("baseline-edit"),
      editWarm = run("warm-edit"),
      joined = run("join");
    assert.equal(cold.digest, warm.digest);
    assert.equal(cold.digest, joined.digest);
    assert.equal(editCold.digest, editWarm.digest);
    assert.equal(warm.readyAtOpen, true);
    assert.equal(editWarm.readyAtOpen, true);
    assert.deepEqual(joined.calculations, { month: 1, salary: 1, checks: 1 });
    results.push({ family, cold, warm, editCold, editWarm, joined });
  }
  console.log(
    JSON.stringify(
      {
        resultsIdentical: true,
        results,
        limits:
          "Controlled Node CPU plus modelled 16ms idle callbacks and cooperative timers. 11,008 entries. No React, startup import, SQLite, SQLCipher, native bridge or iPhone frame time. Warm cases open after preparation completes; join opens after 250ms of modelled background time.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
assert.equal(process.argv[2], "--worker");
const family = process.argv[3],
  mode = process.argv[4],
  baseline = path.resolve(process.argv[5]),
  isBaseline = mode.startsWith("baseline");
const compile = (loaded, filename, source) =>
  loaded._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
const boundaryPath = path.join(root, "src/features/analysis/rule-computation.tsx"),
  boundarySource = ts.createSourceFile(
    boundaryPath,
    fs.readFileSync(boundaryPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const capture = boundarySource.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "captureRuleComputation",
);
const shim = new Module(boundaryPath, module);
shim.filename = boundaryPath;
shim.paths = Module._nodeModulePaths(path.dirname(boundaryPath));
require.cache[boundaryPath] = shim;
compile(
  shim,
  boundaryPath,
  'import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";import { RuleResolutionError } from "@/rules/rule-resolver";' +
    capture.getText(boundarySource),
);
if (isBaseline)
  for (const extension of [".ts", ".tsx"]) {
    const original = Module._extensions[extension];
    Module._extensions[extension] = (loaded, filename) => {
      const relative = path.relative(root, filename),
        saved = path.join(baseline, relative);
      if (
        !relative.startsWith("..") &&
        !relative.startsWith("node_modules") &&
        fs.existsSync(saved)
      )
        compile(loaded, filename, fs.readFileSync(saved, "utf8"));
      else original(loaded, filename);
    };
  }
let now = 0,
  nextId = 0,
  callbacks = 0,
  maximumCallback = 0,
  cpu = 0;
const timers = new Map();
global.performance = { now: () => now };
global.setTimeout = (fn, delay = 0) => {
  const id = ++nextId;
  timers.set(id, { fn, due: now + delay });
  return id;
};
global.clearTimeout = (id) => timers.delete(id);
global.requestIdleCallback = (fn) => setTimeout(fn, 16);
global.cancelIdleCallback = clearTimeout;
function next() {
  const [id, item] = [...timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
  timers.delete(id);
  now = Math.max(now, item.due);
  const start = real.now(),
    before = cpu;
  item.fn();
  const elapsed = real.now() - start;
  now += Math.max(0, elapsed - (cpu - before));
  cpu += Math.max(0, elapsed - (cpu - before));
  callbacks++;
  maximumCallback = Math.max(maximumCallback, elapsed);
}
function pump(until = Infinity) {
  let count = 0;
  while (timers.size && now < until) {
    if (++count > 100000) throw new Error("Unbounded warmup");
    next();
  }
}
const from = (file) => require(path.join(root, file));
const queuePath = require.resolve(path.join(root, "src/features/analysis/analysis-work-queue")),
  queue = from("src/features/analysis/analysis-work-queue"),
  enqueue = queue.createAnalysisWorkQueue();
const measure =
  (fn) =>
  (...args) => {
    const start = real.now(),
      value = fn(...args),
      elapsed = real.now() - start;
    now += elapsed;
    cpu += elapsed;
    return value;
  };
const schedule = (steps, complete, fail, priority, measurement) =>
  enqueue({ next: measure(() => steps.next()) }, measure(complete), fail, priority, measurement);
require.cache[queuePath].exports = { ...queue, scheduleAnalysisWork: schedule };
const calculations = { month: 0, salary: 0, checks: 0 };
function instrument(file, name, kind) {
  const filename = require.resolve(path.join(root, file)),
    original = from(file);
  const wrapped = {
    ...original,
    [name]: (...args) => {
      calculations[kind]++;
      return original[name](...args);
    },
  };
  require.cache[filename].exports = wrapped;
  return wrapped;
}
const monthly = instrument(
    "src/features/analysis/monthly-analysis",
    "calculateMonthlyAnalysisSteps",
    "month",
  ),
  salary = instrument(
    "src/features/analysis/analysis-salary",
    "prepareAnalysisSalarySteps",
    "salary",
  ),
  compliance = instrument("src/engine/compliance", "calculateMonthlyComplianceSteps", "checks");
const { forecastProfile, forecastShift } = from("src/engine/net-pay-tvoed-forecast-test-fixtures"),
  { automatedSettings } = from("src/domain/net-pay-automation-test-fixtures"),
  { createRuleResolver } = from("src/rules/rule-resolver");
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS: pattern } = from("src/engine/simple-pay");
const shared = isBaseline ? null : from("src/features/analysis/shared-analysis-tasks"),
  warmFactory = isBaseline
    ? null
    : from("src/features/analysis/analysis-warmup-runtime").createAnalysisWarmupRuntime;
const cache = isBaseline ? null : from("src/features/analysis/analysis-compliance-cache");
const values = from("src/features/analysis/persistent-analysis-values");
const base = { ...forecastProfile, tariff: null };
const profile =
  family === "TVL"
    ? { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } }
    : family === "TVUK"
      ? { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }
      : {
          ...base,
          vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
        };
let entries = [];
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
  referenceDate = "2026-10-28",
  timeline = [
    {
      settings: automatedSettings("2026-01"),
      revision: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
const snapshot = () => ({
  months: [month],
  profile,
  savedProfile: profile,
  entries,
  tariffDecisions: [],
  workPatternSettings: pattern,
  testMonths: [],
  resolver,
  timeline,
  annualPayments: [],
  referenceDate,
  youthProtection: false,
});
const edit = () => {
  entries = entries.map((e) => (e.id === "10-1-0" ? { ...e, endTime: "11:30" } : e));
};
const runtime = warmFactory?.(null);
let warmupMs = 0;
if (mode === "warm" || mode === "warm-edit" || mode === "join") {
  runtime.prepare(snapshot());
  pump(mode === "join" ? 250 : Infinity);
  if (mode === "warm-edit") {
    edit();
    const start = now;
    runtime.prepare(snapshot());
    pump();
    warmupMs = now - start;
  } else warmupMs = now;
} else if (mode === "baseline-edit") edit();
if (mode === "warm-edit") {
  calculations.month = 0;
  calculations.salary = 0;
  calculations.checks = 0;
}
const outcomes = {},
  leases = [],
  requestedAt = now;
const request = {
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
  settings: timeline[0].settings,
  annualPayments: [],
  context: { entries, tariffDecisions: [], workPatternSettings: pattern, resolver, testMonths: [] },
};
function getStage(options) {
  if (isBaseline) {
    const task = schedule(
      options.steps(() => {}),
      options.complete,
      options.fail,
      options.priority,
    );
    leases.push(task);
  } else leases.push(shared.requestSharedAnalysis(options));
}
function openChecks(value) {
  assert.ok(value.complianceShifts.ok);
  const shifts = value.complianceShifts.value,
    key = JSON.stringify([month, profile, referenceDate, shifts, false]);
  const cached = cache?.completedMonthlyCompliance.read(resolver, key, true) ?? null;
  if (cached) {
    outcomes.checks = cached;
    return;
  }
  getStage({
    kind: "checks",
    key,
    month,
    resolver,
    persistent: null,
    priority: -1,
    accept: values.persistentCheckValue,
    steps: () =>
      compliance.calculateMonthlyComplianceSteps(month, shifts, profile.timeZone, {
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
    complete: (value) => {
      outcomes.checks = value;
    },
    fail: (error) => {
      throw error;
    },
  });
}
measure(() => {
  const inspection = monthly.inspectMonthlyAnalysis(request),
    key = inspection.key;
  if (inspection.cached) {
    outcomes.overview = inspection.cached;
    openChecks(inspection.cached);
  } else
    getStage({
      kind: "month",
      key,
      month,
      resolver,
      persistent: null,
      priority: -3,
      accept: values.persistentMonthValue,
      steps: () => monthly.calculateMonthlyAnalysisSteps(request),
      complete: (value) => {
        outcomes.overview = monthly.retainPreparedMonthlyAnalysis?.(request, key, value) ?? value;
        openChecks(outcomes.overview);
      },
      fail: (error) => {
        throw error;
      },
    });
  const payKey = salary.analysisSalaryKey(payInput),
    cached =
      salary.readAnalysisSalary(payInput, payKey) ??
      shared?.readSharedAnalysisResult("salary", payKey, resolver, null);
  if (cached) outcomes.salary = cached;
  else
    getStage({
      kind: "salary",
      key: payKey,
      month,
      resolver,
      persistent: null,
      priority: -1,
      accept: values.persistentSalaryValue,
      steps: (progress) => salary.prepareAnalysisSalarySteps(payInput, payKey, progress),
      complete: (value) => {
        outcomes.salary = value;
      },
      fail: (error) => {
        throw error;
      },
    });
})();
const preparedAt = now,
  readyAtOpen = !!(outcomes.overview && outcomes.checks && outcomes.salary);
pump();
assert.ok(outcomes.overview && outcomes.checks && outcomes.salary);
const result = {
  mode,
  entries: entries.length,
  readyAtOpen,
  warmupMs,
  openPreparationMs: preparedAt - requestedAt,
  remainingWorkMs: now - preparedAt,
  openToReadyMs: now - requestedAt,
  calculations: { ...calculations },
  callbacks,
  maximumCallbackMs: maximumCallback,
  cpuMs: cpu,
  digest: createHash("sha256")
    .update(
      JSON.stringify({
        overview: outcomes.overview,
        checks: outcomes.checks,
        salary: outcomes.salary,
      }),
    )
    .digest("hex"),
};
runtime?.stop();
leases.forEach((lease) => lease.cancel());
console.log(JSON.stringify(result));
