import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import path from "node:path";
const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(
  baseline.acceptedSource,
  "e6bcc3aab914605ea0ebcc34407d42f319e993051fd840b39d1d2fb3f5338a63",
);
const allowed = new Set([
  "docs/performance/rust-annual-ota-buffer-fix.md",
  "scripts/verify-rust-annual-buffer-scope.mjs",
  "scripts/test-annual-bridge-wasm.mjs",
  "src/features/analysis/annual-rust-month-totals.ts",
  "src/features/analysis/annual-rust-month-totals.test.ts",
  "src/features/analysis/monthly-rust-finance.ts",
  "src/features/analysis/annual-rust-bridge.ts",
  "src/features/analysis/use-annual-net-pay.ts",
  "src/features/analysis/analysis-cache-version.generated.ts",
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
for (const [file, expected] of Object.entries(baseline.files)) {
  if (hash(file) !== expected) {
    assert.ok(allowed.has(file), "Outside annual data scope: " + file);
    changed.push(file);
  }
}
for (const file of files)
  assert.ok(baseline.files[file] || allowed.has(file), "Unexpected added file: " + file);
function jsx(file) {
  const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    nodes = [];
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
const background = "src/features/analysis/annual-analysis-background-preparation.tsx";
assert.deepEqual(
  jsx(background),
  jsx(path.resolve("../rust-annual-integration-20261112", background)),
  "Rendered JSX changed",
);
console.log(
  JSON.stringify({
    passed: true,
    baselineFiles: Object.keys(baseline.files).length,
    changed,
    added: files.filter((file) => !baseline.files[file]),
    renderedJsxUnchanged: true,
    allOtherUiByteIdentical: true,
    nativeFilesByteIdentical: true,
    rootConfigByteIdentical: true,
    testFlightBaselineUnchanged: true,
  }),
);
