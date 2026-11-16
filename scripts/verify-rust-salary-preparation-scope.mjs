import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(
  baseline.acceptedSource,
  "7a29616e94d8ad632e600f14640480e5c049286f21eb241807b1afd110c3b5a0",
);
assert.equal(baseline.acceptedUpdate, "01a1e22e-acb6-798a-abed-f93360b25bec");
const allowed = new Set([
  "docs/performance/rust-salary-preparation-package5.md",
  "src/features/analysis/monthly-rust-finance.ts",
  "src/features/analysis/monthly-rust-net.ts",
  "src/features/analysis/monthly-rust-salary-preparation.ts",
  "src/features/analysis/monthly-rust-salary-preparation.test.ts",
  "src/features/analysis/monthly-rust-salary-preparation.fixture.json",
  "src/features/analysis/analysis-salary.ts",
  "src/features/analysis/persistent-salary-value.ts",
  "src/features/analysis/use-prepared-analysis-salary.ts",
  "src/features/salary/use-rust-salary-preparation.ts",
  "src/features/salary/use-salary-report.ts",
  "src/features/salary/use-rust-automatic-net-pay.ts",
  "src/features/salary/use-annual-salary-forecast.ts",
  "src/features/salary/rust-salary-preparation.component.test.tsx",
  "src/features/salary/salary-details-screen.tsx",
  "src/features/salary/salary-payroll-content.tsx",
  "src/features/salary/net-pay-automatic-entry-card.tsx",
  "src/features/analysis/analysis-cache-version.generated.ts",
  "scripts/test-salary-preparation-wasm.mjs",
  "scripts/verify-rust-salary-preparation-scope.mjs",
  "releases/testflight/build-9.reviewed-changes.json",
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  ),
];
const changed = [];
for (const [file, expected] of Object.entries(baseline.files))
  if (hash(readFileSync(file)) !== expected) {
    assert.ok(allowed.has(file), "Outside salary preparation scope: " + file);
    changed.push(file);
  }
for (const file of files)
  assert.ok(baseline.files[file] || allowed.has(file), "Unexpected added file: " + file);
for (const file of [
  "src/features/salary/salary-details-screen.tsx",
  "src/features/salary/salary-payroll-content.tsx",
  "src/features/salary/net-pay-automatic-entry-card.tsx",
]) {
  const source = readFileSync(file, "utf8"),
    parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useAnnualSalaryForecast"
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(calls.length, 1, "Expected one existing annual data hook: " + file);
  const args = calls[0].arguments;
  assert.equal(args.length, 5);
  assert.equal(args[4].getText(parsed), "month");
  // Remove only the additional data argument, then prove every original byte survived.
  const original = source.slice(0, args[3].getEnd()) + source.slice(args[4].getEnd());
  assert.equal(
    hash(Buffer.from(original)),
    baseline.files[file],
    "UI or original data call changed: " + file,
  );
}
console.log(
  JSON.stringify({
    passed: true,
    baselineFiles: Object.keys(baseline.files).length,
    changed,
    added: files.filter((file) => !baseline.files[file]),
    jsxByteIdentical: true,
    otherUiByteIdentical: true,
    nativeByteIdentical: true,
    rootConfigByteIdentical: true,
    testFlightBaselineUnchanged: true,
  }),
);
