import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const [bindings, output] = process.argv.slice(2, 4).map((value) => path.resolve(value));
mkdirSync(output, { recursive: true });
const entry = path.join(output, "checks-bridge.cjs");
await build({
  stdin: {
    contents: `
export * from './src/features/analysis/monthly-rust-checks';
export {createStoredMonthlyRustCalculator} from './src/features/analysis/monthly-rust-source';
export {createStoredAnnualRustCalculator} from './src/features/analysis/annual-rust-bridge';
export {createStoredMonthlyRustNetCalculator} from './src/features/analysis/monthly-rust-net';
export {calculateMonthlyComplianceSteps} from './src/engine/compliance';
export {selectComplianceShifts} from './src/features/analysis/analysis-data';
export {migrateDatabase} from './src/infrastructure/database/migrations';
export {listCalendarEntries} from './src/infrastructure/database/calendar-entry-repository';
export {bundledRuleResolver} from './src/rules/rule-resolver';
`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  tsconfig: path.resolve("tsconfig.json"),
  logLevel: "silent",
  plugins: [
    {
      name: "original-pure-rule-capture",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]rule-computation\.tsx$/ }, ({ path: file }) => {
          const source = readFileSync(file, "utf8"),
            start = source.indexOf("export interface RuleComputationFailure"),
            end = source.indexOf("function ruleFailureMessage");
          assert.ok(start >= 0 && end > start);
          return {
            loader: "ts",
            resolveDir: path.dirname(file),
            contents:
              'import {WorkingTimeTargetError} from "@/domain/working-time-target-validation";\nimport {RuleResolutionError,type RuleResolutionFailure} from "@/rules/rule-resolver";\n' +
              source.slice(start, end),
          };
        });
      },
    },
  ],
});
const require = createRequire(import.meta.url),
  api = require(entry),
  native = require(bindings);
const info = JSON.parse(native.engineInvoke("info", ""));
let maxNativeReplyBytes = 0,
  checksCalls = 0,
  lastRaw,
  admission,
  fixture;
const transport = {
  expectedEngineVersion: info.engineVersion,
  async invoke(operation, json) {
    if (operation === "admitChecks") {
      admission = JSON.parse(json).command.request;
      assert.deepEqual(admission.sections, { time: false, gross: false, net: false, checks: true });
      assert.equal(admission.periods[0].kind, "MONTH");
      checksCalls++;
    }
    const raw = native.engineInvoke(operation, json);
    maxNativeReplyBytes = Math.max(maxNativeReplyBytes, Buffer.byteLength(raw));
    assert.ok(Buffer.byteLength(raw) < 4 * 1024 * 1024, "Build54 native output limit exceeded");
    const result = JSON.parse(raw);
    if (operation === "runChecks" && result.result) {
      lastRaw = structuredClone(result.result.reports[0]);
      for (const report of result.result.reports)
        report.views = { poison: "native display must never be read" };
    }
    return JSON.stringify(result);
  },
  async source(header, body) {
    return native.engineInvokeSource(header, body);
  },
  async calendarRanks(header, body) {
    return native.engineInvokeCalendarRanks(header, body);
  },
  async catalogFinalize(header, body) {
    return native.engineInvokeCatalogFinalize(header, body);
  },
};
const diagnosis = {
  source: "LEGACY_EMBEDDED",
  activeGeneration: null,
  selectedGeneration: null,
  keyId: null,
  fallbackReason: null,
};
const corpus = JSON.parse(
  readFileSync("modules/luna-engine/reference/checks-snapshot-golden.json", "utf8"),
);
const cases = [];
const normalize = (value) => JSON.parse(JSON.stringify(value));
const drain = (steps) => {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
  }
};
function open() {
  const sql = new DatabaseSync(":memory:");
  const args = (values) => (values.length === 1 && Array.isArray(values[0]) ? values[0] : values);
  const db = {
    async execAsync(text) {
      sql.exec(text);
    },
    async getFirstAsync(text, ...values) {
      return sql.prepare(text).get(...args(values)) ?? null;
    },
    async getAllAsync(text, ...values) {
      return sql.prepare(text).all(...args(values));
    },
    async runAsync(text, ...values) {
      const r = sql.prepare(text).run(...args(values));
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
  };
  return { sql, db };
}
function insert(sql, table, row) {
  const fields = Object.keys(row),
    quote = (value) => '"' + value.replaceAll('"', '""') + '"';
  sql
    .prepare(
      `INSERT OR REPLACE INTO ${quote(table)}(${fields.map(quote)}) VALUES(${fields.map(() => "?")})`,
    )
    .run(...Object.values(row));
}
function reference(request) {
  const p = request.profile;
  return drain(
    api.calculateMonthlyComplianceSteps(request.month, request.shifts, p.timeZone, {
      employmentProfile: p,
      federalState: p.federalState,
      holidayRegion: p.holidayRegion,
      weeklyMinutes: p.weeklyMinutes,
      regularRotatingNightWork: p.regularRotatingNightWork,
      sundayHolidayWorkEligible: p.sundayHolidayWorkEligible,
      allEmploymentWorkRecorded: p.allEmploymentWorkRecorded,
      referenceDate: request.referenceDate,
      ruleResolver: api.bundledRuleResolver,
      youthProtection: request.youthProtection,
    }),
  );
}
for (const item of corpus.cases.filter((item) => item.input.period.kind === "MONTH")) {
  const input = item.input,
    { sql, db } = open();
  await api.migrateDatabase(db);
  insert(sql, "user_profile", { id: "singleton", ...input.profile.profileRow });
  for (const row of input.profile.salaryRows)
    insert(sql, "app_preferences", { updated_at: "2026-01-01T00:00:00Z", ...row });
  for (const row of input.patternRows) insert(sql, "app_preferences", row);
  for (const row of input.historyRows) insert(sql, "remuneration_profiles", row);
  if (input.targetRow) insert(sql, "working_time_target_settings", input.targetRow);
  for (const row of input.shiftRows) insert(sql, "shift_entries", row);
  insert(sql, "app_preferences", {
    key: "check_youth_protection",
    value: String(input.youthProtection),
    updated_at: "2026-01-01T00:00:00Z",
  });
  let entries = await api.listCalendarEntries(db);
  const month = input.period.month,
    profile = item.profileExpected;
  let shifts;
  try {
    shifts = api.selectComplianceShifts(entries, month, api.bundledRuleResolver);
  } catch (error) {
    assert.equal(item.expected.compliance.ok, false, item.id);
    cases.push({ id: item.id, selectorUnavailable: true });
    sql.close();
    continue;
  }
  const request = {
    month,
    profile,
    shifts,
    referenceDate: input.referenceDate,
    youthProtection: input.youthProtection,
  };
  const calc = api.createStoredMonthlyRustChecksCalculator(db, transport, diagnosis, entries);
  const start = performance.now();
  const actual = await calc(request),
    rustMs = performance.now() - start;
  const refStart = performance.now(),
    expected = reference(request),
    tsMs = performance.now() - refStart;
  assert.deepEqual(normalize(actual), normalize(expected), item.id + " original TS comparison");
  assert.deepEqual(
    normalize(actual),
    normalize(item.expected.compliance.value),
    item.id + " captured golden comparison",
  );
  assert.equal(
    lastRaw.sections.checks.value.training,
    null,
    "Separate training overlay was requested",
  );
  cases.push({ id: item.id, passed: true, rustMs, tsMs, issues: actual.issues.length });
  if (
    !fixture &&
    shifts.some((shift) => shift.startTime !== null && shift.endTime !== null) &&
    actual.issues.length > 0 &&
    !input.youthProtection
  ) {
    fixture = { engineVersion: info.engineVersion, request, value: actual };
    const edit = shifts.find((shift) => shift.startTime !== null && shift.endTime !== null);
    sql
      .prepare("UPDATE shift_entries SET end_time=?,revision=revision+1 WHERE id=?")
      .run(edit.endTime === "23:50" ? "23:40" : "23:50", edit.id);
    entries = await api.listCalendarEntries(db);
    const changed = {
      ...request,
      shifts: api.selectComplianceShifts(entries, month, api.bundledRuleResolver),
    };
    const edited = await api.createStoredMonthlyRustChecksCalculator(
      db,
      transport,
      diagnosis,
      entries,
    )(changed);
    assert.deepEqual(normalize(edited), normalize(reference(changed)), "End-time edit parity");
    fixture.edited = { request: changed, value: edited };
    const mismatch = { ...changed, youthProtection: !changed.youthProtection };
    const calls = checksCalls;
    await assert.rejects(
      api.createStoredMonthlyRustChecksCalculator(db, transport, diagnosis, entries)(mismatch),
      /RUST_CHECKS_INPUT_CHANGED/,
    );
    assert.equal(checksCalls, calls, "Changed preference must stop before native admission");
    const [sharedChecks, sharedMonth] = await Promise.all([
      api.createStoredMonthlyRustChecksCalculator(db, transport, diagnosis, entries)(changed),
      api.createStoredMonthlyRustCalculator(
        db,
        transport,
        diagnosis,
      )({
        month,
        profile,
        entries,
        tariffDecisions: [],
        workPatternSettings: undefined,
        ruleResolver: api.bundledRuleResolver,
      }),
    ]);
    assert.deepEqual(normalize(sharedChecks), normalize(edited), "Shared owner changed checks");
    assert.equal(sharedMonth.summary.ok, true, "Shared owner changed monthly finance");
  }
  sql.close();
}
assert.ok(fixture?.edited, "Need a real recorded native edit case");
writeFileSync(
  path.join(output, "monthly-rust-checks.fixture.json"),
  JSON.stringify(fixture, null, 2) + "\n",
);
const result = {
  passed: true,
  cases: cases.length,
  compared: cases.filter((x) => x.passed).length,
  checksCalls,
  maxNativeReplyBytes,
  engineVersion: info.engineVersion,
  trainingOverlayExcluded: true,
  preferenceMismatchRejected: true,
  endTimeEditParity: true,
  sharedOwnerVerified: true,
  results: cases,
};
writeFileSync(
  path.join(output, "checks-bridge-results.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify({ ...result, results: undefined }));
