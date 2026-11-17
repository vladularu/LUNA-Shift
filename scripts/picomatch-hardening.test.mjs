import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { evaluateAuditReport } from "./audit-production.mjs";
import { evaluateDependencyAuditReport } from "./audit-all.mjs";
import {
  applyPicomatchHardening,
  isVerifiedPicomatchHardening,
  verifyPicomatchHardening,
} from "./picomatch-hardening.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestBytes = readFileSync(join(root, "scripts/picomatch-hardening.patch.json"));
const manifest = JSON.parse(manifestBytes);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literalRegex = (value) => "^(?:" + escape(value) + ")$";
const nodes = manifest.installs.map((entry) => entry.path);
const productionNodes = manifest.installs.filter((entry) => !entry.dev).map((entry) => entry.path);
const advisory = {
  name: "picomatch",
  dependency: "picomatch",
  source: 1247710,
  severity: "high",
  title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  url: manifest.advisory,
  range: "<=4.0.7",
};
function report(cause = advisory, scope = nodes) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      picomatch: { name: "picomatch", severity: cause.severity, via: [cause], nodes: scope },
      expo: { severity: cause.severity, via: ["picomatch"], nodes: ["node_modules/expo"] },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
  };
}
function evaluate(value, proof) {
  return evaluateAuditReport(value, undefined, undefined, undefined, undefined, proof);
}
function fixture(t) {
  const parent = realpathSync(tmpdir());
  const folder = mkdtempSync(join(parent, "luna-picomatch-"));
  t.after(() => {
    assert.equal(dirname(realpathSync(folder)), parent);
    assert.ok(basename(folder).startsWith("luna-picomatch-"));
    rmSync(folder, { recursive: true, force: true });
  });
  const put = (path, value) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), value);
  };
  put("package-lock.json", readFileSync(join(root, "package-lock.json")));
  put("package.json", readFileSync(join(root, "package.json")));
  for (const copy of manifest.installs) {
    for (const file of manifest.versions[copy.version].files) {
      let bytes = readFileSync(join(root, copy.path, file.path));
      if (file.originalSha256 !== file.patchedSha256) {
        let text = bytes.toString("utf8");
        for (const edit of [...manifest.edits].reverse())
          text = text.replace(edit.after, edit.before);
        bytes = Buffer.from(text);
      }
      assert.equal(hash(bytes), file.originalSha256);
      put(copy.path + "/" + file.path, bytes);
    }
  }
  for (const consumer of manifest.consumers)
    put(consumer.path + "/package.json", readFileSync(join(root, consumer.path, "package.json")));
  put(
    "scripts/picomatch-hardening.mjs",
    readFileSync(join(root, "scripts/picomatch-hardening.mjs")),
  );
  put("scripts/picomatch-hardening.patch.json", manifestBytes);
  return { folder, put };
}
async function fixtureModule(folder) {
  return import(pathToFileURL(join(folder, "scripts/picomatch-hardening.mjs")).href);
}

test("installation rejects original sources until all six copies are patched; application is idempotent", (t) => {
  const { folder } = fixture(t);
  assert.throws(() => verifyPicomatchHardening(folder), /PICOMATCH_HARDENING_MISSING/);
  const proof = applyPicomatchHardening(folder);
  assert.deepEqual(proof.nodes, nodes);
  assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.nodes));
  assert.deepEqual(applyPicomatchHardening(folder), proof);
  assert.equal(
    isVerifiedPicomatchHardening(proof),
    false,
    "another checkout cannot mint this checkout's evidence",
  );
});

for (const copy of manifest.installs) {
  test(`${copy.path}: reviewed regressions and ordinary build patterns`, () => {
    verifyPicomatchHardening();
    const match = createRequire(join(root, copy.path, "package.json"))(join(root, copy.path));
    const risky = [
      "+(*)",
      "+(*a)",
      "+(a*)",
      "+(a*a)",
      "+(*)a",
      "*(*)",
      "*(*a)",
      "*(a*|b)",
      "+(ab|abab)",
      "+(abc|abcabc)",
      "+(aaaa|aaaaaa)",
      "+([a]*)",
      "+([a*)",
      '+(["]*a)',
    ];
    for (const pattern of risky) {
      for (const options of [{}, { capture: true }, { bash: true }]) {
        assert.equal(match.makeRe(pattern, options).source, literalRegex(pattern), pattern);
        assert.equal(match.makeRe(pattern, options).test(pattern), true, pattern);
        assert.equal(match.makeRe(pattern, options).test("a".repeat(128) + "!"), false, pattern);
      }
    }
    assert.equal(match.makeRe("+([a*b])", { nobracket: true }).source, literalRegex("+([a*b])"));
    for (const [input, pattern, options] of [
      ["src/ui/header.component.test.tsx", "**/*.test.{ts,tsx}"],
      ["app/calendar.tsx", "**/*.{js,jsx,ts,tsx}"],
      ["src/index.ts", "**/+(app|src)/**/*.@(js|ts)"],
      ["jsjsx", "+(js|jsx)"],
      ["foofoobar", "+(foo|foobar)"],
      ["foofoo", "+(foo|bar)"],
      ["fffooo", "*(*(f)*(o))"],
      ["aaa", "+(*(a)|*(b))"],
      ["**", String.raw`+(\*)`],
      ["**", '+("*")'],
      ["a*b", "+([a*b])", { literalBrackets: false }],
      ["**", "+([*])"],
      [".expo/config.json", "**/*.json", { dot: true }],
    ])
      assert.equal(match.isMatch(input, pattern, options), true, `${input}: ${pattern}`);
    assert.equal(match.isMatch("src/ui/header.tsx", "**/*.test.{ts,tsx}"), false);
    assert.equal(match.isMatch(".expo/config.json", "**/*.json"), false);
    // Preserve the upstream explicit opt-out API; never execute its unguarded matcher here.
    assert.notEqual(
      match.makeRe("+(*a)", { maxExtglobRecursion: false }).source,
      literalRegex("+(*a)"),
    );
  });
}

test("unknown and mixed sources fail before writing another copy", (t) => {
  const { folder, put } = fixture(t);
  const first = join(folder, nodes[0], "lib/parse.js");
  const original = readFileSync(first);
  put(nodes.at(-1) + "/lib/parse.js", "unknown source");
  assert.throws(() => applyPicomatchHardening(folder), /PICOMATCH_UNEXPECTED_SOURCE/);
  assert.deepEqual(readFileSync(first), original);
  const copy = manifest.installs.at(-1);
  let source = readFileSync(join(root, copy.path, "lib/parse.js"), "utf8");
  put(copy.path + "/lib/parse.js", source);
  assert.throws(() => applyPicomatchHardening(folder), /PICOMATCH_UNEXPECTED_SOURCE/);
  assert.deepEqual(readFileSync(first), original);
});

for (const field of ["version", "resolved", "integrity", "dev"]) {
  test(`lock ${field} drift cannot inherit mitigation`, (t) => {
    const { folder, put } = fixture(t);
    const lock = JSON.parse(readFileSync(join(folder, "package-lock.json")));
    lock.packages[nodes[0]][field] = field === "dev" ? true : "unexpected";
    put("package-lock.json", JSON.stringify(lock));
    assert.throws(() => applyPicomatchHardening(folder), /PICOMATCH_LOCK_IDENTITY/);
  });
}

test("missing/extra lock copies, new consumers and redirected resolutions fail closed", async (t) => {
  for (const mutation of [
    (lock) => delete lock.packages[nodes[0]],
    (lock) => {
      lock.packages["node_modules/new/node_modules/picomatch"] = lock.packages[nodes[0]];
    },
    (lock) => {
      lock.packages["node_modules/new"] = { dependencies: { picomatch: "*" } };
    },
  ]) {
    const { folder, put } = fixture(t);
    const lock = JSON.parse(readFileSync(join(folder, "package-lock.json")));
    mutation(lock);
    put("package-lock.json", JSON.stringify(lock));
    assert.throws(() => applyPicomatchHardening(folder), /PICOMATCH_(LOCK|CONSUMER)_IDENTITY/);
  }
  const { folder, put } = fixture(t);
  const alternate = "node_modules/anymatch/node_modules/picomatch";
  put(alternate + "/package.json", JSON.stringify({ name: "picomatch", main: "index.js" }));
  put(alternate + "/index.js", "module.exports = {};");
  assert.throws(() => applyPicomatchHardening(folder), /PICOMATCH_PARENT_RESOLUTION/);
});

test("entrypoint, extra executable and manifest tampering are rejected", async (t) => {
  const { folder, put } = fixture(t);
  applyPicomatchHardening(folder);
  const api = await fixtureModule(folder);
  const proof = api.verifyPicomatchHardening();
  assert.equal(api.isVerifiedPicomatchHardening(proof), true);
  put(nodes[0] + "/index.js", "module.exports = {};");
  assert.equal(api.isVerifiedPicomatchHardening(proof), false, "stale evidence must be rechecked");
  assert.throws(() => api.verifyPicomatchHardening(), /PICOMATCH_HARDENING_MISSING/);
  put(nodes[0] + "/index.js", readFileSync(join(root, nodes[0], "index.js")));
  put(nodes[0] + "/extra.js", "module.exports = {};");
  assert.throws(() => api.verifyPicomatchHardening(), /PICOMATCH_FILE_INVENTORY/);
  put("scripts/picomatch-hardening.patch.json", "{}");
  assert.throws(() => api.verifyPicomatchHardening(), /PICOMATCH_MANIFEST_HASH/);
});

test("dependency junctions outside the checkout cannot be patched or verified", (t) => {
  const inside = fixture(t);
  const outside = fixture(t);
  const target = join(inside.folder, nodes[0]);
  assert.ok(target.startsWith(inside.folder + "/") || target.startsWith(inside.folder + "\\"));
  rmSync(target, { recursive: true });
  symlinkSync(
    join(outside.folder, nodes[0]),
    target,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => applyPicomatchHardening(inside.folder), /PICOMATCH_TARGET_OUTSIDE_CHECKOUT/);
});

test("both audit scopes accept only the exact finding with current installed evidence", () => {
  const proof = verifyPicomatchHardening();
  for (const scope of [nodes, productionNodes, [...nodes].reverse()]) {
    const value = report(advisory, scope);
    assert.equal(evaluate(value, proof).blocking.length, 0);
    assert.equal(evaluate(value, proof).mitigated.length, 1);
    const all = evaluateDependencyAuditReport(value, [
      undefined,
      undefined,
      undefined,
      undefined,
      proof,
    ]);
    assert.equal(all.blocking.length, 0);
    assert.equal(all.advisories[0].status, "mitigated");
  }
  for (const fake of [undefined, {}, { nodes }, { ...proof }, JSON.parse(JSON.stringify(proof))])
    assert.equal(evaluate(report(), fake).blocking.length, 1);
  for (const scope of [
    [],
    nodes.slice(1),
    [...nodes, nodes[0]],
    [...nodes, "node_modules/unknown"],
  ])
    assert.equal(evaluate(report(advisory, scope), proof).blocking.length, 1);
  for (const field of ["name", "dependency", "source", "severity", "url", "range", "title"]) {
    const cause = {
      ...advisory,
      [field]:
        field === "source" ? advisory.source + 1 : field === "severity" ? "critical" : "changed",
    };
    assert.equal(evaluate(report(cause), proof).blocking.length, 1, field);
  }
  const other = { ...advisory, name: "unrelated", source: 1, url: "https://example.test/advisory" };
  const value = report();
  value.vulnerabilities.picomatch.via.push(other);
  assert.equal(evaluate(value, proof).blocking.length, 1, "new advisories remain blocking");
});
