import { parentPort, workerData } from "node:worker_threads";
globalThis.postMessage = (value) => parentPort.postMessage(value);
parentPort.on("message", (data) => globalThis.onmessage?.({ data }));
await import(workerData.entry);
