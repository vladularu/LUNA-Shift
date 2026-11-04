import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_PATH,
  REVIEW_PATH,
  assertServedBaseline,
  checkCandidate,
  confinedPath,
  fetchServedManifest,
  inventoryDigest,
  sha256,
} from "./testflight-baseline.mjs";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function parseOptions(args) {
  const options = { dryRun: false, publish: false, message: "TestFlight source preflight" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--publish") options.publish = true;
    else if (["--message", "--prepared", "--plan-sha"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for " + arg);
      options[arg === "--message" ? "message" : arg === "--prepared" ? "prepared" : "planSha"] =
        value;
    } else throw new Error("Unsupported OTA option: " + arg);
  }
  if (!/^[\p{L}\p{N} .,:/_#()-]{1,200}$/u.test(options.message))
    throw new Error("Use a plain, single-line release message");
  if (Boolean(options.prepared) !== Boolean(options.planSha))
    throw new Error("Incomplete prepared release plan");
  if (
    options.prepared &&
    (!/^artifacts\/testflight-release\/[a-f0-9-]+\/plan\.json$/.test(options.prepared) ||
      !/^[a-f0-9]{64}$/.test(options.planSha))
  )
    throw new Error("Invalid prepared release path or checksum");
  if (options.dryRun && options.publish) throw new Error("Choose either dry run or publication");
  if (!options.prepared && !options.dryRun && !options.publish)
    throw new Error("Choose --dry-run or --publish explicitly");
  if (options.publish && !args.includes("--message"))
    throw new Error("Publication requires an explicit release message");
  return options;
}
export async function executeRelease(plan, steps) {
  await steps.source();
  await steps.live();
  await steps.environment();
  await steps.contracts();
  const runtime = await steps.fingerprint();
  if (runtime !== plan.runtime)
    throw new Error("The candidate does not match the installed Build-9 runtime");
  await steps.source();
  if (plan.dryRun)
    return { published: false, dryRun: true, runtime, sourceDigest: plan.sourceDigest };
  const exported = await steps.exportBundle();
  await steps.source();
  await steps.live();
  await steps.exportUnchanged(exported);
  const update = await steps.publish(exported);
  const delivery = await steps.verifyDelivery(update, exported);
  return {
    published: true,
    dryRun: false,
    runtime,
    sourceDigest: plan.sourceDigest,
    projectId: plan.projectId,
    buildId: plan.buildId,
    build: 9,
    platform: "ios",
    channel: "production",
    update,
    delivery,
    deviceAcceptance: "pending",
  };
}
function runNode(root, args, log, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(log, (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.error || result.status !== 0)
    throw new Error(
      "Release command failed; inspect " + log + (result.error ? ": " + result.error.message : ""),
    );
  return result.stdout;
}
function npxScript() {
  const npm = process.env.npm_execpath;
  const candidate = [
    npm ? join(dirname(npm), "npx-cli.js") : "",
    join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js"),
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npx-cli.js"),
  ].find((path) => path && existsSync(path));
  if (!candidate) throw new Error("Cannot locate the npx CLI installed with Node.js");
  return candidate;
}
function fileHashes(root) {
  return Object.fromEntries(
    [
      BASELINE_PATH,
      REVIEW_PATH,
      "scripts/testflight-baseline.mjs",
      "scripts/verify-testflight-baseline.mjs",
      "scripts/publish-testflight-ota.mjs",
      "scripts/testflight-release-contract.test.mjs",
    ].map((path) => [path, sha256(readFileSync(join(root, path)))]),
  );
}
export function exportSnapshot(root, output) {
  const exportRoot = confinedPath(root, output);
  const metadataPath = confinedPath(exportRoot, "metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (
    metadata.version !== 0 ||
    !metadata.fileMetadata?.ios ||
    Object.keys(metadata.fileMetadata).some((key) => key !== "ios")
  )
    throw new Error("Expected a single iOS export");
  const ios = metadata.fileMetadata.ios;
  const bundlePath = confinedPath(exportRoot, ios.bundle);
  const assets = ios.assets.map((entry) => {
    const path = confinedPath(exportRoot, entry.path);
    return { key: basename(entry.path), path, sha256: sha256(readFileSync(path)) };
  });
  if (new Set(assets.map((entry) => entry.key)).size !== assets.length)
    throw new Error("Export contains duplicate asset keys");
  return {
    output,
    metadataPath,
    metadataSha256: sha256(readFileSync(metadataPath)),
    bundlePath,
    bundleSha256: sha256(readFileSync(bundlePath)),
    assets,
  };
}
export function assertExportUnchanged(exported) {
  if (
    sha256(readFileSync(exported.metadataPath)) !== exported.metadataSha256 ||
    sha256(readFileSync(exported.bundlePath)) !== exported.bundleSha256 ||
    exported.assets.some((asset) => sha256(readFileSync(asset.path)) !== asset.sha256)
  ) {
    throw new Error("The checked iOS export changed before publication");
  }
}
async function verifyPublished(baseline, update, exported) {
  let manifest;
  for (let attempt = 0; attempt < 4; attempt++) {
    manifest = await fetchServedManifest(baseline);
    if (manifest.id === update.id) break;
    await new Promise((done) => setTimeout(done, 2000));
  }
  if (
    manifest.id !== update.id ||
    manifest.runtimeVersion !== baseline.runtime ||
    manifest.extra?.expoClient?.extra?.appVariant !== "production" ||
    manifest.extra?.expoClient?.ios?.bundleIdentifier !== "com.lunashift.app"
  )
    throw new Error("Published update is not served to the expected Build-9 client");
  const expected = new Map(exported.assets.map((asset) => [asset.key, asset]));
  if (
    manifest.assets.length !== expected.size ||
    new Set(manifest.assets.map((asset) => asset.key)).size !== expected.size
  )
    throw new Error("Published asset list differs from the checked export");
  const entries = [
    { remote: manifest.launchAsset, sha256: exported.bundleSha256, kind: "bundle" },
    ...manifest.assets.map((asset) => ({
      remote: asset,
      sha256: expected.get(asset.key)?.sha256,
      kind: "asset",
    })),
  ];
  const verified = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, entries.length) }, async () => {
      while (next < entries.length) {
        const entry = entries[next++];
        const url = new URL(entry.remote.url);
        if (url.origin !== "https://assets.eascdn.net" || !entry.sha256)
          throw new Error("Unexpected update asset");
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (response.status !== 200) throw new Error("Published asset HTTP " + response.status);
        const bytes = Buffer.from(await response.arrayBuffer());
        const hash = sha256(bytes);
        if (
          hash !== entry.sha256 ||
          hash !== Buffer.from(entry.remote.hash, "base64url").toString("hex")
        )
          throw new Error("Published asset differs from the checked export");
        verified.push({
          key: entry.remote.key,
          sha256: hash,
          bytes: bytes.length,
          kind: entry.kind,
        });
      }
    }),
  );
  return {
    updateId: update.id,
    group: update.group,
    assetsVerified: exported.assets.length,
    bundleSha256: exported.bundleSha256,
    httpStatus: 200,
    verified,
  };
}
async function preparedRelease(root, options) {
  const planPath = confinedPath(root, options.prepared);
  const raw = readFileSync(planPath);
  if (sha256(raw) !== options.planSha) throw new Error("Prepared release plan changed");
  const plan = JSON.parse(raw.toString("utf8"));
  if (
    plan.schemaVersion !== 1 ||
    typeof plan.dryRun !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(plan.sourceDigest ?? "")
  )
    throw new Error("Invalid release plan");
  if (
    !Array.isArray(plan.sourceInventory) ||
    inventoryDigest(plan.sourceInventory) !== plan.sourceDigest
  )
    throw new Error("Prepared source inventory changed");
  parseOptions(["--dry-run", "--message", plan.message]);
  const artifacts = dirname(planPath);
  const output = options.prepared.replace(/\/plan\.json$/, "/ios");
  const check = () => {
    const candidate = checkCandidate(root);
    assert.equal(
      inventoryDigest(candidate.inventory),
      plan.sourceDigest,
      "Release source changed after preflight",
    );
    assert.deepEqual(
      fileHashes(root),
      plan.guardHashes,
      "Release guard or accepted baseline changed after preflight",
    );
    assert.equal(candidate.baseline.runtime, plan.runtime);
    return candidate;
  };
  const { baseline } = check();
  const npx = npxScript();
  const steps = {
    source: async () => {
      check();
    },
    live: async () => assertServedBaseline(baseline, await fetchServedManifest(baseline)),
    environment: async () => {
      if (
        process.env.APP_VARIANT !== "production" ||
        !process.env.EXPO_PUBLIC_SHARING_SUPABASE_URL ||
        !process.env.EXPO_PUBLIC_SHARING_SUPABASE_PUBLISHABLE_KEY
      )
        throw new Error("The EAS production environment was not loaded");
      const config = createRequire(import.meta.url)("expo/config").getConfig(root).exp;
      if (
        config.extra?.appVariant !== "production" ||
        config.ios?.bundleIdentifier !== "com.lunashift.app" ||
        config.extra?.eas?.projectId !== baseline.projectId
      )
        throw new Error("Unexpected production app configuration");
    },
    contracts: async () => {
      runNode(
        root,
        ["scripts/verify-testflight-baseline.mjs", "--contracts"],
        join(artifacts, "contracts.log"),
      );
    },
    fingerprint: async () =>
      JSON.parse(
        runNode(
          root,
          ["node_modules/expo-updates/bin/cli.js", "fingerprint:generate", "--platform", "ios"],
          join(artifacts, "fingerprint.log"),
        ),
      ).hash,
    exportBundle: async () => {
      runNode(
        root,
        [
          "node_modules/expo/bin/cli",
          "export",
          "--platform",
          "ios",
          "--output-dir",
          output,
          "--max-workers",
          "2",
        ],
        join(artifacts, "export.log"),
      );
      return exportSnapshot(root, output);
    },
    exportUnchanged: async (exported) => assertExportUnchanged(exported),
    publish: async (exported) => {
      const result = JSON.parse(
        runNode(
          root,
          [
            npx,
            "--yes",
            "eas-cli@latest",
            "update",
            "--channel",
            "production",
            "--platform",
            "ios",
            "--environment",
            "production",
            "--input-dir",
            exported.output,
            "--skip-bundler",
            "--message",
            plan.message,
            "--json",
            "--non-interactive",
          ],
          join(artifacts, "publish.log"),
        ),
      );
      if (
        !Array.isArray(result) ||
        result.length !== 1 ||
        result[0].platform !== "ios" ||
        !UUID.test(result[0].id ?? "") ||
        !UUID.test(result[0].group ?? "") ||
        (result[0].runtimeVersion ?? result[0].runtime?.version) !== baseline.runtime
      )
        throw new Error(
          "Unexpected published update metadata; inspect the publication before retrying",
        );
      return { id: result[0].id, group: result[0].group };
    },
    verifyDelivery: async (update, exported) => verifyPublished(baseline, update, exported),
  };
  const result = await executeRelease(plan, steps);
  writeFileSync(join(artifacts, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
export async function main(args) {
  const root = resolve(import.meta.dirname, "..");
  const options = parseOptions(args);
  if (options.prepared) return preparedRelease(root, options);
  const candidate = checkCandidate(root);
  const relative = "artifacts/testflight-release/" + randomUUID() + "/plan.json";
  const planPath = confinedPath(root, relative);
  mkdirSync(dirname(planPath), { recursive: true });
  const plan = {
    schemaVersion: 1,
    dryRun: options.dryRun,
    message: options.message,
    runtime: candidate.baseline.runtime,
    sourceDigest: candidate.report.sourceDigest,
    sourceInventory: candidate.inventory,
    projectId: candidate.baseline.projectId,
    buildId: candidate.baseline.buildId,
    createdAt: new Date().toISOString(),
    guardHashes: fileHashes(root),
  };
  const raw = JSON.stringify(plan, null, 2) + "\n";
  writeFileSync(planPath, raw);
  const command =
    "node scripts/publish-testflight-ota.mjs --prepared " + relative + " --plan-sha " + sha256(raw);
  const output = runNode(
    root,
    [
      npxScript(),
      "--yes",
      "eas-cli@latest",
      "env:exec",
      "production",
      "--non-interactive",
      command,
    ],
    join(dirname(planPath), "environment.log"),
    { ...process.env, APP_VARIANT: "production" },
  );
  console.log(output.trim());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
