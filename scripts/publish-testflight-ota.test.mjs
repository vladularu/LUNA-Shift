import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertExportUnchanged,
  executeRelease,
  exportSnapshot,
  parseOptions,
} from "./publish-testflight-ota.mjs";
import { sha256 } from "./testflight-baseline.mjs";
function mock(failAt) {
  const calls = [];
  const step = (name, value) => async () => {
    calls.push(name);
    if (name === failAt) throw new Error(name + " rejected");
    return value;
  };
  return {
    calls,
    steps: {
      source: step("source"),
      live: step("live"),
      environment: step("environment"),
      contracts: step("contracts"),
      fingerprint: step("fingerprint", "runtime"),
      exportBundle: step("export", { bundle: "checked" }),
      exportUnchanged: step("exportUnchanged"),
      publish: step("publish", { id: "published" }),
      verifyDelivery: step("verifyDelivery", { checked: true }),
    },
  };
}
const plan = { runtime: "runtime", sourceDigest: "digest", dryRun: false };
test("dry run executes source/live/environment/contracts/runtime checks and never exports or publishes", async () => {
  const { calls, steps } = mock();
  const result = await executeRelease({ ...plan, dryRun: true }, steps);
  assert.deepEqual(calls, ["source", "live", "environment", "contracts", "fingerprint", "source"]);
  assert.equal(result.published, false);
});
test("source and live baseline are checked again immediately before publication", async () => {
  const { calls, steps } = mock();
  const result = await executeRelease(plan, steps);
  assert.deepEqual(calls, [
    "source",
    "live",
    "environment",
    "contracts",
    "fingerprint",
    "source",
    "export",
    "source",
    "live",
    "exportUnchanged",
    "publish",
    "verifyDelivery",
  ]);
  assert.equal(result.published, true);
});
for (const failAt of [
  "source",
  "live",
  "environment",
  "contracts",
  "fingerprint",
  "export",
  "exportUnchanged",
]) {
  test("no publication if " + failAt + " fails", async () => {
    const { calls, steps } = mock(failAt);
    await assert.rejects(executeRelease(plan, steps));
    assert.equal(calls.includes("publish"), false);
  });
}
test("a changed source during export blocks publication", async () => {
  const { calls, steps } = mock();
  let checks = 0;
  steps.source = async () => {
    checks++;
    if (checks === 3) throw new Error("changed during export");
  };
  await assert.rejects(executeRelease(plan, steps), /changed during export/);
  assert.equal(calls.includes("publish"), false);
});
test("a concurrently published baseline blocks publication", async () => {
  const { calls, steps } = mock();
  let checks = 0;
  steps.live = async () => {
    checks++;
    if (checks === 2) throw new Error("baseline changed");
  };
  await assert.rejects(executeRelease(plan, steps), /baseline changed/);
  assert.equal(calls.includes("publish"), false);
});
test("runtime cannot be overridden through the release plan", async () => {
  const { calls, steps } = mock();
  await assert.rejects(executeRelease({ ...plan, runtime: "other" }, steps), /runtime/);
  assert.equal(calls.includes("publish"), false);
});
test("delivery verification failure is reported after the single publication without a retry", async () => {
  const { calls, steps } = mock("verifyDelivery");
  await assert.rejects(executeRelease(plan, steps));
  assert.equal(calls.filter((c) => c === "publish").length, 1);
});
test("rejects bypass flags, incomplete plans and shell metacharacters", () => {
  for (const args of [
    [],
    ["--publish"],
    ["--publish", "--dry-run"],
    ["--skip-bundler"],
    ["--runtime-version", "other"],
    ["--channel", "preview"],
    ["--prepared", "../file"],
    ["--message"],
    ["--message", "bad & command"],
    ["--message", "bad$()"],
    ["--message", "bad\nmessage"],
  ])
    assert.throws(() => parseOptions(args));
  assert.equal(parseOptions(["--dry-run"]).dryRun, true);
  assert.equal(
    parseOptions(["--publish", "--message", "Widgets und Netto fuer Build 9"]).message,
    "Widgets und Netto fuer Build 9",
  );
});
test("checks exported metadata, bundle and all assets for mutation", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-export-"));
  try {
    const meta = join(root, "metadata.json"),
      bundle = join(root, "bundle.hbc"),
      asset = join(root, "asset.png");
    for (const path of [meta, bundle, asset]) writeFileSync(path, "original");
    const exported = {
      metadataPath: meta,
      metadataSha256: sha256("original"),
      bundlePath: bundle,
      bundleSha256: sha256("original"),
      assets: [{ path: asset, sha256: sha256("original") }],
    };
    assert.doesNotThrow(() => assertExportUnchanged(exported));
    for (const path of [meta, bundle, asset]) {
      writeFileSync(path, "changed");
      assert.throws(() => assertExportUnchanged(exported));
      writeFileSync(path, "original");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export metadata cannot point outside the checked iOS export directory", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-export-scope-"));
  try {
    const output = "artifacts/ios",
      directory = join(root, output);
    mkdirSync(join(directory, "assets"), { recursive: true });
    writeFileSync(join(directory, "bundle.hbc"), "bundle");
    writeFileSync(join(directory, "assets/asset"), "asset");
    writeFileSync(join(root, "outside.hbc"), "outside");
    const metadata = {
      version: 0,
      fileMetadata: { ios: { bundle: "bundle.hbc", assets: [{ path: "assets/asset" }] } },
    };
    const save = () => writeFileSync(join(directory, "metadata.json"), JSON.stringify(metadata));
    save();
    assert.equal(exportSnapshot(root, output).bundleSha256, sha256("bundle"));
    metadata.fileMetadata.ios.bundle = "../../outside.hbc";
    save();
    assert.throws(() => exportSnapshot(root, output), /inside the checkout/);
    metadata.fileMetadata.ios.bundle = "bundle.hbc";
    metadata.fileMetadata.ios.assets[0].path = "../../outside.hbc";
    save();
    assert.throws(() => exportSnapshot(root, output), /inside the checkout/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
