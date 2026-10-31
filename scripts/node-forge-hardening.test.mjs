import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, privateEncrypt, constants, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import forge from "node-forge";
import { spawnSync } from "node:child_process";
import {
  applyNodeForgeHardening,
  verifyNodeForgeHardening,
  isVerifiedNodeForgeHardening,
  NODE_FORGE_SOURCE_SHA256,
  NODE_FORGE_PATCHED_SHA256,
} from "./node-forge-hardening.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamFiles = Object.fromEntries(
  Object.keys(NODE_FORGE_SOURCE_SHA256).map((name) => [
    name,
    readFileSync(join(root, "node_modules/node-forge/lib", name)),
  ]),
);
const patchedBytes = upstreamFiles["rsa.js"];
const lockEntry = JSON.parse(readFileSync(join(root, "package-lock.json"))).packages[
  "node_modules/node-forge"
];
function fixture({ source = patchedBytes, version = "1.4.2", entry = lockEntry, extra = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "luna-forge-test-"));
  mkdirSync(join(directory, "node_modules/node-forge/lib"), { recursive: true });
  writeFileSync(
    join(directory, "package-lock.json"),
    JSON.stringify({ packages: { "node_modules/node-forge": entry, ...extra } }),
  );
  writeFileSync(
    join(directory, "node_modules/node-forge/package.json"),
    JSON.stringify({ name: "node-forge", version }),
  );
  for (const [name, bytes] of Object.entries(upstreamFiles))
    writeFileSync(
      join(directory, "node_modules/node-forge/lib", name),
      name === "rsa.js" ? source : bytes,
    );
  return directory;
}

test("verifies the installed hash and creates only opaque registered proofs", () => {
  assert.equal(createHash("sha256").update(patchedBytes).digest("hex"), NODE_FORGE_PATCHED_SHA256);
  const proof = verifyNodeForgeHardening();
  assert.ok(isVerifiedNodeForgeHardening(proof));
  assert.ok(Object.isFrozen(proof));
  assert.ok(Object.isFrozen(proof.nodes));
  for (const fake of [null, true, { nodes: proof.nodes }, JSON.parse(JSON.stringify(proof))])
    assert.equal(isVerifiedNodeForgeHardening(fake), false);
});

test("verifies the exact upstream files idempotently without rewriting them", () => {
  const directory = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(isVerifiedNodeForgeHardening(applyNodeForgeHardening(directory)));
    for (const [name, bytes] of Object.entries(upstreamFiles))
      assert.deepEqual(readFileSync(join(directory, "node_modules/node-forge/lib", name)), bytes);
  }
});

test("rejects tampering in each verified upstream security module", () => {
  for (const name of Object.keys(upstreamFiles)) {
    const directory = fixture();
    writeFileSync(
      join(directory, "node_modules/node-forge/lib", name),
      Buffer.concat([upstreamFiles[name], Buffer.from("\n// altered\n")]),
    );
    assert.throws(() => applyNodeForgeHardening(directory), /NODE_FORGE_HARDENING_MISSING/);
  }
});

test("fails closed for version, archive identity, extra copies and altered source", () => {
  assert.throws(
    () => applyNodeForgeHardening(fixture({ version: "1.4.0" })),
    /NODE_FORGE_INSTALLED_VERSION/,
  );
  assert.throws(
    () => applyNodeForgeHardening(fixture({ entry: { ...lockEntry, integrity: "unknown" } })),
    /NODE_FORGE_LOCK_IDENTITY/,
  );
  assert.throws(
    () =>
      applyNodeForgeHardening(
        fixture({ extra: { "node_modules/parent/node_modules/node-forge": lockEntry } }),
      ),
    /NODE_FORGE_LOCK_IDENTITY/,
  );
  const altered = fixture({ source: Buffer.concat([patchedBytes, Buffer.from("\n// changed\n")]) });
  assert.throws(() => applyNodeForgeHardening(altered), /NODE_FORGE_HARDENING_MISSING/);
  assert.throws(() => verifyNodeForgeHardening(altered), /NODE_FORGE_HARDENING_MISSING/);
});

test("fails closed when a locked parent does not resolve the verified installed copy", () => {
  const extra = { "node_modules/test-parent": { dependencies: { "node-forge": "^1.3.3" } } };
  const directory = fixture({ extra });
  assert.throws(() => verifyNodeForgeHardening(directory), /NODE_FORGE_PARENT_MISSING/);
  mkdirSync(join(directory, "node_modules/test-parent/node_modules/node-forge/lib"), {
    recursive: true,
  });
  writeFileSync(join(directory, "node_modules/test-parent/package.json"), "{}");
  writeFileSync(
    join(directory, "node_modules/test-parent/node_modules/node-forge/lib/rsa.js"),
    patchedBytes,
  );
  assert.throws(() => verifyNodeForgeHardening(directory), /NODE_FORGE_PARENT_RESOLUTION/);
});

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = forge.pki.publicKeyFromPem(
  keys.publicKey.export({ type: "spki", format: "pem" }),
);
const message = Buffer.from("luna-node-forge-controlled-regression");
const digest = createHash("sha256").update(message).digest("latin1");
const asn1 = forge.asn1;
const element = (type, constructed, value) =>
  asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
function digestInfoSignature({ withNull = true, extra = null } = {}) {
  const algorithm = [
    element(asn1.Type.OID, false, asn1.oidToDer(forge.pki.oids.sha256).getBytes()),
  ];
  if (withNull) algorithm.push(element(asn1.Type.NULL, false, ""));
  if (extra) algorithm.push(extra);
  const info = element(asn1.Type.SEQUENCE, true, [
    element(asn1.Type.SEQUENCE, true, algorithm),
    element(asn1.Type.OCTETSTRING, false, digest),
  ]);
  return privateEncrypt(
    { key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(asn1.toDer(info).getBytes(), "latin1"),
  );
}

test("accepts standard Node signatures and rejects a changed digest", () => {
  const signature = sign("sha256", message, keys.privateKey).toString("latin1");
  assert.equal(publicKey.verify(digest, signature), true);
  assert.equal(
    publicKey.verify(createHash("sha256").update("different message").digest("latin1"), signature),
    false,
  );
});

test("accepts valid DigestAlgorithm structures with optional NULL", () => {
  for (const withNull of [true, false])
    assert.equal(
      publicKey.verify(digest, digestInfoSignature({ withNull }).toString("latin1")),
      true,
    );
});

test("rejects extra nested DigestAlgorithm children with and without NULL", () => {
  for (const withNull of [true, false]) {
    for (const extra of [
      element(asn1.Type.OCTETSTRING, false, "EXTRA"),
      element(asn1.Type.NULL, false, ""),
      element(asn1.Type.SEQUENCE, true, []),
    ]) {
      // A single optional NULL after the OID is valid, so use a third child for this case.
      const signature = digestInfoSignature({
        withNull: !withNull && extra.type === asn1.Type.NULL ? true : withNull,
        extra,
      });
      assert.throws(
        () => publicKey.verify(digest, signature.toString("latin1")),
        /valid RSASSA-PKCS1-v1_5 DigestInfo/,
      );
    }
  }
});

test("rejects a dependency junction outside the checkout before writing", () => {
  const outside = fixture();
  const directory = mkdtempSync(join(tmpdir(), "luna-forge-junction-test-"));
  mkdirSync(join(directory, "node_modules"));
  writeFileSync(
    join(directory, "package-lock.json"),
    JSON.stringify({ packages: { "node_modules/node-forge": lockEntry } }),
  );
  symlinkSync(
    join(outside, "node_modules/node-forge"),
    join(directory, "node_modules/node-forge"),
    "junction",
  );
  assert.throws(() => applyNodeForgeHardening(directory), /NODE_FORGE_TARGET_OUTSIDE_CHECKOUT/);
  assert.deepEqual(readFileSync(join(outside, "node_modules/node-forge/lib/rsa.js")), patchedBytes);
});

test("rejects adversarial PEM text within a bounded child process", () => {
  const program = `const forge = require("node-forge"); const pem = " -----BEGIN I-----G-----END B".repeat(1000) + "\\x00"; try { forge.pki.certificateFromPem(pem); process.exit(2); } catch {} `;
  const result = spawnSync(process.execPath, ["-e", program], {
    cwd: root,
    timeout: 3000,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects nonpositive PKCS12 iteration counts while retaining valid derivation", () => {
  for (const count of [-1, 0])
    assert.throws(
      () => forge.pkcs12.generateKey("password", new forge.util.ByteBuffer("salt"), 3, count, 20),
      /iteration count must be >= 1/,
    );
  const valid = forge.pkcs12.generateKey("password", new forge.util.ByteBuffer("salt"), 3, 1, 20);
  assert.equal(valid.length(), 20);
  assert.notEqual(valid.toHex(), "03".repeat(20));
});
