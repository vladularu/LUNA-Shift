import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const SOURCE_ROOTS = ["app", "src", "assets", "rules", "plugins", "modules"];
export const ROOT_FILES = [
  "app.config.ts",
  "app.json",
  "package.json",
  "package-lock.json",
  "eas.json",
  "babel.config.js",
  "metro.config.js",
  "fingerprint.config.js",
  "tsconfig.json",
];
export const CRITICAL_FILES = [
  "scripts/runtime-policy.test.mjs",
  "src/engine/net-pay-payment-forecast.test.ts",
  "src/features/salary/net-pay-automatic-screen.component.test.tsx",
  "src/infrastructure/sharing/invitation-delivery.component.test.tsx",
  "src/features/widgets/calendar-widget-data.test.ts",
  "src/features/widgets/calendar-widget-sync.component.test.tsx",
  "src/features/widgets/native-calendar-widget.component.test.tsx",
  "src/features/widgets/shared-widget-data.test.ts",
  "src/features/widgets/widget-calendar-highlights.test.ts",
  "src/ui/glass-back-button.component.test.tsx",
  "src/ui/screen-layout.component.test.tsx",
  "src/features/analysis/analysis-header-spacing.component.test.tsx",
  "src/features/calendar/calendar-header.component.test.tsx",
  "scripts/verify-calendar-widget-runtime.mjs",
];
export const SOURCE_ONLY_ORIGINALS = [
  "assets/brand/lunashift/app-icon-2026-11.jpg",
  "assets/brand/lunashift/splash-dark-2026-11.jpg",
  "assets/brand/lunashift/splash-light-2026-11.jpg",
];
export const BASELINE_PATH = "releases/testflight/build-9.accepted.json";
export const REVIEW_PATH = "releases/testflight/build-9.reviewed-changes.json";
const TEXT =
  /\.(?:[cm]?[jt]sx?|json|ya?ml|swift|podspec|[hm]|mm|xml|plist|gradle|properties|txt|svg|sh|xcconfig)$/i;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
export function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.split("/").some((part) => !part || part === "." || part === "..") &&
    !/[*?\0]/.test(value)
  );
}
export function isReleaseSource(path) {
  if (!safePath(path) || SOURCE_ONLY_ORIGINALS.includes(path)) return false;
  if (CRITICAL_FILES.includes(path)) return true;
  if (/\.(?:md|mdx)$/i.test(path) || /\.test\.[cm]?[jt]sx?$/i.test(path)) return false;
  return ROOT_FILES.includes(path) || SOURCE_ROOTS.some((root) => path.startsWith(root + "/"));
}
export function contentHash(path, bytes) {
  if (!TEXT.test(path)) return sha256(bytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return sha256(text.replace(/\r\n/g, "\n"));
}
export function sourceInventory(root) {
  const files = [];
  function walk(path) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("Release source must not be a symlink: " + path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (["node_modules", ".git", ".expo", "Pods", ".DS_Store"].includes(name)) continue;
        walk(path ? path + "/" + name : name);
      }
    } else if (stat.isFile() && isReleaseSource(path)) {
      files.push({ path, sha256: contentHash(path, readFileSync(absolute)) });
    }
  }
  for (const directory of SOURCE_ROOTS) walk(directory);
  for (const path of ROOT_FILES) walk(path);
  for (const path of CRITICAL_FILES) if (!files.some((entry) => entry.path === path)) walk(path);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export function inventoryDigest(files) {
  return sha256(
    JSON.stringify([...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))),
  );
}
export function validateBaseline(baseline) {
  if (
    baseline.schemaVersion !== 1 ||
    baseline.platform !== "ios" ||
    baseline.channel !== "production" ||
    baseline.build !== 9 ||
    !UUID.test(baseline.projectId ?? "") ||
    !UUID.test(baseline.buildId ?? "") ||
    !UUID.test(baseline.updateId ?? "") ||
    !UUID.test(baseline.group ?? "") ||
    !/^[a-f0-9]{40}$/.test(baseline.runtime ?? "") ||
    !HASH.test(baseline.bundleSha256 ?? "") ||
    !HASH.test(baseline.sourceManifestSha256 ?? "") ||
    baseline.deviceAcceptance?.status !== "accepted" ||
    !baseline.deviceAcceptance?.quote?.trim() ||
    !["calendar", "widgets", "netPay", "invitation"].every(
      (flow) => baseline.deviceAcceptance?.flows?.[flow] === "passed",
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(baseline.deviceAcceptance?.date ?? "")
  ) {
    throw new Error("Invalid or unaccepted TestFlight baseline");
  }
  if (!Array.isArray(baseline.files) || baseline.files.length === 0)
    throw new Error("Baseline source manifest is empty");
  const seen = new Set();
  for (const entry of baseline.files) {
    if (!isReleaseSource(entry.path) || !HASH.test(entry.sha256 ?? "") || seen.has(entry.path)) {
      throw new Error("Invalid or duplicate baseline path: " + entry.path);
    }
    seen.add(entry.path);
  }
  if (!Array.isArray(baseline.assets) || baseline.assets.length === 0)
    throw new Error("Baseline asset manifest is empty");
  const assetKeys = new Set();
  for (const asset of baseline.assets) {
    if (
      typeof asset.key !== "string" ||
      !asset.key ||
      !HASH.test(asset.sha256 ?? "") ||
      assetKeys.has(asset.key)
    )
      throw new Error("Invalid baseline asset");
    assetKeys.add(asset.key);
  }
}
export function compareSources(baseline, review, current) {
  validateBaseline(baseline);
  if (
    review.schemaVersion !== 1 ||
    review.baselineUpdateId !== baseline.updateId ||
    !Array.isArray(review.changes)
  ) {
    throw new Error("Review does not belong to the accepted TestFlight update");
  }
  const accepted = new Map(baseline.files.map((entry) => [entry.path, entry.sha256]));
  const candidate = new Map();
  for (const entry of current) {
    if (!isReleaseSource(entry.path) || !HASH.test(entry.sha256 ?? "") || candidate.has(entry.path))
      throw new Error("Invalid candidate path: " + entry.path);
    candidate.set(entry.path, entry.sha256);
  }
  const approvals = new Map();
  for (const entry of review.changes) {
    if (
      !isReleaseSource(entry.path) ||
      approvals.has(entry.path) ||
      !["added", "modified", "removed"].includes(entry.kind) ||
      (entry.kind === "removed" ? entry.sha256 !== null : !HASH.test(entry.sha256 ?? "")) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 20
    ) {
      throw new Error("Invalid explicit source review: " + entry.path);
    }
    approvals.set(entry.path, entry);
  }
  const changes = [];
  const failures = [];
  for (const path of [...new Set([...accepted.keys(), ...candidate.keys()])].sort()) {
    const before = accepted.get(path),
      after = candidate.get(path);
    const approval = approvals.get(path);
    if (before === after) {
      if (approval) failures.push("Stale source review: " + path);
      continue;
    }
    const kind = before === undefined ? "added" : after === undefined ? "removed" : "modified";
    const allowed = approval?.kind === kind && approval.sha256 === (after ?? null);
    changes.push({
      path,
      kind,
      before: before ?? null,
      after: after ?? null,
      reviewed: allowed,
      reason: allowed ? approval.reason : null,
    });
    if (!allowed) failures.push("Unreviewed " + kind + ": " + path);
  }
  for (const path of approvals.keys()) {
    if (!accepted.has(path) && !candidate.has(path))
      failures.push("Review points to a nonexistent source: " + path);
  }
  return {
    ok: failures.length === 0,
    baselineUpdateId: baseline.updateId,
    sourceFiles: current.length,
    sourceDigest: inventoryDigest(current),
    changes,
    failures,
  };
}
export function checkCandidate(root) {
  const baseline = JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));
  const review = JSON.parse(readFileSync(join(root, REVIEW_PATH), "utf8"));
  for (const path of CRITICAL_FILES) {
    if (!baseline.files?.some((entry) => entry.path === path))
      throw new Error("Accepted baseline lacks a mandatory regression test: " + path);
  }
  const inventory = sourceInventory(root);
  for (const path of CRITICAL_FILES) {
    if (!inventory.some((entry) => entry.path === path))
      throw new Error("Mandatory regression test was removed: " + path);
  }
  const report = compareSources(baseline, review, inventory);
  if (!report.ok)
    throw new Error("TestFlight source preservation failed:\n" + report.failures.join("\n"));
  return { baseline, review, inventory, report };
}
export function decodeManifest(contentType, raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (!contentType.toLowerCase().includes("multipart/")) return JSON.parse(text);
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const value = boundary?.[1] ?? boundary?.[2];
  if (!value || value.length > 200) throw new Error("Invalid update manifest boundary");
  for (const part of text.split("--" + value)) {
    const separator = part.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const head = part.slice(0, separator);
    if (/content-disposition:[^\r\n]*\bname="?manifest"?(?:;|[\r\n]|$)/i.test(head + "\r\n")) {
      return JSON.parse(part.slice(separator + 4).trim());
    }
  }
  throw new Error("Update response contains no manifest");
}
export function assertServedBaseline(baseline, manifest) {
  validateBaseline(baseline);
  if (
    manifest.id !== baseline.updateId ||
    manifest.runtimeVersion !== baseline.runtime ||
    manifest.extra?.expoClient?.extra?.appVariant !== "production" ||
    manifest.extra?.expoClient?.ios?.bundleIdentifier !== "com.lunashift.app"
  ) {
    throw new Error("Production baseline changed; re-audit the currently served update");
  }
  const digest = (value) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new Error("Invalid update SHA-256");
    return Buffer.from(value, "base64url").toString("hex");
  };
  if (digest(manifest.launchAsset?.hash) !== baseline.bundleSha256)
    throw new Error("Served baseline bundle differs");
  const expected = new Map(baseline.assets.map((entry) => [entry.key, entry.sha256]));
  const seen = new Set();
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== expected.size)
    throw new Error("Served baseline assets differ");
  for (const asset of manifest.assets) {
    if (seen.has(asset.key) || expected.get(asset.key) !== digest(asset.hash))
      throw new Error("Served baseline asset differs: " + asset.key);
    seen.add(asset.key);
  }
}
export async function fetchServedManifest(baseline, fetchImplementation = fetch) {
  const response = await fetchImplementation("https://u.expo.dev/" + baseline.projectId, {
    headers: {
      "expo-platform": "ios",
      "expo-runtime-version": baseline.runtime,
      "expo-channel-name": "production",
      "expo-protocol-version": "1",
      accept: "application/expo+json, application/json, multipart/mixed",
      "cache-control": "no-cache",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200)
    throw new Error("Update service unavailable: HTTP " + response.status);
  return decodeManifest(
    response.headers.get("content-type") ?? "",
    Buffer.from(await response.arrayBuffer()),
  );
}
export function confinedPath(root, file) {
  const absolute = resolve(root, file);
  const inside = relative(resolve(root), absolute);
  if (
    !inside ||
    isAbsolute(inside) ||
    inside === ".." ||
    inside.startsWith(".." + sep) ||
    resolve(root) === absolute
  )
    throw new Error("Release artifact path must stay inside the checkout");
  return absolute;
}
