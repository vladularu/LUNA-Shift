import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PICOMATCH_ADVISORY_URL = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const manifestSha256 = "58b5f148a77ddb1c1a30f6a574c6826423de9b229fbdb2f13fc664b42f3b739e";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofs = new WeakMap();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (items) => [...items].sort((a, b) => a.path.localeCompare(b.path));
const dependencyRange = (pkg) =>
  ({ ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.dependencies }).picomatch;

function manifest() {
  const bytes = readFileSync(new URL("./picomatch-hardening.patch.json", import.meta.url));
  if (hash(bytes) !== manifestSha256) throw new Error("PICOMATCH_MANIFEST_HASH");
  return JSON.parse(bytes);
}

function contained(root, path) {
  const actual = realpathSync(join(root, path));
  if (relative(realpathSync(root), actual).replaceAll("\\", "/") !== path)
    throw new Error("PICOMATCH_TARGET_OUTSIDE_CHECKOUT");
  return actual;
}

function installedTargets(root) {
  const data = manifest();
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const packages = Object.entries(lock.packages ?? {});
  const copies = packages
    .filter(([path]) => path.endsWith("/picomatch"))
    .map(([path, pkg]) => ({
      path,
      version: pkg.version,
      resolved: pkg.resolved,
      integrity: pkg.integrity,
      dev: pkg.dev === true,
    }));
  if (!equal(sorted(copies), sorted(data.installs))) throw new Error("PICOMATCH_LOCK_IDENTITY");
  const consumers = packages
    .filter(([, pkg]) => dependencyRange(pkg))
    .map(([path, pkg]) => ({ path, range: dependencyRange(pkg) }));
  if (!equal(sorted(consumers), sorted(data.consumers.map(({ path, range }) => ({ path, range })))))
    throw new Error("PICOMATCH_CONSUMER_IDENTITY");

  const targets = data.installs.flatMap((copy) => {
    const metadata = JSON.parse(readFileSync(contained(root, copy.path + "/package.json"), "utf8"));
    if (metadata.name !== "picomatch" || metadata.version !== copy.version)
      throw new Error("PICOMATCH_INSTALLED_VERSION");
    const walk = (path) =>
      readdirSync(contained(root, path), { withFileTypes: true }).flatMap((entry) => {
        const child = path + "/" + entry.name;
        if (entry.isSymbolicLink()) throw new Error("PICOMATCH_TARGET_SYMLINK");
        return entry.isDirectory() ? walk(child) : [child.slice(copy.path.length + 1)];
      });
    const files = walk(copy.path).filter(
      (path) => /\.[cm]?js$/.test(path) || path === "package.json",
    );
    const expected = data.versions[copy.version].files;
    if (!equal(files.sort(), expected.map((entry) => entry.path).sort()))
      throw new Error("PICOMATCH_FILE_INVENTORY");
    return expected.map((entry) => ({
      ...entry,
      file: contained(root, copy.path + "/" + entry.path),
    }));
  });
  for (const consumer of data.consumers) {
    const path = consumer.path ? consumer.path + "/package.json" : "package.json";
    const require = createRequire(contained(root, path));
    if (
      realpathSync(require.resolve("picomatch")) !== contained(root, consumer.target + "/index.js")
    )
      throw new Error("PICOMATCH_PARENT_RESOLUTION");
  }
  return { data, targets };
}

function verifySources(root) {
  const { data, targets } = installedTargets(root);
  if (targets.some((entry) => hash(readFileSync(entry.file)) !== entry.patchedSha256))
    throw new Error("PICOMATCH_HARDENING_MISSING");
  return data;
}

/** Apply only exact locked originals; validate every postimage before the first write. */
export function applyPicomatchHardening(root = repoRoot) {
  const { data, targets } = installedTargets(root);
  const states = targets.map((entry) => ({ ...entry, bytes: readFileSync(entry.file) }));
  if (states.every((entry) => hash(entry.bytes) === entry.patchedSha256))
    return verifyPicomatchHardening(root);
  if (!states.every((entry) => hash(entry.bytes) === entry.originalSha256))
    throw new Error("PICOMATCH_UNEXPECTED_SOURCE");
  const writes = states.flatMap((entry) => {
    if (entry.originalSha256 === entry.patchedSha256) return [];
    let source = entry.bytes.toString("utf8");
    for (const { before, after } of data.edits) {
      if (source.split(before).length !== 2) throw new Error("PICOMATCH_PATCH_ANCHOR");
      source = source.replace(before, after);
    }
    if (hash(source) !== entry.patchedSha256) throw new Error("PICOMATCH_PATCH_POSTIMAGE");
    return [{ file: entry.file, source }];
  });
  for (const entry of writes) writeFileSync(entry.file, entry.source, "utf8");
  return verifyPicomatchHardening(root);
}

/** Opaque evidence tied to this checkout; JSON, environment flags and copied objects cannot mint it. */
export function verifyPicomatchHardening(root = repoRoot) {
  const data = verifySources(root);
  const proof = Object.freeze({ nodes: Object.freeze(data.installs.map((entry) => entry.path)) });
  proofs.set(proof, realpathSync(root));
  return proof;
}

export function isVerifiedPicomatchHardening(proof) {
  if (typeof proof !== "object" || proof === null || proofs.get(proof) !== realpathSync(repoRoot))
    return false;
  try {
    verifySources(repoRoot);
    return true;
  } catch {
    return false;
  }
}

export function isMitigatedPicomatchFinding(finding, vulnerability, proof) {
  if (
    finding.name !== "picomatch" ||
    finding.dependency !== "picomatch" ||
    finding.source !== 1247710 ||
    finding.severity !== "high" ||
    finding.url !== PICOMATCH_ADVISORY_URL ||
    finding.range !== "<=4.0.7" ||
    finding.title !== "picomatch vulnerable to ReDoS through single-branch repeated extglobs" ||
    !isVerifiedPicomatchHardening(proof)
  )
    return false;
  const nodes = vulnerability?.nodes;
  if (!Array.isArray(nodes) || nodes.some((node) => typeof node !== "string")) return false;
  const data = manifest();
  return [data.installs, data.installs.filter((entry) => !entry.dev)].some((scope) =>
    equal([...nodes].sort(), scope.map((entry) => entry.path).sort()),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv[2] === "apply") applyPicomatchHardening();
    else if (process.argv[2] === "verify") verifyPicomatchHardening();
    else throw new Error("PICOMATCH_COMMAND");
    console.log("Picomatch: verified local repeated-extglob hardening in all six locked copies.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
