import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertServedBaseline,
  checkCandidate,
  fetchServedManifest,
} from "./testflight-baseline.mjs";

export function runContractChecks(root) {
  const commands = [
    ["--import", "tsx", "--test", "scripts/testflight-release-contract.test.mjs"],
    ["node_modules/vitest/vitest.mjs", "run", "src/engine/net-pay-payment-forecast.test.ts"],
    [
      "node_modules/jest/bin/jest.js",
      "--runInBand",
      "--runTestsByPath",
      "src/infrastructure/sharing/invitation-delivery.component.test.tsx",
      "src/features/salary/net-pay-automatic-screen.component.test.tsx",
    ],
    ["scripts/verify-calendar-widget-runtime.mjs"],
  ];
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        "Mandatory release contract failed: " +
          args[0] +
          "\n" +
          (result.stdout ?? "") +
          (result.stderr ?? ""),
      );
    process.stdout.write((result.stdout ?? "") + (result.stderr ?? ""));
  }
}

export async function verifyTestFlight(
  root,
  { live = false, contracts = false, fetchImplementation } = {},
) {
  const { baseline, inventory, report } = checkCandidate(root);
  if (live)
    assertServedBaseline(baseline, await fetchServedManifest(baseline, fetchImplementation));
  if (contracts) runContractChecks(root);
  return { ...report, runtime: baseline.runtime, liveBaselineVerified: live, inventory };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !["--live", "--contracts"].includes(arg)))
      throw new Error("Usage: node scripts/verify-testflight-baseline.mjs [--live] [--contracts]");
    const result = await verifyTestFlight(resolve(import.meta.dirname, ".."), {
      live: args.includes("--live"),
      contracts: args.includes("--contracts"),
    });
    const { inventory, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
