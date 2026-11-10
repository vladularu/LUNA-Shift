import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { it } from "vitest";
import { createPrivateCloudRuntime } from "../src/application/private-cloud-runtime";
import { TariffAnnualTestDatabase } from "../src/infrastructure/database/tariff-annual-test-database";
import { saveAppointment } from "../src/infrastructure/database/calendar-entry-repository";
import {
  createPrivateCloudLocal,
  migratePrivateCloud,
} from "../src/infrastructure/database/private-cloud-repository";
import { validatePrivateCloudDocument } from "../src/infrastructure/private-cloud/cloud-document";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/infrastructure/database/migrations";
import type { PrivateCloudDocument } from "../src/domain/private-cloud";

async function main() {
  const output = process.env.LUNA_CLOUD_BENCHMARK_OUTPUT;
  const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");
  const results = [];
  for (const entries of [0, 1000, 5000]) {
    const memory = new TariffAnnualTestDatabase();
    const counts = {
      sqlCalls: 0,
      selects: 0,
      captures: 0,
      applies: 0,
      validations: 0,
      head: 0,
      read: 0,
      write: 0,
    };
    const reset = () => {
      for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0;
    };
    try {
      await memory.setup();
      await migratePrivateCloud(memory.db);
      for (let index = 0; index < entries; index++) {
        await saveAppointment(memory.db, {
          date: "2026-10-17",
          title: `Synthetic ${index}`,
          allDay: true,
          startTime: null,
          endTime: null,
          color: "#123456",
          note: null,
          notification: null,
        });
      }
      const db = new Proxy(memory.db, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (
            ["getFirstAsync", "getAllAsync", "runAsync", "execAsync", "prepareAsync"].includes(
              String(key),
            )
          ) {
            return (...params: unknown[]) => {
              counts.sqlCalls++;
              if (key === "getFirstAsync" || key === "getAllAsync") counts.selects++;
              return (value as (...values: unknown[]) => unknown).apply(target, params);
            };
          }
          return value;
        },
      });
      const presentation: PrivateCloudDocument["presentation"] = {
        calendarImage: null,
        calendarImageStrength: "medium",
      };
      const local = createPrivateCloudLocal(db, {
        sha256,
        readPresentation: async () => {
          counts.captures++;
          return presentation;
        },
        preparePresentation: async () => {
          throw new Error("Unexpected media replacement");
        },
        beforeReplace: async () => {
          throw new Error("Unexpected data replacement");
        },
        recoverNotifications: async () => {
          throw new Error("Unexpected recovery");
        },
      });
      await local.bind("synthetic-account", () => true);
      const document = await local.capture();
      const receipt = { revision: 1, updatedAt: "2026-10-17T12:00:00Z", document };
      assert(await local.apply("synthetic-account", document, receipt, () => true));
      const beforeState = await db.getFirstAsync<{ state_json: string }>(
        "SELECT state_json FROM private_cloud_device WHERE id=1",
      );
      const beforeSnapshot = JSON.stringify(await local.capture());
      const runtime = createPrivateCloudRuntime({
        local: {
          ...local,
          apply: async (...params) => {
            counts.applies++;
            return local.apply(...params);
          },
        },
        remote: {
          head: async () => {
            counts.head++;
            return { revision: 1, updatedAt: receipt.updatedAt };
          },
          read: async () => {
            counts.read++;
            throw new Error("Unexpected full download");
          },
          write: async () => {
            counts.write++;
            throw new Error("Unexpected upload");
          },
          history: async () => [],
        },
        validate: async (value) => {
          counts.validations++;
          await validatePrivateCloudDocument(value, LATEST_DATABASE_SCHEMA_VERSION, sha256);
        },
        makeId: () => {
          throw new Error("Unexpected mutation");
        },
        onApplied: async () => {
          throw new Error("Unexpected reload");
        },
      });
      runtime.setAccount("synthetic-account");
      for (let warmup = 0; warmup < 3; warmup++) {
        await runtime.synchronize();
        assert.equal(runtime.snapshot().phase, "synced");
      }
      reset();
      const milliseconds = [];
      for (let iteration = 0; iteration < 15; iteration++) {
        const start = performance.now();
        await runtime.synchronize();
        milliseconds.push(performance.now() - start);
        assert.equal(runtime.snapshot().phase, "synced");
      }
      const measuredCounts = { ...counts };
      assert.deepEqual(
        await db.getFirstAsync("SELECT state_json FROM private_cloud_device WHERE id=1"),
        beforeState,
      );
      assert.equal(JSON.stringify(await local.capture()), beforeSnapshot);
      assert.equal(measuredCounts.head, 15);
      assert.equal(measuredCounts.read, 0);
      assert.equal(measuredCounts.write, 0);
      assert.equal(measuredCounts.validations, 15);
      const sorted = [...milliseconds].sort((a, b) => a - b);
      results.push({
        entries,
        snapshotBytes: Buffer.byteLength(beforeSnapshot),
        iterations: 15,
        medianMs: sorted[7],
        p95Ms: sorted[14],
        milliseconds,
        counts: measuredCounts,
        persistedStateAndDocumentUnchanged: true,
      });
    } finally {
      memory.database.close();
    }
  }
  const report = {
    recordedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    scope:
      "Local unchanged private-cloud synchronization; real in-memory SQLite, synthetic data, deterministic remote head; not an iPhone or network benchmark",
    results,
  };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { ...report, results: results.map(({ milliseconds, ...result }) => result) },
      null,
      2,
    ),
  );
}

it(
  "measures unchanged private-cloud polls with real SQLite and preserves stored data",
  main,
  120_000,
);
