import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NODE_FORGE_ADVISORY_URL = "https://github.com/advisories/GHSA-86w9-cpqp-85rv";
export const NODE_FORGE_PATCHED_SHA256 =
  "6632e195295ce76f6bb9131ee770dcd6cc1ee4ffac7906302208b00faf95a87f";
export const NODE_FORGE_SOURCE_SHA256 = Object.freeze({
  "rsa.js": "6632e195295ce76f6bb9131ee770dcd6cc1ee4ffac7906302208b00faf95a87f",
  "pem.js": "e8924037685f22dfb10ea9d1b780a7ae4f4eb3e6c601cef4079e7747bb4c8922",
  "pkcs12.js": "4e471bf3e717d940a07b34d5716d988cfa01b143c38c3fc1f8b597cb83d29742",
  "pbe.js": "674750301f7c7d44b7b52c80bde90399aef8ff6021e6d6ccd1553ce3f5768c81",
  "tls.js": "3d7def7a2e1c568de50c18109d7186c0c83d0384c7f9badab4831722b6233cbe",
  "x509.js": "6749ed90069312a63470cc468d434781494fa3c9d3f2cc194efb2099011f9132",
  "oids.js": "13e31fe08ccb431fefe44f9d2285891b846e65b17b24329bf14eed04de584015",
  "asn1.js": "77cc3ca2b4c1009e93cf26594232598f253bd3e046f16eb32386c8bf644857b6",
  "jsbn.js": "f17e767bfef62490e22a66ec2e12444fe53aee15e838fe572b7808e75194b62d",
  "http.js": "257276e15b49964f8e5c4037e1bd6b4368aacdc1de4f6f46a45b67ca72728265",
  "cipherModes.js": "904c168aecdfdf07afce4e38bdc9e0a8f3a799274b8c36d0adae3439a83324a8",
});
const archiveIntegrity =
  "sha512-rRtAR5XLJ8gCKd9du4qrKAsgCG1ObGP4gLeNJMa4vYSeq4bmBMOJk5IHkrviBV0q7uoAJlVd8HEQYQSVUb4FGQ==";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofs = new WeakSet();

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function installedTarget(root) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const copies = Object.entries(lock.packages ?? {}).filter(([name]) =>
    name.endsWith("/node-forge"),
  );
  if (
    copies.length !== 1 ||
    copies[0][0] !== "node_modules/node-forge" ||
    copies[0][1].version !== "1.4.2" ||
    copies[0][1].integrity !== archiveIntegrity
  )
    throw new Error("NODE_FORGE_LOCK_IDENTITY");
  const packagePath = join(root, "node_modules/node-forge/package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata.version !== "1.4.2" || metadata.name !== "node-forge")
    throw new Error("NODE_FORGE_INSTALLED_VERSION");
  const file = join(root, "node_modules/node-forge/lib/rsa.js");
  const actual = realpathSync(file);
  const location = relative(realpathSync(root), actual).replaceAll("\\", "/");
  if (location !== "node_modules/node-forge/lib/rsa.js")
    throw new Error("NODE_FORGE_TARGET_OUTSIDE_CHECKOUT");
  for (const [parent, entry] of Object.entries(lock.packages)) {
    if (!entry.dependencies?.["node-forge"]) continue;
    const parentFile = join(root, parent, "package.json");
    if (!existsSync(parentFile)) throw new Error("NODE_FORGE_PARENT_MISSING");
    const parentRequire = createRequire(parentFile);
    if (realpathSync(parentRequire.resolve("node-forge/lib/rsa.js")) !== actual)
      throw new Error("NODE_FORGE_PARENT_RESOLUTION");
  }
  return file;
}

/** Verify the exact upstream release; never rewrite installed cryptographic code. */
export function applyNodeForgeHardening(root = repoRoot) {
  return verifyNodeForgeHardening(root);
}

/** Proof is opaque and cannot be supplied via environment, JSON or a caller-created object. */
export function verifyNodeForgeHardening(root = repoRoot) {
  const file = installedTarget(root);
  for (const [name, expected] of Object.entries(NODE_FORGE_SOURCE_SHA256)) {
    const source = join(dirname(file), name);
    const location = relative(realpathSync(root), realpathSync(source)).replaceAll("\\", "/");
    if (location !== `node_modules/node-forge/lib/${name}`)
      throw new Error("NODE_FORGE_TARGET_OUTSIDE_CHECKOUT");
    if (hash(readFileSync(source)) !== expected) throw new Error("NODE_FORGE_HARDENING_MISSING");
  }
  const proof = Object.freeze({ nodes: Object.freeze(["node_modules/node-forge"]) });
  proofs.add(proof);
  return proof;
}

export function isVerifiedNodeForgeHardening(proof) {
  return typeof proof === "object" && proof !== null && proofs.has(proof);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const command = process.argv[2];
    if (command === "apply") applyNodeForgeHardening();
    else if (command === "verify") verifyNodeForgeHardening();
    else throw new Error("NODE_FORGE_COMMAND");
    console.log(
      `node-forge 1.4.2: verified upstream security fixes (${NODE_FORGE_PATCHED_SHA256}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
