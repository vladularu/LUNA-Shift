import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export async function buildLocale(output) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  mkdirSync(output, { recursive: true });
  const file = "locale-worker.mjs";
  await build({
    entryPoints: [path.join(root, "web/locale-worker.ts")],
    outfile: path.join(output, file),
    platform: "browser",
    format: "esm",
    target: "es2022",
    bundle: true,
  });
  const receipt = {
    format: 1,
    file,
    sha256: createHash("sha256")
      .update(readFileSync(path.join(output, file)))
      .digest("hex"),
    containsWasm: false,
  };
  writeFileSync(
    path.join(output, "locale-build-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("EXPECTED_OUTPUT_DIRECTORY");
  await buildLocale(path.resolve(process.argv[2]));
}
