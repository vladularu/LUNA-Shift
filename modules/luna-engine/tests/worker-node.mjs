// Test-only Web Worker shim. The production bundle uses a DedicatedWorker.
import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const originalFetch = globalThis.fetch;
const root = path.resolve(path.dirname(fileURLToPath(workerData.entry)));
globalThis.fetch = async (resource, options) => {
  const url =
    resource instanceof URL
      ? resource
      : new URL(typeof resource === "string" ? resource : resource.url);
  if (url.protocol !== "file:") return originalFetch(resource, options);
  const target = path.resolve(fileURLToPath(url));
  if (path.dirname(target) !== root || path.basename(target) !== "luna_engine_bg.wasm")
    throw new Error("UNEXPECTED_TEST_ASSET");
  return new Response(await readFile(target), { headers: { "Content-Type": "application/wasm" } });
};
globalThis.postMessage = (message) => parentPort.postMessage(message);
globalThis.close = () => parentPort.close();
parentPort.on("message", (data) => globalThis.onmessage?.({ data }));
await import(workerData.entry);
