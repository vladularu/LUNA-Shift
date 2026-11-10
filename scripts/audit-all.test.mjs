import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { evaluateDependencyAuditReport, runDependencyAudit } from "./audit-all.mjs";
import { ZOD_ADVISORY_URL, verifyZodHardening } from "./zod-hardening.mjs";

const require = createRequire(import.meta.url);
const { load: loadYaml } = require("js-yaml");
const { satisfies } = require("semver");
const advisory = (severity = "high") => ({
  name: "dev-tool",
  dependency: "dev-tool",
  source: 101,
  title: "Development server vulnerability",
  url: "https://github.com/advisories/GHSA-test-test-test",
  severity,
  range: "<2.0.0",
});
const vulnerability = (cause = advisory()) => ({
  severity: cause.severity,
  via: [cause],
  nodes: ["node_modules/dev-tool"],
  isDirect: false,
});
const report = (vulnerabilities = {}) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: {
    vulnerabilities: Object.fromEntries([
      ...["info", "low", "moderate", "high", "critical"].map((severity) => [
        severity,
        Object.values(vulnerabilities).filter((value) => value?.severity === severity).length,
      ]),
      ["total", Object.keys(vulnerabilities).length],
    ]),
  },
});

function temporaryFolder(t) {
  const root = realpathSync(tmpdir());
  const folder = mkdtempSync(join(root, "luna-dependency-audit-"));
  t.after(() => {
    const target = realpathSync(folder);
    assert.equal(dirname(target), root);
    assert.ok(basename(target).startsWith("luna-dependency-audit-"));
    rmSync(target, { recursive: true, force: true });
  });
  return folder;
}

function runFixture(t, result, extra = {}) {
  const folder = temporaryFolder(t);
  const output = join(folder, "report.json");
  const logs = [];
  const errors = [];
  const commands = [];
  const code = runDependencyAudit({
    args: ["--output", output],
    verify: () => [],
    execute: (...command) => {
      commands.push(command);
      return result;
    },
    log: (value) => logs.push(value),
    error: (value) => errors.push(value),
    ...extra,
  });
  return { code, output: JSON.parse(readFileSync(output, "utf8")), logs, errors, commands };
}

test("development-only high and critical advisories block the full audit", () => {
  for (const severity of ["high", "critical"]) {
    const result = evaluateDependencyAuditReport(
      report({ "dev-tool": vulnerability(advisory(severity)) }),
    );
    assert.equal(result.blocking.length, 1);
    assert.equal(result.advisories[0].status, "blocking");
    assert.equal(result.packageCounts[severity], 1);
  }
});

test("moderate and low findings remain visible with paths and references", () => {
  for (const severity of ["moderate", "low"]) {
    const result = evaluateDependencyAuditReport(
      report({ "dev-tool": vulnerability(advisory(severity)) }),
    );
    assert.equal(result.blocking.length, 0);
    assert.equal(result.advisories[0].status, "reported");
    assert.equal(result.advisories[0].url, advisory().url);
    assert.deepEqual(result.advisories[0].nodes, ["node_modules/dev-tool"]);
  }
});

test("meta-package cycles do not hide a high advisory or loop", () => {
  const result = evaluateDependencyAuditReport(
    report({
      "dev-tool": { ...vulnerability(), via: ["meta", advisory()] },
      meta: { ...vulnerability(), via: ["dev-tool"] },
    }),
  );
  assert.equal(result.blocking.length, 1);
  assert.equal(result.advisories.length, 1);
});

test("an unresolved high meta-package remains blocking without a direct advisory", () => {
  assert.equal(
    evaluateDependencyAuditReport(report({ "dev-tool": { ...vulnerability(), via: [] } })).blocking
      .length,
    1,
  );
});

test("a genuine installed backport is preserved and a copied proof is rejected", () => {
  const proof = verifyZodHardening();
  const zod = {
    name: "zod",
    dependency: "zod",
    source: 1243066,
    severity: "high",
    title: "Zod can exhaust memory while validating oversized constrained collections",
    url: ZOD_ADVISORY_URL,
    range: "<4.6.6",
  };
  const input = report({ zod: { ...vulnerability(zod), nodes: proof.nodes } });
  const genuine = evaluateDependencyAuditReport(input, [undefined, undefined, proof]);
  assert.equal(genuine.blocking.length, 0);
  assert.equal(genuine.mitigated.length, 1);
  assert.equal(genuine.advisories[0].status, "mitigated");
  const copied = evaluateDependencyAuditReport(input, [undefined, undefined, { ...proof }]);
  assert.equal(copied.blocking.length, 1);
  const conflicting = evaluateDependencyAuditReport(
    report({
      zod: { ...input.vulnerabilities.zod, via: [zod, { ...zod, title: "Changed advisory" }] },
    }),
    [undefined, undefined, proof],
  );
  assert.equal(conflicting.blocking.length, 1);
  assert.equal(conflicting.advisories[0].status, "blocking");
});

test("malformed, partial and unknown-severity reports fail closed", () => {
  for (const invalid of [
    null,
    {},
    { vulnerabilities: [] },
    { vulnerabilities: {} },
    { auditReportVersion: 2, vulnerabilities: {} },
    {
      ...report(),
      metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, high: 1 } },
    },
    {
      ...report(),
      metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, total: 1 } },
    },
    { error: {}, vulnerabilities: {} },
    report({ x: null }),
    report({ x: { ...vulnerability(), severity: "unknown" } }),
    report({ x: { ...vulnerability(), nodes: null } }),
    report({ x: { ...vulnerability(), via: ["missing"] } }),
    report({ x: { ...vulnerability(), via: [null] } }),
    report({ x: { ...vulnerability(), severity: "low" } }),
  ])
    assert.throws(() => evaluateDependencyAuditReport(invalid));
});

test("the command includes development dependencies and persists a complete successful report", (t) => {
  const input = report({ "dev-tool": vulnerability(advisory("moderate")) });
  const result = runFixture(t, { status: 1, stdout: JSON.stringify(input) });
  assert.equal(result.code, 0);
  assert.equal(result.output.status, "passed");
  assert.deepEqual(result.output.npm, input);
  assert.equal(result.output.scope, "all-including-development");
  assert.ok(result.commands[0][1].includes("--include=dev"));
  assert.ok(!result.commands[0][1].includes("--omit=dev"));
  assert.ok(result.logs.some((line) => line.includes("reported/moderate")));
});

test("an npm high finding returns a failed gate and a blocked artifact", (t) => {
  const result = runFixture(t, {
    status: 1,
    stdout: JSON.stringify(report({ "dev-tool": vulnerability() })),
  });
  assert.equal(result.code, 1);
  assert.equal(result.output.status, "blocked");
  assert.equal(result.output.evaluation.blocking.length, 1);
});

test("an unresolved high finding is printed even without a direct advisory", (t) => {
  const result = runFixture(t, {
    status: 1,
    stdout: JSON.stringify(report({ "dev-tool": { ...vulnerability(), via: [] } })),
  });
  assert.equal(result.code, 1);
  assert.ok(result.errors.some((line) => line.includes("blocking/high")));
});

test("registry, process and JSON failures never produce a green artifact", (t) => {
  for (const result of [
    { error: new Error("timeout"), status: null },
    { status: null, signal: "SIGTERM", stdout: "{}" },
    { status: 2, stdout: JSON.stringify(report()) },
    { status: 0, stdout: "truncated" },
    { status: 1, stdout: JSON.stringify({ error: { message: "registry unavailable" } }) },
  ]) {
    const actual = runFixture(t, result);
    assert.equal(actual.code, 1);
    assert.equal(actual.output.status, "error");
  }
});

test("a verification failure replaces a stale successful artifact before contacting npm", (t) => {
  const folder = temporaryFolder(t);
  const output = join(folder, "report.json");
  writeFileSync(output, JSON.stringify({ status: "passed" }));
  let called = false;
  assert.equal(
    runDependencyAudit({
      args: ["--output", output],
      verify: () => {
        throw new Error("Backport altered");
      },
      execute: () => {
        called = true;
      },
      error: () => {},
    }),
    1,
  );
  assert.equal(called, false);
  assert.equal(JSON.parse(readFileSync(output, "utf8")).status, "error");
});

test("invalid CLI options fail before dependency verification or network access", () => {
  for (const args of [["--omit=dev"], ["--output"], ["--output", "--omit=dev"], ["--output", ""]]) {
    assert.equal(
      runDependencyAudit({
        args,
        verify: () => assert.fail("must not verify"),
        execute: () => assert.fail("must not execute"),
        error: () => {},
      }),
      1,
    );
  }
});

test("the installed and locked test toolchain stays on patched compatible versions", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const name of ["vitest", "@vitest/mocker", "@vitest/coverage-v8"]) {
    assert.ok(satisfies(require(`${name}/package.json`).version, ">=4.1.12 <5"), name);
    assert.ok(satisfies(lock.packages[`node_modules/${name}`].version, ">=4.1.12 <5"), name);
  }
  assert.ok(
    satisfies(require("vite/package.json").version, ">=8.1.6 <8.2 || >=8.2.4 <8.3 || >=8.3.3 <9"),
  );
  assert.ok(
    satisfies(
      lock.packages["node_modules/vite"].version,
      ">=8.1.6 <8.2 || >=8.2.4 <8.3 || >=8.3.3 <9",
    ),
  );
});

test("PR CI and the weekly read-only workflow execute and preserve the full audit", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(manifest.scripts["verify:full"].split(" && ").includes("npm run audit:all"));
  const ci = loadYaml(
    readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  );
  const weekly = loadYaml(
    readFileSync(new URL("../.github/workflows/dependency-audit.yml", import.meta.url), "utf8"),
  );
  for (const workflow of [ci, weekly]) {
    assert.equal(workflow.permissions.contents, "read");
    const steps =
      workflow === ci ? workflow.jobs["production-safety"].steps : workflow.jobs.audit.steps;
    assert.ok(steps.some((step) => step.run === "npm ci"));
    const audit = steps.find(
      (step) => step.run === "npm run audit:all -- --output artifacts/dependency-audit.json",
    );
    assert.ok(audit);
    if (workflow === ci) assert.equal(audit.if, "always()");
    const artifact = steps.find((step) => step.with?.path === "artifacts/dependency-audit.json");
    assert.equal(artifact.if, "always()");
    assert.match(artifact.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
  }
  assert.equal(weekly.on.schedule[0].cron, "23 7 * * 1");
  assert.ok(Object.hasOwn(weekly.on, "workflow_dispatch"));
});
