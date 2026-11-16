import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { format } from "prettier";

const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
const current = process.cwd();
assert.equal(path.resolve(current), path.resolve(baseline.trial));
const allowed = new Set([
  "docs/performance/rust-month-adapter-trial.md",
  "scripts/test-month-trial-wasm.mjs",
  "scripts/verify-month-trial-scope.mjs",
  "src/features/analysis/monthly-rust-bridge.ts",
  "src/features/analysis/monthly-rust-source.ts",
  "src/features/analysis/monthly-rust-sql.ts",
  "src/features/analysis/monthly-rust-catalog.ts",
  "src/features/analysis/monthly-rust-transport.ts",
  "src/features/analysis/monthly-rust-transport.native.ts",
  "src/features/analysis/use-monthly-rust-calculator.ts",
  "src/features/analysis/monthly-rust-bridge.test.ts",
  "src/features/analysis/monthly-rust-integration.component.test.tsx",
  "src/features/analysis/monthly-rust-native.fixture.json",
]);
const hooks = new Set([
  "src/features/analysis/use-prepared-monthly-analysis.ts",
  "src/features/analysis/analysis-month-data.tsx",
]);
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const seen = new Set();
for (const entry of baseline.files) {
  seen.add(entry.path);
  assert.equal(
    hash(path.join(baseline.original, entry.path)),
    entry.sha256,
    "Reference changed: " + entry.path,
  );
  if (!hooks.has(entry.path))
    assert.equal(
      hash(path.join(current, entry.path)),
      entry.sha256,
      "Outside trial scope: " + entry.path,
    );
}
let prepared = readFileSync(
  path.join(baseline.original, "src/features/analysis/use-prepared-monthly-analysis.ts"),
  "utf8",
)
  .replace(
    'import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";',
    'import { readSharedAnalysisResult, requestSharedAnalysis } from "./shared-analysis-tasks";\nimport { monthlyRustSteps, type MonthlyRustCalculator } from "./monthly-rust-bridge";',
  )
  .replace(
    "persistent: PersistentAnalysisCache | null = null,",
    "persistent: PersistentAnalysisCache | null = null,\n  rust: MonthlyRustCalculator | null = null,",
  )
  .replace(
    "steps: () => calculateMonthlyAnalysisSteps(current),",
    "steps: () => rust ? monthlyRustSteps(current, rust) : calculateMonthlyAnalysisSteps(current),",
  )
  .replace(
    "[key, resolver, settled, persistent, shared]",
    "[key, resolver, settled, persistent, shared, rust]",
  );
let data = readFileSync(
  path.join(baseline.original, "src/features/analysis/analysis-month-data.tsx"),
  "utf8",
)
  .replace(
    'import { useSalaryPaymentPreferences } from "@/features/salary/salary-payment-preferences";',
    'import { useSalaryPaymentPreferences } from "@/features/salary/salary-payment-preferences";\nimport { useMonthlyRustCalculator } from "./use-monthly-rust-calculator";',
  )
  .replace(
    "const { resolver: ruleResolver } = useRuleCatalogRuntime();",
    "const { resolver: ruleResolver, diagnosis } = useRuleCatalogRuntime();\n  const rust = useMonthlyRustCalculator(diagnosis);",
  )
  .replace(
    "usePreparedMonthlyAnalysis(monthlyRequest, active, distance, persistent)",
    "usePreparedMonthlyAnalysis(monthlyRequest, active, distance, persistent, rust)",
  );
for (const [file, expected] of [
  ["src/features/analysis/use-prepared-monthly-analysis.ts", prepared],
  ["src/features/analysis/analysis-month-data.tsx", data],
])
  assert.equal(
    await format(readFileSync(path.join(current, file), "utf8"), { parser: "typescript" }),
    await format(expected, { parser: "typescript" }),
    "Unexpected hook change: " + file,
  );
const files = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
for (const file of files)
  assert.ok(seen.has(file) || allowed.has(file), "Unexpected new file: " + file);
console.log(
  JSON.stringify({
    passed: true,
    referenceFiles: baseline.files.length,
    changedExistingFiles: [...hooks],
    addedFiles: files.filter((f) => !seen.has(f)).length,
    protectedUiUnchanged: true,
  }),
);
