import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  BASELINE_PATH,
  CRITICAL_FILES,
  REVIEW_PATH,
  assertServedBaseline,
  compareSources,
  checkCandidate,
  confinedPath,
  contentHash,
  decodeManifest,
  fetchServedManifest,
  inventoryDigest,
  isReleaseSource,
  safePath,
  sha256,
  sourceInventory,
} from "./testflight-baseline.mjs";
const H = "a".repeat(64),
  N = "b".repeat(64);
const id = "00000000-0000-4000-8000-000000000001";
function baseline(files = [{ path: "src/widget.ts", sha256: H }]) {
  return {
    schemaVersion: 1,
    build: 9,
    platform: "ios",
    channel: "production",
    projectId: id,
    buildId: id,
    updateId: id,
    group: id,
    runtime: "c".repeat(40),
    bundleSha256: H,
    sourceManifestSha256: H,
    deviceAcceptance: {
      status: "accepted",
      date: "2026-11-04",
      quote: "Auf iPhone passt das",
      flows: { calendar: "passed", widgets: "passed", netPay: "passed", invitation: "passed" },
    },
    assets: [{ key: "asset", sha256: N }],
    files,
  };
}
const review = (changes = []) => ({ schemaVersion: 1, baselineUpdateId: id, changes });
const approved = (path, kind, sha256) => ({
  path,
  kind,
  sha256,
  reason: "Explicitly reviewed source change for this candidate.",
});
function manifest() {
  return {
    id,
    runtimeVersion: "c".repeat(40),
    extra: {
      expoClient: {
        extra: { appVariant: "production" },
        ios: { bundleIdentifier: "com.lunashift.app" },
      },
    },
    launchAsset: { hash: Buffer.from(H, "hex").toString("base64url") },
    assets: [{ key: "asset", hash: Buffer.from(N, "hex").toString("base64url") }],
  };
}
test("unchanged accepted source passes without an allowance", () => {
  assert.equal(compareSources(baseline(), review(), baseline().files).ok, true);
});
for (const [name, current] of [
  ["modified", [{ path: "src/widget.ts", sha256: N }]],
  ["removed", []],
  ["added", [...baseline().files, { path: "app/new.tsx", sha256: N }]],
]) {
  test("blocks an unreviewed " + name + " production file", () => {
    const result = compareSources(baseline(), review(), current);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.includes(name)));
  });
}
test("review binds the exact content hash and action, not just the filename", () => {
  const r = review([approved("src/widget.ts", "modified", N)]);
  assert.equal(compareSources(baseline(), r, [{ path: "src/widget.ts", sha256: N }]).ok, true);
  assert.equal(
    compareSources(baseline(), r, [{ path: "src/widget.ts", sha256: "d".repeat(64) }]).ok,
    false,
  );
  assert.equal(compareSources(baseline(), r, []).ok, false);
});
test("explicit additions and removals are checked individually", () => {
  const r = review([
    approved("src/widget.ts", "removed", null),
    approved("app/new.tsx", "added", N),
  ]);
  assert.equal(compareSources(baseline(), r, [{ path: "app/new.tsx", sha256: N }]).ok, true);
});
test("stale review entries fail when the file returns to its accepted contents", () => {
  assert.equal(
    compareSources(baseline(), review([approved("src/widget.ts", "modified", N)]), baseline().files)
      .ok,
    false,
  );
});
test("review cannot refer to an unrelated release or nonexistent file", () => {
  assert.throws(() =>
    compareSources(
      baseline(),
      { ...review(), baselineUpdateId: id.replace(/1$/, "2") },
      baseline().files,
    ),
  );
  assert.equal(
    compareSources(baseline(), review([approved("src/missing.ts", "added", N)]), baseline().files)
      .ok,
    false,
  );
});
test("rejects duplicate and wildcard approvals", () => {
  const entry = approved("src/widget.ts", "modified", N);
  assert.throws(() => compareSources(baseline(), review([entry, entry]), baseline().files));
  assert.throws(() =>
    compareSources(baseline(), review([approved("src/*", "modified", N)]), baseline().files),
  );
});
test("an unaccepted or empty baseline never passes", () => {
  assert.throws(() =>
    compareSources({ ...baseline(), deviceAcceptance: { status: "pending" } }, review(), []),
  );
  assert.throws(() => compareSources(baseline([]), review(), []));
});
test("duplicate baseline or candidate paths fail", () => {
  assert.throws(() =>
    compareSources(baseline([...baseline().files, ...baseline().files]), review(), []),
  );
  assert.throws(() =>
    compareSources(baseline(), review(), [...baseline().files, ...baseline().files]),
  );
});
test("only safe relative production paths participate", () => {
  for (const path of [
    "../src/a.ts",
    "/src/a.ts",
    "src/../a.ts",
    "C:/src/a.ts",
    "src\\a.ts",
    "src//a.ts",
    "src/*.ts",
  ])
    assert.equal(safePath(path), false, path);
  for (const path of [
    "src/a.ts",
    "app/(tabs)/_layout.tsx",
    "modules/a/ios/A.swift",
    "assets/font.ttf",
  ])
    assert.equal(isReleaseSource(path), true, path);
  for (const path of [
    "src/a.test.ts",
    "src/a.component.test.tsx",
    "docs/a.md",
    ".env",
    "assets/brand/lunashift/app-icon-2026-11.jpg",
  ])
    assert.equal(isReleaseSource(path), false, path);
});
test("line endings are portable and binary assets remain byte sensitive", () => {
  assert.equal(
    contentHash("src/a.ts", Buffer.from("x\r\n")),
    contentHash("src/a.ts", Buffer.from("x\n")),
  );
  assert.notEqual(
    contentHash("assets/a.png", Buffer.from("x\r\n")),
    contentHash("assets/a.png", Buffer.from("x\n")),
  );
  assert.throws(() => contentHash("src/a.ts", Buffer.from([255])));
});
test("source digest is independent of filesystem ordering", () => {
  const a = [
    { path: "src/b.ts", sha256: H },
    { path: "src/a.ts", sha256: N },
  ];
  assert.equal(inventoryDigest(a), inventoryDigest([...a].reverse()));
});
test("inventory detects added source and missing source without relying on git status", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-release-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "one\n");
    writeFileSync(join(root, ".env"), "SECRET");
    assert.deepEqual(sourceInventory(root), [{ path: "src/a.ts", sha256: sha256("one\n") }]);
    writeFileSync(join(root, "src", "new.ts"), "new\n");
    assert.equal(sourceInventory(root).length, 2);
    rmSync(join(root, "src", "a.ts"));
    assert.deepEqual(
      sourceInventory(root).map((entry) => entry.path),
      ["src/new.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test(
  "source symlinks cannot hide files outside the manifest",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "luna-release-link-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "outside.ts"), "hidden");
      symlinkSync(join(root, "outside.ts"), join(root, "src", "a.ts"));
      assert.throws(() => sourceInventory(root), /symlink/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("parses JSON and multipart update responses without treating extensions as a manifest", () => {
  const m = manifest();
  assert.deepEqual(decodeManifest("application/expo+json", JSON.stringify(m)), m);
  const raw =
    '--sample\r\nContent-Disposition: form-data; name="extensions"\r\n\r\n{}\r\n--sample\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\n\r\n' +
    JSON.stringify(m) +
    "\r\n--sample--\r\n";
  assert.deepEqual(decodeManifest('multipart/mixed; boundary="sample"', raw), m);
  assert.throws(() => decodeManifest("multipart/mixed", raw), /boundary/);
  assert.throws(() => decodeManifest("multipart/mixed; boundary=other", raw), /no manifest/);
});
test("live baseline binds runtime, variant, update, bundle and every asset", () => {
  assert.doesNotThrow(() => assertServedBaseline(baseline(), manifest()));
  for (const mutate of [
    (m) => (m.id = id.replace(/1$/, "2")),
    (m) => (m.runtimeVersion = "wrong"),
    (m) => (m.extra.expoClient.extra.appVariant = "internal"),
    (m) => (m.launchAsset.hash = Buffer.from(N, "hex").toString("base64url")),
    (m) => (m.assets = []),
    (m) => (m.assets[0].hash = Buffer.from(H, "hex").toString("base64url")),
    (m) => (m.assets[0].hash = "bad"),
  ]) {
    const value = manifest();
    mutate(value);
    assert.throws(() => assertServedBaseline(baseline(), value));
  }
});
test("rejects duplicate asset keys even when the count matches", () => {
  const b = baseline();
  b.assets.push({ key: "second", sha256: H });
  const m = manifest();
  m.assets.push(m.assets[0]);
  assert.throws(() => assertServedBaseline(b, m));
});
test("update-service outages fail closed instead of assuming the baseline", async () => {
  await assert.rejects(
    fetchServedManifest(baseline(), async () => ({ status: 204 })),
    /HTTP 204/,
  );
  await assert.rejects(
    fetchServedManifest(baseline(), async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  let url, options;
  const m = await fetchServedManifest(baseline(), async (u, o) => {
    url = u;
    options = o;
    return new Response(JSON.stringify(manifest()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.equal(url, "https://u.expo.dev/" + id);
  assert.equal(options.headers["expo-channel-name"], "production");
  assert.deepEqual(m, manifest());
});
test("release artifact paths must stay inside the checkout", () => {
  const root = join(tmpdir(), "checkout");
  assert.equal(confinedPath(root, "artifacts/plan.json"), join(root, "artifacts", "plan.json"));
  assert.throws(() => confinedPath(root, "../outside.json"));
  assert.throws(() => confinedPath(root, "."));
  if (process.platform === "win32") assert.throws(() => confinedPath(root, "Z:\\outside.json"));
});

test("Expo dynamic routes are literal protected source paths", () => {
  assert.equal(safePath("app/[id].tsx"), true);
  assert.equal(isReleaseSource("app/[...slug].tsx"), true);
  const current = [...baseline().files, { path: "app/[id].tsx", sha256: N }];
  assert.equal(compareSources(baseline(), review(), current).ok, false);
  assert.equal(
    compareSources(baseline(), review([approved("app/[id].tsx", "added", N)]), current).ok,
    true,
  );
});
test("mandatory regression tests cannot be removed even with an explicit removal entry", () => {
  const root = mkdtempSync(join(tmpdir(), "luna-critical-"));
  try {
    for (const path of CRITICAL_FILES) {
      const absolute = join(root, path);
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, "checked\n");
    }
    mkdirSync(join(root, "releases/testflight"), { recursive: true });
    const files = sourceInventory(root);
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify(baseline(files)));
    writeFileSync(join(root, REVIEW_PATH), JSON.stringify(review()));
    assert.equal(checkCandidate(root).report.ok, true);
    rmSync(join(root, CRITICAL_FILES[0]));
    writeFileSync(
      join(root, REVIEW_PATH),
      JSON.stringify(review([approved(CRITICAL_FILES[0], "removed", null)])),
    );
    assert.throws(() => checkCandidate(root), /Mandatory regression test was removed/);
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify(baseline(files.slice(1))));
    assert.throws(() => checkCandidate(root), /lacks a mandatory regression test/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
