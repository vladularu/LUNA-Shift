import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
const [bindings, output] = process.argv.slice(2, 4).map((value) => path.resolve(value));
mkdirSync(output, { recursive: true });
const entry = path.join(output, "salary-preparation.cjs");
await build({
  stdin: {
    contents: `
export * from './src/features/analysis/monthly-rust-salary-preparation';
export {prepareAnalysisSalarySteps,analysisSalaryKey} from './src/features/analysis/analysis-salary';
export {createStoredMonthlyRustNetCalculator} from './src/features/analysis/monthly-rust-net';
export {migrateDatabase} from './src/infrastructure/database/migrations';
export {saveProfile} from './src/infrastructure/database/profile-repository';
export {saveShift,listCalendarEntries} from './src/infrastructure/database/calendar-entry-repository';
export {bundledRuleResolver} from './src/rules/rule-resolver';
export {collectAnnualSalaryPayments,resolveNetPaySettings} from './src/domain/net-pay-profile';
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
  native = require(bindings),
  info = JSON.parse(native.engineInvoke("info", ""));
let calls = 0,
  maxReplyBytes = 0,
  lastFinancial,
  lastAnnual,
  fixture,
  sharedOwnerVerified = false;
const transport = {
  expectedEngineVersion: info.engineVersion,
  async invoke(operation, json) {
    if (operation === "admitFinance") {
      const request = JSON.parse(json).command.request;
      assert.equal(request.sections.checks, false);
      assert.equal(request.periods[0].kind, "MONTH");
      calls++;
    }
    const raw = native.engineInvoke(operation, json);
    maxReplyBytes = Math.max(maxReplyBytes, Buffer.byteLength(raw));
    assert.ok(Buffer.byteLength(raw) < 4 * 1024 * 1024, "Build54 reply cap exceeded");
    const reply = JSON.parse(raw);
    if (operation === "runFinance" && reply.result)
      for (const report of reply.result.reports) {
        if (report.sections.gross.state === "READY" || report.sections.net.state === "READY")
          lastFinancial = structuredClone(report);
        const page = report.views?.payrollPage;
        if (page?.state === "READY") lastAnnual = structuredClone(page.value.annualEditor);
        report.views = {
          payrollPage:
            page?.state === "READY"
              ? {
                  state: "READY",
                  value: {
                    annualEditor: {
                      payments: lastAnnual.payments,
                      proposal: lastAnnual.proposal,
                      automatic: lastAnnual.automatic,
                      issue: lastAnnual.issue,
                    },
                    statement: { poison: "Native statement must not be consumed" },
                  },
                }
              : page,
          poison: "no native UI consumer",
        };
      }
    return JSON.stringify(reply);
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
  readFileSync("modules/luna-engine/reference/financial-net-golden.json", "utf8"),
);
const eligible = corpus.cases.filter(
  (item) =>
    item.expected.forecasts?.length &&
    JSON.parse(item.inputJson).perspective === "PAYOUT" &&
    !JSON.parse(item.inputJson).testMonths.length,
);
const limit = Number(process.argv[4] ?? 72),
  step = Math.ceil(eligible.length / limit);
const selected = eligible.filter((_, index) => index % step === 0).slice(0, limit);
const results = [],
  excluded = [];
const normalize = (value) => JSON.parse(JSON.stringify(value));
async function drain(steps) {
  while (true) {
    const next = steps.next();
    if (next.done) return next.value;
    if (next.value instanceof Promise) await next.value;
  }
}
for (const item of selected) {
  const input = JSON.parse(item.inputJson),
    candidate =
      item.expected.forecasts.find(
        (value) =>
          api.resolveNetPaySettings(value.month, input.timeline) &&
          input.entries.some((entry) => entry.date.startsWith(value.month)),
      ) ??
      item.expected.forecasts.find((value) =>
        api.resolveNetPaySettings(value.month, input.timeline),
      );
  if (!candidate) continue;
  const sql = new DatabaseSync(":memory:"),
    flatten = (values) => (values.length === 1 && Array.isArray(values[0]) ? values[0] : values);
  const db = {
    async execAsync(text) {
      sql.exec(text);
    },
    async getFirstAsync(text, ...values) {
      return sql.prepare(text).get(...flatten(values)) ?? null;
    },
    async getAllAsync(text, ...values) {
      return sql.prepare(text).all(...flatten(values));
    },
    async runAsync(text, ...values) {
      const result = sql.prepare(text).run(...flatten(values));
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
    },
  };
  await api.migrateDatabase(db);
  let profile;
  try {
    profile = await api.saveProfile(db, input.profile);
  } catch (error) {
    if (error.name !== "ValidationError") throw error;
    excluded.push({
      id: item.id,
      reason: "Original profile writer rejects intentionally invalid fixture",
    });
    sql.close();
    continue;
  }
  let entries = [];
  for (const shift of input.entries)
    entries.push(await api.saveShift(db, { ...shift, id: undefined, templateId: null }));
  for (const saved of input.timeline)
    sql
      .prepare(
        "INSERT INTO net_pay_profiles(month,settings_json,revision,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        saved.settings.month,
        JSON.stringify(saved.settings),
        saved.revision,
        saved.createdAt,
        saved.updatedAt,
      );
  sql
    .prepare("INSERT OR REPLACE INTO app_preferences(key,value,updated_at) VALUES(?,?,?)")
    .run("salary_payment_v1", JSON.stringify(input.preferences), "2026-01-01T00:00:00Z");
  for (const decision of input.tariffDecisions)
    sql
      .prepare(
        "INSERT INTO monthly_tariff_decisions(month,allowance_status,revision,confirmed_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        decision.month,
        decision.allowanceStatus,
        decision.revision,
        decision.confirmedAt,
        decision.updatedAt,
      );
  const request = {
    month: candidate.month,
    profile,
    settings: api.resolveNetPaySettings(candidate.month, input.timeline)?.settings ?? null,
    annualPayments: api.collectAnnualSalaryPayments(input.timeline),
    payment: {
      preferences: input.preferences,
      perspective: "PAYOUT",
      sourceSettings: input.timeline,
    },
    context: {
      entries,
      tariffDecisions: input.tariffDecisions,
      workPatternSettings: input.workPatternSettings,
      resolver: api.bundledRuleResolver,
      testMonths: [],
    },
  };
  const calculate = api.createStoredMonthlyRustSalaryPreparation(db, transport, diagnosis),
    start = performance.now(),
    actual = await calculate(request),
    rustMs = performance.now() - start;
  const tsStart = performance.now(),
    expected = await drain(api.prepareAnalysisSalarySteps(request, api.analysisSalaryKey(request))),
    tsMs = performance.now() - tsStart;
  assert.deepEqual(
    normalize(actual),
    normalize(expected),
    item.id + " full prepared salary parity",
  );
  results.push({ id: item.id, month: request.month, passed: true, rustMs, tsMs });
  if (
    !fixture &&
    actual.forecast?.result.status === "available" &&
    actual.annual.proposal !== null &&
    actual.projection.sources.some((source) =>
      source.shifts.some((entry) => entry.startTime && entry.endTime),
    )
  ) {
    fixture = {
      engineVersion: info.engineVersion,
      request,
      value: actual,
      report: {
        period: { kind: "MONTH", month: request.month },
        sections: { gross: lastFinancial.sections.gross, net: lastFinancial.sections.net },
        salaryForecast: {
          payments: lastAnnual.payments,
          proposal: lastAnnual.proposal,
          automatic: lastAnnual.automatic,
          issue: lastAnnual.issue,
        },
      },
    };
    const changed = actual.projection.sources
      .flatMap((source) => source.shifts)
      .find((entry) => entry.startTime && entry.endTime);
    sql
      .prepare("UPDATE shift_entries SET end_time=?,revision=revision+1 WHERE id=?")
      .run(changed.endTime === "23:50" ? "23:40" : "23:50", changed.id);
    entries = await api.listCalendarEntries(db);
    const edit = { ...request, context: { ...request.context, entries } };
    const value = await calculate(edit);
    assert.deepEqual(
      normalize(value),
      normalize(await drain(api.prepareAnalysisSalarySteps(edit, api.analysisSalaryKey(edit)))),
      "End-time edit parity",
    );
    fixture.edited = { request: edit, value };
    const empty = {
      ...edit,
      settings: null,
      annualPayments: [],
      payment: { ...edit.payment, sourceSettings: [] },
    };
    const noNet = await calculate(empty);
    assert.deepEqual(
      normalize(noNet),
      normalize(await drain(api.prepareAnalysisSalarySteps(empty, api.analysisSalaryKey(empty)))),
      "No net setup parity",
    );
    fixture.empty = { request: empty, value: noNet };
    sql
      .prepare("INSERT INTO dev_test_backups(month,payload,run_id,created_at) VALUES(?,?,?,?)")
      .run(request.month, "{}", "salary-preparation-test", "2026-01-01T00:00:00Z");
    const testRequest = {
      ...edit,
      settings: null,
      context: { ...edit.context, testMonths: [request.month] },
    };
    const testValue = await calculate(testRequest),
      testExpected = await drain(
        api.prepareAnalysisSalarySteps(testRequest, api.analysisSalaryKey(testRequest)),
      );
    assert.deepEqual(
      normalize(testValue),
      normalize(testExpected),
      "Test-month projection and annual readiness parity",
    );
    fixture.testMonth = { request: testRequest, value: testValue };
    sql.prepare("DELETE FROM dev_test_backups").run();
    const prior = process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION;
    process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION = "1";
    try {
      const calculator = api.createStoredMonthlyRustNetCalculator(db, transport, diagnosis);
      assert.ok(calculator.prepare);
      const [prepared, net] = await Promise.all([calculator.prepare(edit), calculator(edit)]);
      assert.deepEqual(normalize(prepared), normalize(value));
      assert.deepEqual(normalize(net), normalize(value.forecast));
      sharedOwnerVerified = true;
    } finally {
      if (prior === undefined) delete process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION;
      else process.env.EXPO_PUBLIC_RUST_SALARY_PREPARATION = prior;
    }
    await assert.rejects(
      calculate({
        ...edit,
        annualPayments: [
          ...edit.annualPayments,
          {
            revision: 1,
            payoutMonth: request.month,
            grossCents: 12345,
            netBasis: { kind: "CONSTANT_PAY" },
          },
        ],
      }),
      /RUST_SALARY_PAYMENTS_SUPERSEDED/,
    );
  }
  sql.close();
}
assert.ok(
  fixture?.edited && fixture.empty && sharedOwnerVerified,
  "Missing real native integration coverage",
);
writeFileSync(
  path.join(output, "monthly-rust-salary-preparation.fixture.json"),
  JSON.stringify(fixture, null, 2) + "\n",
);
const proof = {
  passed: true,
  cases: results.length,
  excluded,
  sharedOwnerVerified,
  maxReplyBytes,
  calls,
  engineVersion: info.engineVersion,
  endTimeEdit: true,
  emptyNetSetup: true,
  testMonthParity: true,
  paymentMismatchRejected: true,
  results,
};
writeFileSync(
  path.join(output, "salary-preparation-results.json"),
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(JSON.stringify({ ...proof, results: undefined, excluded: excluded.length }));
