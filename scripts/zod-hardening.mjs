import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ZOD_ADVISORY_URL = "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5";
export const ZOD_UPSTREAM_COMMIT = "a0ebf970f2d752e5f58527cd2942ff48be4f46bd";
const manifestSha256 = "e339588b0fd1036f3a1765105a57280e56e850d1476d2e032bf5532cdbc06221";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofs = new WeakMap();
const patchedPaths = [
  "v3/types.cjs",
  "v3/types.js",
  "src/v3/types.ts",
  "v4/core/schemas.cjs",
  "v4/core/schemas.js",
  "src/v4/core/schemas.ts",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function manifest() {
  const bytes = readFileSync(new URL("./zod-hardening.patch.json", import.meta.url));
  if (hash(bytes) !== manifestSha256) throw new Error("ZOD_MANIFEST_HASH");
  const data = JSON.parse(bytes);
  if (
    data.name !== "zod" ||
    data.version !== "3.25.76" ||
    data.advisory !== ZOD_ADVISORY_URL ||
    data.upstreamCommit !== ZOD_UPSTREAM_COMMIT ||
    JSON.stringify(data.files.map((f) => f.path)) !== JSON.stringify(patchedPaths)
  )
    throw new Error("ZOD_MANIFEST_IDENTITY");
  return data;
}

function contained(root, file, expected) {
  const actual = realpathSync(file);
  if (relative(realpathSync(root), actual).replaceAll("\\", "/") !== expected)
    throw new Error("ZOD_TARGET_OUTSIDE_CHECKOUT");
  return actual;
}

function sourcePaths(directory, prefix = "") {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("ZOD_SYMLINKED_SOURCE");
    if (["tests", "__tests__", "benchmarks", "__benchmarks__"].includes(entry.name)) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...sourcePaths(join(directory, entry.name), name + "/"));
    else if (
      entry.name === "package.json" ||
      (/\.[cm]?[jt]s$/.test(name) && !/\.d\.[cm]?ts$|\.(test|spec)\.[cm]?[jt]s$/.test(name))
    )
      result.push(name);
  }
  return result.sort();
}

function installedTargets(root) {
  const data = manifest();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const copies = Object.entries(lock.packages ?? {}).filter(([name]) => name.endsWith("/zod"));
  if (
    pkg.overrides?.zod !== data.version ||
    copies.length !== 1 ||
    copies[0][0] !== "node_modules/zod" ||
    copies[0][1].version !== data.version ||
    copies[0][1].integrity !== data.archiveIntegrity ||
    copies[0][1].resolved !== data.archiveUrl
  )
    throw new Error("ZOD_LOCK_IDENTITY");
  const packagePath = join(root, "node_modules/zod/package.json");
  contained(root, packagePath, "node_modules/zod/package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  if (metadata.name !== data.name || metadata.version !== data.version)
    throw new Error("ZOD_INSTALLED_VERSION");
  const all = [...data.files, ...data.guards];
  if (
    JSON.stringify(sourcePaths(join(root, "node_modules/zod"))) !==
    JSON.stringify(all.map((f) => f.path).sort())
  )
    throw new Error("ZOD_SOURCE_SET");
  const targets = data.files.map((f) => ({
    ...f,
    file: contained(root, join(root, "node_modules/zod", f.path), "node_modules/zod/" + f.path),
  }));
  for (const guard of data.guards) {
    const file = contained(
      root,
      join(root, "node_modules/zod", guard.path),
      "node_modules/zod/" + guard.path,
    );
    if (hash(readFileSync(file)) !== guard.sha256) throw new Error("ZOD_GUARD_HASH");
  }
  const entry = realpathSync(join(root, "node_modules/zod/index.cjs"));
  for (const [parent, item] of Object.entries(lock.packages)) {
    if (!item.dependencies?.zod) continue;
    const location = parent ? parent + "/package.json" : "package.json";
    const parentFile = join(root, location);
    if (!existsSync(parentFile)) throw new Error("ZOD_PARENT_MISSING");
    const require = createRequire(contained(root, parentFile, location));
    if (realpathSync(require.resolve("zod")) !== entry) throw new Error("ZOD_PARENT_RESOLUTION");
  }
  return targets;
}

/** All sources and postimages must match before any installed file is changed. */
export function applyZodHardening(root = repoRoot) {
  const states = installedTargets(root).map((f) => ({
    ...f,
    source: readFileSync(f.file, "utf8"),
  }));
  if (states.every((f) => hash(f.source) === f.patchedSha256)) return verifyZodHardening(root);
  if (!states.every((f) => hash(f.source) === f.originalSha256))
    throw new Error("ZOD_UNEXPECTED_SOURCE");
  const planned = states.map((f) => {
    let source = f.source;
    for (const replacement of f.replacements) {
      if (source.split(replacement.before).length !== 2) throw new Error("ZOD_PATCH_CONTEXT");
      source = source.replace(replacement.before, replacement.after);
    }
    if (hash(source) !== f.patchedSha256) throw new Error("ZOD_PATCH_POSTIMAGE");
    return { ...f, patchedSource: source };
  });
  for (const file of planned) writeFileSync(file.file, file.patchedSource, "utf8");
  return verifyZodHardening(root);
}

/** Opaque evidence is bound to this checkout and revalidated when consumed. */
export function verifyZodHardening(root = repoRoot) {
  const targets = installedTargets(root);
  if (targets.some((f) => hash(readFileSync(f.file)) !== f.patchedSha256))
    throw new Error("ZOD_HARDENING_MISSING");
  const proof = Object.freeze({ nodes: Object.freeze(["node_modules/zod"]) });
  proofs.set(proof, realpathSync(root));
  return proof;
}

export function isVerifiedZodHardening(proof, root = repoRoot) {
  if (typeof proof !== "object" || proof === null || proofs.get(proof) !== realpathSync(root))
    return false;
  try {
    const targets = installedTargets(root);
    return targets.every((f) => hash(readFileSync(f.file)) === f.patchedSha256);
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const command = process.argv[2];
    if (command === "apply") applyZodHardening();
    else if (command === "verify") verifyZodHardening();
    else throw new Error("ZOD_COMMAND");
    console.log(
      "zod 3.25.76: verified bounded-collection hardening (" + ZOD_UPSTREAM_COMMIT + ").",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
