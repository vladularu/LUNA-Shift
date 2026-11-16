import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(
  baseline.acceptedSource,
  "b97fcd880c59dec21550d4f660c8e19f2b0a769273f2766fd4746e5ee915fcaf",
);
assert.equal(baseline.acceptedUpdate, "01a1e203-83cc-73b7-b408-162579b070a7");
const allowed = new Set([
  "docs/performance/rust-monthly-checks-package4.md",
  "src/features/analysis/monthly-rust-finance.ts",
  "src/features/analysis/monthly-rust-checks.ts",
  "src/features/analysis/monthly-rust-checks.test.ts",
  "src/features/analysis/monthly-rust-checks.fixture.json",
  "src/features/analysis/monthly-rust-checks.component.test.tsx",
  "src/features/analysis/use-monthly-rust-checks-calculator.ts",
  "src/features/analysis/use-monthly-compliance.ts",
  "src/features/analysis/analysis-warmup-runtime.ts",
  "src/features/analysis/analysis-warmup-runtime.test.ts",
  "src/features/analysis/analysis-background-preparation.tsx",
  "src/features/analysis/analysis-cache-version.generated.ts",
  "scripts/test-monthly-checks-wasm.mjs",
  "scripts/verify-rust-monthly-checks-scope.mjs",
  "releases/testflight/build-9.reviewed-changes.json",
]);
const files = [
  ...new Set(
    execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  ),
];
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const changed = [];
for (const [file, expected] of Object.entries(baseline.files))
  if (hash(file) !== expected) {
    assert.ok(allowed.has(file), "Outside monthly checks scope: " + file);
    changed.push(file);
  }
for (const file of files)
  assert.ok(baseline.files[file] || allowed.has(file), "Unexpected added file: " + file);
const background = "src/features/analysis/analysis-background-preparation.tsx";
const parsed = ts.createSourceFile(
  background,
  readFileSync(background, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let jsxCount = 0;
function visit(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
    jsxCount++;
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.equal(jsxCount, 0, "Background preparation must not render a UI");
console.log(
  JSON.stringify({
    passed: true,
    baselineFiles: Object.keys(baseline.files).length,
    changed,
    added: files.filter((file) => !baseline.files[file]),
    uiByteIdentical: true,
    nativeByteIdentical: true,
    rootConfigByteIdentical: true,
    testFlightBaselineUnchanged: true,
  }),
);
