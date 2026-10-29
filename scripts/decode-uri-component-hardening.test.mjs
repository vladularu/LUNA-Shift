import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import hardening from "./decode-uri-component-hardening.cjs";

const { applyDecodeUriComponentHardening, verifyDecodeUriComponentHardening } = hardening;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patch = JSON.parse(
  readFileSync(new URL("./decode-uri-component-hardening.patch.json", import.meta.url), "utf8"),
);
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const directories = [];
after(() => directories.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "luna-decoder-"));
  directories.push(dir);
  const decoderPath = "node_modules/decode-uri-component";
  mkdirSync(join(dir, decoderPath), { recursive: true });
  mkdirSync(join(dir, "node_modules/query-string"), { recursive: true });
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({
      packages: {
        [decoderPath]: lock.packages[decoderPath],
        "node_modules/query-string": { dependencies: { "decode-uri-component": "^0.2.2" } },
      },
    }),
  );
  writeFileSync(
    join(dir, decoderPath, "package.json"),
    JSON.stringify({ name: "decode-uri-component", version: "0.2.2", main: "index.js" }),
  );
  writeFileSync(join(dir, "node_modules/query-string/package.json"), "{}");
  writeFileSync(join(dir, decoderPath, "index.js"), patch.originalSource);
  return dir;
}

test("requires the reviewed decoder, rejects tampering, and applies idempotently", () => {
  const dir = fixture();
  assert.throws(() => verifyDecodeUriComponentHardening(dir), /DECODER_HARDENING_MISSING/);
  applyDecodeUriComponentHardening(dir);
  applyDecodeUriComponentHardening(dir);
  verifyDecodeUriComponentHardening(dir);
  writeFileSync(
    join(dir, "node_modules/decode-uri-component/index.js"),
    "module.exports = () => 0;",
  );
  assert.throws(() => verifyDecodeUriComponentHardening(dir), /DECODER_HARDENING_MISSING/);
  assert.throws(() => applyDecodeUriComponentHardening(dir), /DECODER_UNEXPECTED_SOURCE/);
});

test("rejects unreviewed versions and duplicate decoder copies", () => {
  for (const duplicate of [false, true]) {
    const dir = fixture();
    const file = join(dir, "package-lock.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (duplicate)
      data.packages["node_modules/query-string/node_modules/decode-uri-component"] =
        data.packages["node_modules/decode-uri-component"];
    else data.packages["node_modules/decode-uri-component"].version = "0.5.0";
    writeFileSync(file, JSON.stringify(data));
    assert.throws(() => applyDecodeUriComponentHardening(dir), /DECODER_LOCK_IDENTITY/);
  }
});

test("upgrades the exact earlier backport and invalidates stale evidence after tampering", () => {
  const dir = fixture();
  const target = join(dir, "node_modules/decode-uri-component/index.js");
  writeFileSync(target, patch.previousPatchedSource);
  assert.throws(() => verifyDecodeUriComponentHardening(dir), /DECODER_HARDENING_MISSING/);
  applyDecodeUriComponentHardening(dir);
  const proof = verifyDecodeUriComponentHardening(dir);
  assert.equal(hardening.isVerifiedDecodeUriComponentHardening(proof, dir), true);
  assert.equal(hardening.isVerifiedDecodeUriComponentHardening(proof), false);
  assert.equal(hardening.isVerifiedDecodeUriComponentHardening({ ...proof }, dir), false);
  writeFileSync(target, patch.previousPatchedSource);
  assert.equal(hardening.isVerifiedDecodeUriComponentHardening(proof, dir), false);
});

test("preserves valid Unicode, malformed-byte fallback, plus handling and the CJS API", () => {
  const dir = fixture();
  applyDecodeUriComponentHardening(dir);
  const decode = createRequire(import.meta.url)(join(dir, "node_modules/decode-uri-component"));
  for (const [input, expected] of [
    ["Fr%C3%BChdienst", "Frühdienst"],
    ["%F0%9F%8C%99", "🌙"],
    ["a+b%2Bc", "a b+c"],
    ["%ab%41%E2%82%AC%ab", "%abA€%ab"],
    ["%FE%FF", "\uFFFD\uFFFD"],
    ["%C2", "\uFFFD"],
    ["%", "%"],
    ["%2525%zz", "%25%zz"],
    ["%24%26%zz", "$&%zz"],
    ["%FF%FE%C3%A5%C2%ab", "\uFFFD\uFFFDå«"],
  ])
    assert.equal(decode(input), expected);
  assert.throws(() => decode(null), TypeError);
});

test("bounds many distinct encoded runs through the installed Expo query parser", () => {
  verifyDecodeUriComponentHardening();
  const script = `
    const assert = require('node:assert/strict');
    const {createRequire} = require('node:module');
    const fromRouter = createRequire(require.resolve('expo-router/package.json'));
    const query = fromRouter('query-string');
    const fromQuery = createRequire(fromRouter.resolve('query-string/package.json'));
    const decode = fromQuery('decode-uri-component');
    let payload = '';
    for (let i = 0; i < 32000; i++) {
      payload += '%' + Math.floor(i / 256).toString(16).padStart(2, '0')
        + '%' + (i % 256).toString(16).padStart(2, '0') + 'x';
    }
    payload += '%zz';
    const expected = decode(payload);
    assert.ok(expected.endsWith('%zz'));
    assert.equal(query.parse('x=' + payload).x, expected);
    assert.equal(query.parse(payload + '=x')[expected], 'x');
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("the installed SDK 57 query parser bounds hostile deep-link keys and values", () => {
  verifyDecodeUriComponentHardening();
  const script = `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const fromRouter = createRequire(require.resolve('expo-router/package.json'));
    const query = fromRouter('query-string');
    const hostile = '%ab'.repeat(2000);
    assert.equal(query.parse('x=' + hostile).x, hostile);
    assert.equal(query.parse(hostile + '=x')[hostile], 'x');
    const ordinary = query.parse('month=2026-10&name=Fr%C3%BChdienst&tag=a&tag=b');
    assert.equal(ordinary.name, 'Frühdienst');
    assert.deepEqual(ordinary.tag, ['a', 'b']);
  `;
  // The vulnerable parser takes many seconds even for 200 malformed bytes.
  // A child bounds the regression test itself if the protection regresses.
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
