import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const dialects = [];
for (const [name, specifier, major, mini] of [
  ["root", "zod", 3, false],
  ["v3", "zod/v3", 3, false],
  ["v4", "zod/v4", 4, false],
  ["mini", "zod/v4-mini", 4, true],
]) {
  dialects.push({ name: `${name}-cjs`, z: require(specifier), major, mini });
  dialects.push({ name: `${name}-esm`, z: await import(specifier), major, mini });
}

function collection(dialect, kind, visit, maximum = 1, error) {
  const { z, mini, major } = dialect;
  const element = mini ? z.pipe(z.transform(visit), z.string()) : z.preprocess(visit, z.string());
  if (kind === "array") {
    const schema = z.array(element);
    return mini ? schema.check(z.maxLength(maximum, error)) : schema.max(maximum, error);
  }
  if (kind === "set") {
    const schema = z.set(element);
    return mini ? schema.check(z.maxSize(maximum, error)) : schema.max(maximum, error);
  }
  assert.equal(major, 4);
  return z.map(element, element).check(z.maxSize(maximum, error));
}

for (const dialect of dialects) {
  for (const kind of dialect.major === 3 ? ["array", "set"] : ["array", "set", "map"]) {
    for (const mode of ["sync", "async"]) {
      test(`${dialect.name} ${kind} ${mode}: rejects oversized collections before parsing elements`, async () => {
        let visits = 0;
        const schema = collection(dialect, kind, (value) => {
          visits++;
          return value;
        });
        const value =
          kind === "array"
            ? [1, 2, 3]
            : kind === "set"
              ? new Set([1, 2, 3])
              : new Map([
                  [1, 1],
                  [2, 2],
                  [3, 3],
                ]);
        const result =
          mode === "async" ? await schema.safeParseAsync(value) : schema.safeParse(value);
        assert.equal(result.success, false);
        assert.equal(visits, 0, "oversized input must not invoke element validators");
        assert.equal(result.error.issues.length, 1);
        assert.equal(result.error.issues[0].code, "too_big");
      });
    }
  }
}

for (const dialect of dialects) {
  test(`${dialect.name}: preserves values, transforms, boundary sizes and invalid types`, () => {
    for (const kind of dialect.major === 3 ? ["array", "set"] : ["array", "set", "map"]) {
      let visits = 0;
      const schema = collection(dialect, kind, (value) => {
        visits++;
        return typeof value === "string" ? value.trim() : value;
      });
      const valid =
        kind === "array" ? [" a "] : kind === "set" ? new Set([" a "]) : new Map([[" k ", " v "]]);
      const expected =
        kind === "array" ? ["a"] : kind === "set" ? new Set(["a"]) : new Map([["k", "v"]]);
      assert.deepEqual(schema.parse(valid), expected);
      assert.equal(visits, kind === "map" ? 2 : 1);
      visits = 0;
      assert.equal(schema.safeParse({}).error.issues[0].code, "invalid_type");
      assert.equal(visits, 0);
      const bad = kind === "array" ? [1] : kind === "set" ? new Set([1]) : new Map([[1, 1]]);
      assert.equal(schema.safeParse(bad).error.issues[0].code, "invalid_type");
      assert.ok(visits > 0, "in-range elements are still validated");
      let forbidden = 0;
      const empty = collection(
        dialect,
        kind,
        (value) => {
          forbidden++;
          return value;
        },
        0,
        "too many",
      );
      const emptyValue = kind === "array" ? [] : kind === "set" ? new Set() : new Map();
      assert.equal(empty.safeParse(emptyValue).success, true);
      const rejected = empty.safeParse(bad);
      assert.equal(rejected.success, false);
      assert.equal(rejected.error.issues[0].message, "too many");
      assert.equal(forbidden, 0);
    }
  });

  test(`${dialect.name}: keeps nested error paths and skips asynchronous validators when oversized`, async () => {
    for (const jitless of dialect.major === 4 ? [true, false] : [undefined]) {
      let visits = 0;
      const schema = dialect.z.object({
        rows: collection(dialect, "array", async (value) => {
          visits++;
          return value;
        }),
      });
      const result = await schema.safeParseAsync({ rows: [1, 2, 3] }, { jitless });
      assert.deepEqual(
        result.error.issues.map((issue) => issue.path),
        [["rows"]],
      );
      assert.equal(visits, 0);
    }
  });

  test(`${dialect.name}: rejects oversized exact-size constraints before callbacks`, () => {
    const { z, mini, major } = dialect;
    let visits = 0;
    const visit = (value) => {
      visits++;
      return value;
    };
    const el = mini ? z.pipe(z.transform(visit), z.string()) : z.preprocess(visit, z.string());
    const array = mini ? z.array(el).check(z.length(1)) : z.array(el).length(1);
    const set = mini ? z.set(el).check(z.size(1)) : z.set(el).size(1);
    for (const [schema, value] of [
      [array, [1, 2]],
      [set, new Set([1, 2])],
    ]) {
      const result = schema.safeParse(value);
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
    }
    if (major === 4)
      assert.equal(
        z
          .map(el, el)
          .check(z.size(1))
          .safeParse(
            new Map([
              [1, 1],
              [2, 2],
            ]),
          ).error.issues.length,
        1,
      );
    assert.equal(visits, 0);
  });

  test(`${dialect.name}: retains unconstrained parsing and explicit preprocessing`, () => {
    const { z, mini, major } = dialect;
    const unbounded = z.array(z.string());
    assert.deepEqual(unbounded.parse(["a", "b", "c"]), ["a", "b", "c"]);
    const shrink = (items) => items.slice(0, 1);
    const bounded = collection(dialect, "array", (value) => value);
    const preprocessed = mini
      ? z.pipe(z.transform(shrink), bounded)
      : z.preprocess(shrink, bounded);
    assert.deepEqual(preprocessed.parse(["a", "b", "c"]), ["a"]);
    if (major === 4) {
      const rewritten = mini
        ? unbounded.check(z.overwrite(shrink), z.maxLength(1))
        : unbounded.overwrite(shrink).max(1);
      assert.deepEqual(rewritten.parse(["a", "b", "c"]), ["a"]);
    }
  });
}

import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyZodHardening, isVerifiedZodHardening, verifyZodHardening } from "./zod-hardening.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patch = JSON.parse(
  readFileSync(new URL("./zod-hardening.patch.json", import.meta.url), "utf8"),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const created = new Set();
const scratchParent = resolve(tmpdir());
function clean(root) {
  assert.ok(created.has(root));
  assert.equal(dirname(resolve(root)), scratchParent);
  assert.ok(root.startsWith(join(scratchParent, "luna-zod-test-")));
  rmSync(root, { recursive: true, force: true });
  created.delete(root);
}
function fixture(t) {
  const root = mkdtempSync(join(scratchParent, "luna-zod-test-"));
  created.add(root);
  t.after(() => clean(root));
  mkdirSync(join(root, "node_modules"));
  cpSync(join(repo, "node_modules/zod"), join(root, "node_modules/zod"), { recursive: true });
  for (const file of patch.files) {
    const target = join(root, "node_modules/zod", file.path);
    let source = readFileSync(target, "utf8");
    if (digest(source) !== file.originalSha256) {
      assert.equal(digest(source), file.patchedSha256);
      for (const change of [...file.replacements].reverse()) {
        assert.equal(source.split(change.after).length, 2);
        source = source.replace(change.after, change.before);
      }
    }
    assert.equal(digest(source), file.originalSha256);
    writeFileSync(target, source);
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      dependencies: { zod: patch.version },
      overrides: { zod: patch.version },
    }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { zod: patch.version } },
        "node_modules/zod": {
          version: patch.version,
          integrity: patch.archiveIntegrity,
          resolved: patch.archiveUrl,
        },
      },
    }),
  );
  return root;
}
const patchHashes = (root) =>
  patch.files.map((file) => digest(readFileSync(join(root, "node_modules/zod", file.path))));
function originalAndHardenedBehavior(root) {
  const code = `const req = require('node:module').createRequire(process.argv[1]+'/package.json');const rows=[];for(const spec of ['zod','zod/v4','zod/v4-mini']){const z=req(spec);let visits=0;const visit=v=>{visits++;return v};const child=z.preprocess?z.preprocess(visit,z.string()):z.pipe(z.transform(visit),z.string());const array=z.array(child);const schema=array.max?array.max(1):array.check(z.maxLength(1));const r=schema.safeParse([1,2,3]);rows.push({visits,issues:r.error.issues.length});}console.log(JSON.stringify(rows));`;
  const result = spawnSync(process.execPath, ["-e", code, root], {
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("reproduces the original flaw in exact original-byte fixtures and fixes it by applying the backport", (t) => {
  const root = fixture(t);
  assert.deepEqual(originalAndHardenedBehavior(root), Array(3).fill({ visits: 3, issues: 4 }));
  assert.throws(() => verifyZodHardening(root), /ZOD_HARDENING_MISSING/);
  applyZodHardening(root);
  assert.deepEqual(originalAndHardenedBehavior(root), Array(3).fill({ visits: 0, issues: 1 }));
  const first = patchHashes(root);
  const proof = applyZodHardening(root);
  assert.deepEqual(patchHashes(root), first);
  assert.equal(isVerifiedZodHardening(proof, root), true);
  assert.equal(
    isVerifiedZodHardening(proof),
    false,
    "foreign fixture proof cannot authorize the real checkout",
  );
  assert.equal(isVerifiedZodHardening(JSON.parse(JSON.stringify(proof)), root), false);
});

test("rejects unknown versions, archive identities, overrides and duplicate locked copies before writes", (t) => {
  const root = fixture(t);
  const pkgPath = join(root, "package.json"),
    lockPath = join(root, "package-lock.json");
  const pkg = readFileSync(pkgPath, "utf8"),
    lock = readFileSync(lockPath, "utf8");
  const originals = patchHashes(root);
  for (const variant of [
    "override",
    "version",
    "integrity",
    "resolved",
    "duplicate",
    "missing-parent",
  ]) {
    const p = JSON.parse(pkg),
      l = JSON.parse(lock);
    if (variant === "override") p.overrides.zod = "4.6.6";
    if (variant === "version") l.packages["node_modules/zod"].version = "3.25.75";
    if (variant === "integrity") l.packages["node_modules/zod"].integrity = "sha512-forged";
    if (variant === "resolved")
      l.packages["node_modules/zod"].resolved = "https://example.invalid/zod.tgz";
    if (variant === "duplicate")
      l.packages["node_modules/other/node_modules/zod"] = l.packages["node_modules/zod"];
    if (variant === "missing-parent")
      l.packages["node_modules/absent"] = { dependencies: { zod: "^3" } };
    writeFileSync(pkgPath, JSON.stringify(p));
    writeFileSync(lockPath, JSON.stringify(l));
    assert.throws(() => applyZodHardening(root), /ZOD_LOCK_IDENTITY|ZOD_PARENT_MISSING/);
    assert.deepEqual(patchHashes(root), originals);
  }
});

test("rejects a shadowed unlocked dependency copy resolved by an actual consumer", (t) => {
  const root = fixture(t),
    parent = join(root, "node_modules/consumer");
  mkdirSync(join(parent, "node_modules"), { recursive: true });
  cpSync(join(root, "node_modules/zod"), join(parent, "node_modules/zod"), { recursive: true });
  writeFileSync(
    join(parent, "package.json"),
    JSON.stringify({ name: "consumer", dependencies: { zod: "^3" } }),
  );
  const lockPath = join(root, "package-lock.json"),
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages["node_modules/consumer"] = { dependencies: { zod: "^3" } };
  writeFileSync(lockPath, JSON.stringify(lock));
  const before = patchHashes(root);
  assert.throws(() => applyZodHardening(root), /ZOD_PARENT_RESOLUTION/);
  assert.deepEqual(patchHashes(root), before);
});

test("rejects dependency paths escaping the checkout", (t) => {
  const root = fixture(t),
    other = fixture(t),
    packagePath = join(root, "node_modules/zod");
  renameSync(packagePath, join(root, "node_modules/zod-original"));
  symlinkSync(
    join(other, "node_modules/zod"),
    packagePath,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => applyZodHardening(root), /ZOD_TARGET_OUTSIDE_CHECKOUT/);
});

test("invalidates stale proof when patched code is changed and refuses unknown or mixed sources", (t) => {
  const root = fixture(t);
  applyZodHardening(root);
  const proof = verifyZodHardening(root),
    target = join(root, "node_modules/zod", patch.files[0].path);
  writeFileSync(target, readFileSync(target, "utf8") + "\n// tampered\n");
  assert.equal(isVerifiedZodHardening(proof, root), false);
  assert.throws(() => verifyZodHardening(root), /ZOD_HARDENING_MISSING/);
  assert.throws(() => applyZodHardening(root), /ZOD_UNEXPECTED_SOURCE/);
  const mixed = fixture(t),
    file = patch.files[0],
    mixedTarget = join(mixed, "node_modules/zod", file.path);
  let source = readFileSync(mixedTarget, "utf8");
  for (const change of file.replacements) source = source.replace(change.before, change.after);
  writeFileSync(mixedTarget, source);
  const before = patchHashes(mixed);
  assert.throws(() => applyZodHardening(mixed), /ZOD_UNEXPECTED_SOURCE/);
  assert.deepEqual(patchHashes(mixed), before);
});

test("rejects altered entrypoints and additional executable sources before patching", (t) => {
  const root = fixture(t),
    entrypoint = join(root, "node_modules/zod/index.cjs");
  const before = patchHashes(root);
  writeFileSync(entrypoint, readFileSync(entrypoint, "utf8") + "\n// changed\n");
  assert.throws(() => applyZodHardening(root), /ZOD_GUARD_HASH/);
  assert.deepEqual(patchHashes(root), before);
  const extra = fixture(t);
  writeFileSync(join(extra, "node_modules/zod/unexpected.cjs"), "module.exports = {};\n");
  assert.throws(() => applyZodHardening(extra), /ZOD_SOURCE_SET/);
});

test("rejects a tampered patch manifest without modifying installed targets", (t) => {
  const root = fixture(t),
    scripts = join(root, "scripts");
  mkdirSync(scripts);
  cpSync(join(repo, "scripts/zod-hardening.mjs"), join(scripts, "zod-hardening.mjs"));
  writeFileSync(
    join(scripts, "zod-hardening.patch.json"),
    JSON.stringify({ ...patch, upstreamCommit: "forged" }),
  );
  const before = patchHashes(root);
  const result = spawnSync(process.execPath, [join(scripts, "zod-hardening.mjs"), "apply"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ZOD_MANIFEST_HASH/);
  assert.deepEqual(patchHashes(root), before);
});

test("the published TypeScript source conditions use the hardened implementations too", () => {
  const code = `for(const spec of ['zod','zod/v3','zod/v4','zod/v4-mini']){const z=await import(spec);let visits=0;const visit=v=>{visits++;return v};const child=z.preprocess?z.preprocess(visit,z.string()):z.pipe(z.transform(visit),z.string());const array=z.array(child);const schema=array.max?array.max(1):array.check(z.maxLength(1));const r=await schema.safeParseAsync([1,2,3]);if(r.success||visits!==0||r.error.issues.length!==1)throw Error(spec+' source bypass');}console.log('source-entrypoints-hardened');`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=@zod/source", "--input-type=module", "-e", code],
    { cwd: repo, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source-entrypoints-hardened/);
});

test("the established install/verify CLI fails without Zod hardening and applies both fixes", (t) => {
  const root = fixture(t),
    scripts = join(root, "scripts");
  mkdirSync(scripts);
  for (const name of [
    "decode-uri-component-hardening.cjs",
    "decode-uri-component-hardening.patch.json",
    "zod-hardening.mjs",
    "zod-hardening.patch.json",
  ])
    cpSync(join(repo, "scripts", name), join(scripts, name));
  cpSync(
    join(repo, "node_modules/decode-uri-component"),
    join(root, "node_modules/decode-uri-component"),
    { recursive: true },
  );
  const realLock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8"));
  const file = join(root, "package-lock.json"),
    lock = JSON.parse(readFileSync(file, "utf8"));
  lock.packages["node_modules/decode-uri-component"] =
    realLock.packages["node_modules/decode-uri-component"];
  lock.packages[""].dependencies["decode-uri-component"] = "0.2.2";
  writeFileSync(file, JSON.stringify(lock));
  const cli = join(scripts, "decode-uri-component-hardening.cjs");
  const failed = spawnSync(process.execPath, [cli, "verify"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /ZOD_HARDENING_MISSING/);
  const applied = spawnSync(process.execPath, [cli, "apply"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /zod 3\.25\.76: verified/);
  const checked = spawnSync(process.execPath, [cli, "verify"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.deepEqual(originalAndHardenedBehavior(root), Array(3).fill({ visits: 0, issues: 1 }));
});
