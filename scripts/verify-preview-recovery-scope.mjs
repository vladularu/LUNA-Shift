import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Explicit package-1 scope. Native files are additionally pinned to the frozen
// import manifest, while every other original file remains byte-identical.
const [baselinePath, nativePath] = process.argv.slice(2);
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const native = JSON.parse(readFileSync(nativePath, "utf8"));
assert.equal(path.resolve(process.cwd()), path.resolve(baseline.trial));
assert.equal(
  native.archiveSha256,
  "1169c7bf8ee662c44a06e0cde46862ecdf0b52442c383f5ac3f4b9e54ce380d8",
);
const allowed = new Set([
  ".prettierignore",
  "docs/performance/rust-month-adapter-trial.md",
  "docs/performance/rust-preview-recovery.md",
  "scripts/test-month-trial-wasm.mjs",
  "scripts/verify-month-trial-scope.mjs",
  "scripts/verify-preview-recovery-scope.mjs",
  "scripts/analysis-cache-contract.mjs",
  "scripts/analysis-cache-contract.test.mjs",
  "scripts/fingerprint-config.test.mjs",
  "releases/testflight/build-9.reviewed-changes.json",
  "src/features/analysis/analysis-cache-version.generated.ts",
  "src/features/analysis/monthly-analysis.ts",
  "src/features/analysis/use-prepared-monthly-analysis.ts",
  "src/features/analysis/analysis-month-data.tsx",
  "src/features/analysis/analysis-warmup-runtime.ts",
  "src/features/analysis/analysis-warmup-runtime.test.ts",
  "src/features/analysis/analysis-background-preparation.tsx",
  "src/features/analysis/monthly-rust-bridge.ts",
  "src/features/analysis/monthly-rust-source.ts",
  "src/features/analysis/monthly-rust-sql.ts",
  "src/features/analysis/monthly-rust-catalog.ts",
  "src/features/analysis/monthly-rust-engine-version.ts",
  "src/features/analysis/monthly-rust-transport.ts",
  "src/features/analysis/monthly-rust-transport.native.ts",
  "src/features/analysis/use-monthly-rust-calculator.ts",
  "src/features/analysis/monthly-rust-bridge.test.ts",
  "src/features/analysis/monthly-rust-integration.component.test.tsx",
  "src/features/analysis/monthly-rust-native.fixture.json",
]);
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const fixed = new Map(native.files.map((entry) => [entry.path, entry.sha256]));
assert.equal(
  readFileSync(".prettierignore", "utf8").replace(/\r\n/g, "\n"),
  readFileSync(path.join(baseline.original, ".prettierignore"), "utf8").trimEnd() +
    "\n\n# Frozen byte artifacts: exact hashes are checked by verify-preview-recovery-scope.mjs.\n/modules/luna-engine/reference/\n",
  "Unexpected format-check exemption",
);
for (const [file, digest] of fixed)
  assert.equal(hash(file), digest, "Frozen Build-54 input changed: " + file);
const original = new Set();
const changed = [];
for (const entry of baseline.files) {
  original.add(entry.path);
  assert.equal(
    hash(path.join(baseline.original, entry.path)),
    entry.sha256,
    "Reference changed: " + entry.path,
  );
  const after = hash(entry.path);
  if (after !== entry.sha256) {
    assert.ok(
      allowed.has(entry.path) || fixed.has(entry.path),
      "Outside package scope: " + entry.path,
    );
    changed.push(entry.path);
  }
}
const files = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
for (const file of files)
  assert.ok(
    original.has(file) || allowed.has(file) || fixed.has(file),
    "Unexpected new file: " + file,
  );
assert.equal(
  hash("releases/testflight/build-9.accepted.json"),
  hash(path.join(baseline.original, "releases/testflight/build-9.accepted.json")),
);
console.log(
  JSON.stringify({
    passed: true,
    referenceFiles: baseline.files.length,
    frozenNativeInputs: fixed.size,
    changedExistingFiles: changed,
    addedFiles: files.filter((file) => !original.has(file)).length,
    protectedUiUnchanged: true,
    acceptedTestFlightBaselineUnchanged: true,
  }),
);
