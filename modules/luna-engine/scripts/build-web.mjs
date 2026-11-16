import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

export async function buildWeb({ wasm, bindgen, output }) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (execFileSync(bindgen, ["--version"], { encoding: "utf8" }).trim() !== "wasm-bindgen 0.2.130")
    throw new Error("PINNED_BINDGEN_REQUIRED");
  const source = readFileSync(wasm);
  if (!source.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])))
    throw new Error("WASM_INPUT_REQUIRED");
  mkdirSync(output, { recursive: true });
  // Scope ESM metadata to generated output, never change the app's package type.
  writeFileSync(path.join(output, "package.json"), '{"type":"module","private":true}\n');
  execFileSync(
    bindgen,
    [wasm, "--target", "web", "--out-dir", output, "--out-name", "luna_engine"],
    { stdio: "inherit" },
  );
  await bundle({
    entryPoints: [path.join(root, "web/worker.ts")],
    outfile: path.join(output, "worker.mjs"),
    platform: "browser",
    format: "esm",
    target: "es2022",
    bundle: true,
  });
  const files = ["worker.mjs", "luna_engine.js", "luna_engine_bg.wasm"];
  const artifacts = files.map((file) => ({
    file,
    sha256: createHash("sha256")
      .update(readFileSync(path.join(output, file)))
      .digest("hex"),
  }));
  writeFileSync(
    path.join(output, "build-receipt.json"),
    `${JSON.stringify({ sourceWasmSha256: createHash("sha256").update(source).digest("hex"), bindgen: "0.2.130", artifacts }, null, 2)}\n`,
  );
  return artifacts;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [wasm, bindgen, output] = process.argv.slice(2);
  if (!wasm || !bindgen || !output) throw new Error("EXPECTED_WASM_BINDGEN_OUTPUT");
  await buildWeb({
    wasm: path.resolve(wasm),
    bindgen: path.resolve(bindgen),
    output: path.resolve(output),
  });
}
