import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_PATH,
  REVIEW_PATH,
  assertServedBaseline,
  confinedPath,
  fetchServedManifest,
  inventoryDigest,
  validateBaseline,
} from "./testflight-baseline.mjs";

export function acceptedBaselineFromReceipt(plan, result, evidence) {
  if (
    result.published !== true ||
    result.dryRun !== false ||
    result.channel !== "production" ||
    result.platform !== "ios" ||
    result.build !== 9 ||
    result.delivery?.httpStatus !== 200 ||
    result.delivery?.updateId !== result.update?.id ||
    result.delivery?.group !== result.update?.group ||
    result.sourceDigest !== plan.sourceDigest ||
    inventoryDigest(plan.sourceInventory) !== plan.sourceDigest ||
    evidence.status !== "accepted" ||
    evidence.updateId !== result.update.id ||
    evidence.sourceDigest !== plan.sourceDigest ||
    evidence.build !== 9 ||
    !["calendar", "widgets", "netPay", "invitation"].every(
      (flow) => evidence.flows?.[flow] === "passed",
    ) ||
    typeof evidence.quote !== "string" ||
    !evidence.quote.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(evidence.date ?? "") ||
    evidence.date < String(plan.createdAt ?? "").slice(0, 10)
  ) {
    throw new Error(
      "A matching publication receipt and explicit acceptance of all four flows are required",
    );
  }
  const assets = result.delivery.verified
    .filter((entry) => entry.kind === "asset")
    .map(({ key, sha256 }) => ({ key, sha256 }));
  const bundles = result.delivery.verified.filter((entry) => entry.kind === "bundle");
  if (
    assets.length !== result.delivery.assetsVerified ||
    bundles.length !== 1 ||
    bundles[0].sha256 !== result.delivery.bundleSha256
  )
    throw new Error("Incomplete verified delivery receipt");
  const baseline = {
    schemaVersion: 1,
    build: 9,
    platform: "ios",
    channel: "production",
    projectId: result.projectId,
    buildId: result.buildId,
    runtime: result.runtime,
    updateId: result.update.id,
    group: result.update.group,
    bundleSha256: result.delivery.bundleSha256,
    sourceManifestSha256: plan.sourceDigest,
    deviceAcceptance: {
      status: "accepted",
      date: evidence.date,
      quote: evidence.quote,
      flows: evidence.flows,
    },
    assets,
    files: plan.sourceInventory,
  };
  validateBaseline(baseline);
  return baseline;
}
export async function main(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (!["--plan", "--result", "--evidence"].includes(key) || !value || values[key])
      throw new Error("Usage: --plan FILE --result FILE --evidence FILE");
    values[key] = value;
  }
  if (Object.keys(values).length !== 3)
    throw new Error("Plan, result and device evidence are required");
  const root = resolve(import.meta.dirname, "..");
  const read = (key) => JSON.parse(readFileSync(confinedPath(root, values[key]), "utf8"));
  const baseline = acceptedBaselineFromReceipt(
    read("--plan"),
    read("--result"),
    read("--evidence"),
  );
  assertServedBaseline(baseline, await fetchServedManifest(baseline));
  writeFileSync(resolve(root, BASELINE_PATH), JSON.stringify(baseline, null, 2) + "\n");
  writeFileSync(
    resolve(root, REVIEW_PATH),
    JSON.stringify(
      { schemaVersion: 1, baselineUpdateId: baseline.updateId, changes: [] },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      recorded: true,
      updateId: baseline.updateId,
      files: baseline.files.length,
      gitDeliveryRequired: true,
    }),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
