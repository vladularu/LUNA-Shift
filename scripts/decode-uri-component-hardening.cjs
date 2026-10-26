const { createHash } = require("node:crypto");
const { existsSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join, relative, resolve } = require("node:path");

const repoRoot = resolve(__dirname, "..");
const manifestHash = "52561d5e0aaca62693b43b13ba693763f9281e9b2bcbe2bc7abfaf8eb76f6dae";
const archiveIntegrity =
  "sha512-FqUYQ+8o158GyGTrMFJms9qh3CqTKvAqgqsTnkLI8sKu0028orqBhxNMFkFen0zGyg6epACD32pjVk58ngIErQ==";
const upstreamCommit = "a12fabaa28303cc8b5b07e93d128f4fc09fc31e5";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function manifest() {
  const bytes = readFileSync(join(__dirname, "decode-uri-component-hardening.patch.json"));
  if (hash(bytes) !== manifestHash) throw new Error("DECODER_MANIFEST_HASH");
  const data = JSON.parse(bytes);
  if (
    data.commit !== upstreamCommit ||
    hash(data.originalSource) !== data.originalSha256 ||
    hash(data.patchedSource) !== data.patchedSha256
  )
    throw new Error("DECODER_MANIFEST_IDENTITY");
  return data;
}

function contained(root, file, expected) {
  const actual = realpathSync(file);
  if (relative(realpathSync(root), actual).replaceAll("\\", "/") !== expected)
    throw new Error("DECODER_TARGET_OUTSIDE_CHECKOUT");
  return actual;
}

function installedTarget(root) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const copies = Object.entries(lock.packages ?? {}).filter(([name]) =>
    name.endsWith("/decode-uri-component"),
  );
  if (
    copies.length !== 1 ||
    copies[0][0] !== "node_modules/decode-uri-component" ||
    copies[0][1].version !== "0.2.2" ||
    copies[0][1].integrity !== archiveIntegrity ||
    copies[0][1].resolved !==
      "https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.2.2.tgz"
  )
    throw new Error("DECODER_LOCK_IDENTITY");
  const packagePath = join(root, "node_modules/decode-uri-component/package.json");
  contained(root, packagePath, "node_modules/decode-uri-component/package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata.name !== "decode-uri-component" || metadata.version !== "0.2.2")
    throw new Error("DECODER_INSTALLED_VERSION");
  const file = join(root, "node_modules/decode-uri-component/index.js");
  const actual = contained(root, file, "node_modules/decode-uri-component/index.js");
  let parents = 0;
  for (const [parent, entry] of Object.entries(lock.packages)) {
    if (!entry.dependencies?.["decode-uri-component"]) continue;
    parents++;
    const parentLocation = parent ? parent + "/package.json" : "package.json";
    const parentFile = join(root, parentLocation);
    if (!existsSync(parentFile)) throw new Error("DECODER_PARENT_MISSING");
    const verifiedParent = contained(root, parentFile, parentLocation);
    if (realpathSync(createRequire(verifiedParent).resolve("decode-uri-component")) !== actual)
      throw new Error("DECODER_PARENT_RESOLUTION");
  }
  if (!parents) throw new Error("DECODER_PARENT_MISSING");
  return file;
}

// Backport only the upstream bounded UTF-8 decoder. Keep the existing CJS API
// and '+' handling required by the SDK 57 dependency graph.
function verifyDecodeUriComponentHardening(root = repoRoot) {
  const data = manifest();
  const file = installedTarget(root);
  if (hash(readFileSync(file)) !== data.patchedSha256) throw new Error("DECODER_HARDENING_MISSING");
}

function applyDecodeUriComponentHardening(root = repoRoot) {
  const data = manifest();
  const file = installedTarget(root);
  const digest = hash(readFileSync(file));
  if (digest !== data.patchedSha256) {
    if (digest !== data.originalSha256) throw new Error("DECODER_UNEXPECTED_SOURCE");
    writeFileSync(file, data.patchedSource, "utf8");
  }
  verifyDecodeUriComponentHardening(root);
}

module.exports = { applyDecodeUriComponentHardening, verifyDecodeUriComponentHardening };

if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === "apply") applyDecodeUriComponentHardening();
    else if (command === "verify") verifyDecodeUriComponentHardening();
    else throw new Error("DECODER_COMMAND");
    console.log("decode-uri-component: verified CVE-2026-45822 upstream decoder backport.");
    // Keep the established install/verify entrypoint stable for SDK 57 runtimes.
    // Imported decoder helpers stay independent; only this CLI also checks Zod.
    const result = require("node:child_process").spawnSync(
      process.execPath,
      [join(__dirname, "zod-hardening.mjs"), command],
      { cwd: repoRoot, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("ZOD_HARDENING_FAILED");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
