import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(path.resolve(process.cwd()), path.resolve(baseline.root));
assert.equal(baseline.acceptedUpdate, "01a1e10b-a501-7176-ad09-fa10a0f57039");
assert.equal(
  baseline.sourceDigest,
  "24aa6e85cc4de91c7b94fa70e779ddd8cce2ed2f5f398f00ad0b08bfc15c5c78",
);
const allowed = new Set([
  "docs/performance/rust-net-bridge-package2.md",
  "scripts/test-net-bridge-wasm.mjs",
  "scripts/verify-rust-net-scope.mjs",
  "releases/testflight/build-9.reviewed-changes.json",
  "src/features/analysis/analysis-cache-version.generated.ts",
  "src/features/analysis/monthly-rust-bridge.ts",
  "src/features/analysis/monthly-rust-source.ts",
  "src/features/analysis/monthly-rust-finance.ts",
  "src/features/analysis/monthly-rust-net.ts",
  "src/features/analysis/monthly-rust-net.fixture.json",
  "src/features/analysis/monthly-rust-net.test.ts",
  "src/features/analysis/monthly-rust-net-integration.component.test.tsx",
  "src/features/analysis/use-monthly-rust-net-calculator.ts",
  "src/features/analysis/analysis-salary.ts",
  "src/features/analysis/persistent-salary-value.ts",
  "src/features/analysis/use-prepared-analysis-salary.ts",
  "src/features/analysis/analysis-month-data.tsx",
  "src/features/analysis/analysis-warmup-runtime.ts",
  "src/features/analysis/analysis-background-preparation.tsx",
  "src/features/analysis/premium-details-screen.tsx",
  "src/features/salary/use-automatic-net-pay.ts",
  "src/features/salary/use-rust-automatic-net-pay.ts",
  "src/features/salary/use-rust-automatic-net-pay.component.test.tsx",
]);
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const seen = new Set(),
  changed = [];
for (const entry of baseline.files) {
  seen.add(entry.path);
  if (hash(entry.path) !== entry.sha256) {
    assert.ok(allowed.has(entry.path), "Outside net package scope: " + entry.path);
    changed.push(entry.path);
  }
}
const files = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
for (const file of files)
  assert.ok(seen.has(file) || allowed.has(file), "Unexpected new file: " + file);
function jsx(file) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      nodes.push(node.getText(source));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return nodes;
}
const original = path.resolve("../rust-annual-integration-20261112");
const uiFiles = [
  "src/features/analysis/analysis-month-data.tsx",
  "src/features/analysis/analysis-background-preparation.tsx",
  "src/features/analysis/premium-details-screen.tsx",
];
for (const file of uiFiles)
  assert.deepEqual(jsx(file), jsx(path.join(original, file)), "Rendered JSX changed: " + file);
console.log(
  JSON.stringify({
    passed: true,
    referenceFiles: baseline.files.length,
    changedExistingFiles: changed,
    addedFiles: files.filter((file) => !seen.has(file)),
    renderedJsxUnchanged: uiFiles,
    allOtherUiByteIdentical: true,
    nativeInputsByteIdentical: true,
    acceptedTestFlightBaselineUnchanged: true,
  }),
);
