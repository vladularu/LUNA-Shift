// Real SQLite close/reopen, finished read, then one same-revision duty edit.
// node --require tsx/cjs scripts/benchmark-annual-parts.cjs --compare <baseline>
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
if (process.argv[2] === "--compare") {
  const roots = { baseline: path.resolve(process.argv[3]), candidate: process.cwd() },
    results = [];
  for (const family of ["TVOED", "MANUAL", "TVUK", "NIGHT", "EMPTY", "YOUTH"])
    for (let sample = 0; sample < 2; sample++) {
      const pair = { family, sample };
      for (const [mode, root] of Object.entries(roots))
        pair[mode] = JSON.parse(
          execFileSync(process.execPath, ["--require", "tsx/cjs", __filename, "--worker", family], {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
          }),
        );
      assert.deepEqual(pair.candidate.digests, pair.baseline.digests);
      assert.equal(pair.candidate.editedMatchesFresh, true);
      assert.equal(pair.candidate.reopenedSteps, 0);
      results.push(pair);
    }
  console.log(
    JSON.stringify(
      {
        resultParity: true,
        results,
        limits:
          "Synthetic Node, real SQLite filesystem and JS scheduling. Includes completed disk lookup, full keys, hashing, twelve intermediate reads and edited result delivery. Excludes React/native bridge, iPhone frames and app suspension. Fixed six families, two paired samples, no user/cloud data.",
      },
      null,
      2,
    ),
  );
} else {
  assert.equal(process.argv[2], "--worker");
  const from = (file) => require(path.join(process.cwd(), file));
  const Database = require(path.join(process.cwd(), "node_modules/better-sqlite3"));
  const { forecastProfile, forecastShift } = from(
    "src/engine/net-pay-tvoed-forecast-test-fixtures",
  );
  const { createRuleResolver } = from("src/rules/rule-resolver");
  const { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } = from("src/engine/simple-pay");
  const { createPersistentAnalysisCache } = from("src/features/analysis/persistent-analysis-cache");
  const { createAnalysisResultRepository } = from(
    "src/infrastructure/database/analysis-result-repository",
  );
  const { annualAnalysisKey, requestAnnualAnalysis } = from(
    "src/features/analysis/annual-analysis",
  );
  const { buildAnnualAvailableReportSteps } = from("src/features/analysis/annual-core-report");
  const { encodeAnalysisCacheValue } = from("src/features/analysis/analysis-cache-codec");
  const { calendarPerformance } = from("src/application/calendar-performance");
  const family = process.argv[3];
  const base = { ...forecastProfile, tariff: null };
  const profile =
    family === "MANUAL" || family === "EMPTY"
      ? { ...base, manualMonthlyGrossCents: 320000 }
      : family === "TVUK"
        ? { ...base, federalState: "BW", tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 } }
        : forecastProfile;
  const entries = [];
  if (family !== "EMPTY")
    for (let month = 1; month <= 12; month++)
      for (let day = 1; day <= 14; day++)
        entries.push(
          forecastShift({
            id: `${month}-${day}`,
            date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            ...(family === "NIGHT"
              ? { type: "NIGHT", startTime: "21:00", endTime: "07:00", breakMinutes: 60 }
              : {}),
          }),
        );
  entries.push(
    forecastShift({
      id: "boundary-before",
      date: "2025-12-31",
      type: "NIGHT",
      startTime: "21:00",
      endTime: "07:00",
    }),
    forecastShift({ id: "boundary-after", date: "2027-01-01" }),
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luna-parts-benchmark-")),
    filename = path.join(directory, "cache.sqlite");
  const pending = new Set();
  const digest = (value) =>
    createHash("sha256").update(encodeAnalysisCacheValue(value)).digest("hex");
  function storage() {
    const raw = new Database(filename);
    const db = {
      execAsync: async (sql) => raw.exec(sql),
      runAsync: async (sql, ...args) => raw.prepare(sql).run(...args),
      getFirstAsync: async (sql, ...args) => raw.prepare(sql).get(...args) ?? null,
    };
    const cache = createPersistentAnalysisCache({
      repository: createAnalysisResultRepository(db, () => "2026-11"),
      bundleId: "benchmark-parts",
      sha256: async (text) => createHash("sha256").update(text).digest("hex"),
      lookupTimeoutMs: 1000,
    });
    const persistent = {
      ...cache,
      write(...args) {
        const promise = cache.write(...args);
        pending.add(promise);
        void promise.finally(() => pending.delete(promise));
        return promise;
      },
    };
    return { persistent, close: () => raw.close() };
  }
  const request = (source) => ({
    year: 2026,
    entries: source,
    profile,
    tariffDecisions: [],
    workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
    referenceDate: "2026-11-12",
    youthProtection: family === "YOUTH",
    ruleResolver: createRuleResolver(),
  });
  async function run(owner, input) {
    calendarPerformance.start(true);
    const start = performance.now();
    let lease;
    const value = await new Promise((resolve, reject) => {
      lease = requestAnnualAnalysis(
        input,
        annualAnalysisKey(input),
        owner.persistent,
        -1,
        resolve,
        reject,
      );
    });
    const ms = performance.now() - start;
    while (pending.size) await Promise.all([...pending]);
    const steps = calendarPerformance
      .report()
      .events.filter((event) => event.kind === "analysis-work" && event.values.state === 1)
      .reduce((sum, event) => sum + event.values.count, 0);
    lease.cancel();
    calendarPerformance.clear();
    return { ms, steps, value };
  }
  (async () => {
    let owner = storage();
    try {
      const cold = await run(owner, request(entries));
      owner.close();
      owner = storage();
      const reopened = await run(owner, request(JSON.parse(JSON.stringify(entries))));
      const editedEntries = entries.map((entry) =>
        entry.id === "6-5" ? { ...entry, endTime: "18:00" } : entry,
      );
      if (family === "EMPTY")
        editedEntries.push(forecastShift({ id: "first", date: "2026-06-05" }));
      const input = request(editedEntries),
        edited = await run(owner, input);
      const fresh = buildAnnualAvailableReportSteps(
        input.year,
        input.entries,
        input.profile,
        input.tariffDecisions,
        input.workPatternSettings,
        input.referenceDate,
        createRuleResolver(),
        { youthProtection: input.youthProtection },
      );
      let expected;
      for (;;) {
        const step = fresh.next();
        if (step.done) {
          expected = step.value;
          break;
        }
      }
      assert.equal(digest(edited.value), digest(expected));
      console.log(
        JSON.stringify({
          coldMs: cold.ms,
          coldSteps: cold.steps,
          reopenedMs: reopened.ms,
          reopenedSteps: reopened.steps,
          editedMs: edited.ms,
          editedSteps: edited.steps,
          editedMatchesFresh: true,
          digests: {
            cold: digest(cold.value),
            reopened: digest(reopened.value),
            edited: digest(edited.value),
          },
        }),
      );
    } finally {
      owner.close();
      assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), "luna-parts-benchmark-")));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
