import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  calculationContract,
  GENERATED_PATH,
  renderContract,
  verifyContract,
} from "./analysis-cache-contract.mjs";
describe("analysis cache calculation compatibility", () => {
  let root;
  const put = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "luna-calculation-contract-"));
    put(
      "package.json",
      JSON.stringify({
        dependencies: { "@js-temporal/polyfill": "0.5.1", "lucide-react-native": "0.1.0" },
      }),
    );
    put(
      "package-lock.json",
      JSON.stringify({ packages: { "node_modules/@js-temporal/polyfill": { version: "0.5.1" } } }),
    );
    put("src/engine/calculation.ts", "export const gross = 1;\n");
    put("src/features/analysis/analysis-salary.ts", "export const salary = 1;\n");
  });
  afterEach(() => {
    assert(
      path
        .resolve(root)
        .startsWith(path.join(path.resolve(tmpdir()), "luna-calculation-contract-")),
    );
    rmSync(root, { recursive: true, force: true });
  });
  test("presentation, hooks and test-only changes preserve compatibility", () => {
    const before = calculationContract(root).version;
    put("src/features/analysis/analysis-screen.tsx", "export const screen = 'new';\n");
    put("src/features/analysis/use-theme.ts", "export const theme = 'new';\n");
    put("src/engine/calculation.test.ts", "export const test = 7;\n");
    put("src/features/analysis/salary-test-fixtures.ts", "export const fixture = 2;\n");
    put(
      "package.json",
      JSON.stringify({
        dependencies: { "@js-temporal/polyfill": "0.5.1", "lucide-react-native": "0.2.0" },
      }),
    );
    assert.equal(calculationContract(root).version, before);
  });
  test("calculation edits, added domain sources, rules and calculator dependency changes invalidate", () => {
    for (const [file, content] of [
      ["src/engine/calculation.ts", "export const gross = 2;\n"],
      ["src/domain/new-rules.ts", "export const rate = 3;\n"],
      ["src/rules/catalog.json", '{"version":2}'],
      ["src/features/analysis/persistent-salary-value.ts", "export const accepts = false;\n"],
      [
        "package-lock.json",
        JSON.stringify({
          packages: { "node_modules/@js-temporal/polyfill": { version: "0.6.0" } },
        }),
      ],
    ]) {
      const before = calculationContract(root).version;
      put(file, content);
      assert.notEqual(calculationContract(root).version, before);
    }
  });
  test("generated identity is deterministic, portable across line endings and checked for drift", () => {
    const before = calculationContract(root);
    put(GENERATED_PATH, renderContract(before));
    assert.equal(verifyContract(root).version, before.version);
    put("src/engine/calculation.ts", "export const gross = 1;\r\n");
    assert.equal(verifyContract(root).version, before.version);
    put("src/engine/calculation.ts", "export const gross = 10;\n");
    assert.throws(() => verifyContract(root), /contract is stale/);
    put(GENERATED_PATH, renderContract(calculationContract(root)));
    assert.doesNotThrow(() => verifyContract(root));
  });
});
