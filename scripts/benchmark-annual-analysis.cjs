// node --require tsx/cjs scripts/benchmark-annual-analysis.cjs --compare <baseline>
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module");
const assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto"),
  { performance } = require("node:perf_hooks");
const root = process.cwd();
const holdout = process.argv.includes("--holdout");
if (process.argv[2] === "--compare") {
  const results = [];
  for (const family of holdout
    ? ["TVH", "TVAL", "TRAINING", "TVOED", "EMPTY", "MANUAL"]
    : ["TVL", "TVUK", "VKA", "MANUAL"]) {
    const run = (mode) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--require",
            "tsx/cjs",
            __filename,
            "--worker",
            family,
            mode,
            path.resolve(process.argv[3]),
            ...(holdout ? ["--holdout"] : []),
          ],
          { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
        ),
      );
    const before = run("baseline"),
      after = run("prepared");
    assert.deepEqual(after.digests, before.digests);
    assert.equal(after.reopenedFromCache, true);
    assert.equal(after.returnedFromCache, true);
    results.push({ family, before, after });
  }
  console.log(
    JSON.stringify(
      {
        resultsIdentical: true,
        results,
        limits:
          "Synthetic Node CPU; dense: 1008 shifts plus 10000 archive entries; holdout: sparse night/absence shifts, year boundaries, empty year and youth checks. Includes exact input selection and keys. Cold preparation, reopen, one edit, and return to original inputs. No React, SQLite/native bridge, idle waiting or iPhone frames. Cache reads follow completed preparation.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
assert.equal(process.argv[2], "--worker");
const [family, mode, baseline] = process.argv.slice(3);
if (mode === "baseline") {
  const ts = require("typescript");
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
        loaded._compile(
          ts.transpileModule(fs.readFileSync(saved, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          }).outputText,
          filename,
        );
      else original(loaded, filename);
    };
  }
}
const from = (file) => require(path.join(root, file));
const { forecastProfile, forecastShift } = from("src/engine/net-pay-tvoed-forecast-test-fixtures");
const { createRuleResolver } = from("src/rules/rule-resolver");
const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } = from("src/engine/simple-pay");
const { selectAnnualReportInputs } = from("src/features/analysis/annual-report-inputs");
const { buildAnnualAvailableReportSteps } = from("src/features/analysis/annual-core-report");
const prepared = mode === "baseline" ? null : from("src/features/analysis/annual-analysis");
const base = { ...forecastProfile, tariff: null };
let profile =
  family === "TVL"
    ? { ...base, tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" } }
    : family === "TVUK"
      ? { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }
      : family === "VKA"
        ? {
            ...base,
            vkaETariff: { payGroup: "E9b", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
          }
        : { ...base, manualMonthlyGrossCents: 320000 };
if (family === "TVH")
  profile = {
    ...base,
    federalState: "HE",
    tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
  };
if (family === "TVAL")
  profile = { ...base, tvalPflegeTariff: { trainingYear: 1, universityRegion: "WEST" } };
if (family === "TRAINING")
  profile = {
    ...base,
    nursingTrainingTariff: { trainingYear: 1, sector: "BT_K", tariffRegion: "OTHER" },
  };
if (family === "TVOED") profile = forecastProfile;
const entries = [];
for (let month = 1; month <= 12; month++)
  for (let day = 1; day <= (holdout ? 3 : 28); day++)
    for (let part = 0; part < (holdout ? 1 : 3); part++)
      entries.push(
        forecastShift({
          id: month + "-" + day + "-" + part,
          date: "2026-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
          type: "DAY",
          startTime: ["07:00", "12:00", "18:00"][part],
          endTime: ["11:00", "16:00", "22:00"][part],
          breakMinutes: 0,
        }),
      );
if (holdout) {
  for (let index = 0; index < entries.length; index++)
    entries[index] = {
      ...entries[index],
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:00",
      breakMinutes: 60,
    };
  entries.push(
    forecastShift({ id: "year-before", date: "2025-12-31" }),
    forecastShift({ id: "year-after", date: "2027-01-01" }),
  );
  entries.push(
    forecastShift({
      id: "absence",
      date: "2026-04-12",
      type: "VACATION",
      startTime: null,
      endTime: null,
    }),
  );
  entries.push(
    forecastShift({ id: "deleted", date: "2026-05-12", deletedAt: "2026-10-28T00:00:00Z" }),
  );
}
if (family === "EMPTY") entries.length = 0;
for (let i = 0; i < 10000; i++)
  entries.push(forecastShift({ id: "archive-" + i, date: "2010-01-01" }));
const resolver = createRuleResolver();
const request = (source) => {
  const selected = selectAnnualReportInputs(
    null,
    2026,
    source,
    [],
    resolver,
    profile.tariff !== null,
  );
  return {
    year: 2026,
    entries: selected.entries,
    profile,
    tariffDecisions: selected.tariffDecisions,
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    referenceDate: "2026-10-28",
    youthProtection: holdout,
    ruleResolver: resolver,
  };
};
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value, (_key, item) => (item instanceof Map ? [...item] : item)))
    .digest("hex");
const timings = {},
  digests = {};
let maximumStepMs = 0,
  steps = 0;
function calculate(name, source) {
  const start = performance.now(),
    input = request(source);
  let value;
  if (prepared) {
    const key = prepared.annualAnalysisKey(input);
    value = prepared.readAnnualAnalysis(input, key, null);
    if (value) timings[name + "FromCache"] = true;
    else value = drain(prepared.prepareAnnualAnalysisSteps(input, key, null));
  } else
    value = drain(
      buildAnnualAvailableReportSteps(
        input.year,
        input.entries,
        input.profile,
        input.tariffDecisions,
        input.workPatternSettings,
        input.referenceDate,
        resolver,
        { youthProtection: holdout },
      ),
    );
  timings[name + "Ms"] = performance.now() - start;
  digests[name] = digest(value);
  return value;
}
function drain(generator) {
  while (true) {
    const start = performance.now(),
      step = generator.next();
    maximumStepMs = Math.max(maximumStepMs, performance.now() - start);
    steps++;
    if (step.done) return step.value;
  }
}
calculate("cold", entries);
calculate("reopened", JSON.parse(JSON.stringify(entries)));
const edited = entries.map((e) => (e.id === "10-1-0" ? { ...e, endTime: "11:30" } : e));
if (family === "EMPTY") edited.push(forecastShift({ id: "first-entry", date: "2026-10-01" }));
calculate("edited", edited);
calculate("returned", entries);
console.log(JSON.stringify({ ...timings, maximumStepMs, steps, digests }));
