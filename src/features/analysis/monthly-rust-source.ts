import type { MonthlyAnalysisRequest } from "./monthly-analysis";
import type { MonthlyRustInputs } from "./monthly-rust-finance";
import type { SQLiteDatabase } from "expo-sqlite";
import { Temporal } from "@js-temporal/polyfill";
import { measureAnalysisInput } from "@/application/analysis-input-performance";
import type { RuleCatalogRuntimeDiagnosis } from "@/application/rule-catalog-runtime";
import { withImmediateTransaction } from "@/infrastructure/database/transaction";
import { createNativeEngineCatalogReader } from "./monthly-rust-catalog";
import {
  NATIVE_ENGINE_SOURCE_SQL,
  nativeEngineSourceQuery,
  type NativeEngineSqlSourceKind,
} from "./monthly-rust-sql";
import {
  createMonthlyRustBridge,
  type MonthlyRustTransport,
  type MonthlyRustCalculator,
} from "./monthly-rust-bridge";

interface RawJson {
  readonly count: number;
  readonly bytes: number;
  readonly json: string | null;
}

/** Only reads existing rows. Both finance consumers share this original adapter. */
export function createStoredMonthlyRustInputReader(
  db: SQLiteDatabase,
  diagnosis: RuleCatalogRuntimeDiagnosis,
) {
  const catalogs = createNativeEngineCatalogReader(db);
  return async (
    request: Pick<MonthlyAnalysisRequest, "entries" | "profile">,
  ): Promise<MonthlyRustInputs> => {
    const sources = await withImmediateTransaction(db, async (tx) => {
      const result: Record<string, unknown> = {};
      let remaining = 32 * 1024 * 1024 - 262_144;
      for (const kind of Object.keys(NATIVE_ENGINE_SOURCE_SQL) as NativeEngineSqlSourceKind[]) {
        const row = await tx.getFirstAsync<RawJson>(nativeEngineSourceQuery(kind), remaining);
        if (
          !row ||
          !Number.isSafeInteger(row.bytes) ||
          row.bytes < 0 ||
          row.bytes > remaining ||
          (row.json === null && !(NATIVE_ENGINE_SOURCE_SQL[kind].single && row.count === 0))
        )
          throw new Error("RUST_MONTH_SOURCE_INVALID");
        remaining -= row.bytes;
        const json = row.json;
        result[kind] =
          json === null ? null : measureAnalysisInput(1, json.length, () => JSON.parse(json));
      }
      return result;
    });
    const calendar = sources.CALENDAR_ENTRIES as {
      shiftRows: { id: string; revision: number }[];
      appointmentRows: { id: string; revision: number }[];
    };
    // The provider retains a window of calendar entries. The database also holds
    // other years. Send exactly the requested snapshot under its calculation key.
    const expectedShifts = new Map<string, number>();
    const expectedAppointments = new Map<string, number>();
    for (const entry of request.entries) {
      if (entry.deletedAt !== null) continue;
      (entry.kind === "SHIFT" ? expectedShifts : expectedAppointments).set(
        entry.id,
        entry.revision,
      );
    }
    const select = (rows: typeof calendar.shiftRows, expected: ReadonlyMap<string, number>) => {
      const selected = rows.filter((row) => expected.get(row.id) === row.revision);
      if (selected.length !== expected.size) throw new Error("RUST_MONTH_INPUT_CHANGED");
      return selected;
    };
    sources.CALENDAR_ENTRIES = {
      ...calendar,
      shiftRows: select(calendar.shiftRows, expectedShifts),
      appointmentRows: select(calendar.appointmentRows, expectedAppointments),
    };
    const current: Record<string, unknown> = {};
    for (const part of await catalogs.collect(diagnosis)) {
      if (part.state !== "READY" || part.presence !== "VALUE")
        throw new Error("RUST_MONTH_CATALOG_UNAVAILABLE");
      current[part.kind.toLowerCase()] = {
        state: "READY",
        revision: 1,
        coverage: { kind: "ALL_HISTORY" },
        payload: {
          schemaVersion: 1,
          data: {
            kind: "VALUE",
            value: measureAnalysisInput(2, part.body.length, () => JSON.parse(part.body)),
          },
        },
      };
    }
    return {
      referenceDate: Temporal.Now.plainDateISO(request.profile.timeZone).toString(),
      sources,
      catalogs: {
        current: { ...current, selectedPackageIds: { tariff: [], legal: [], holiday: [] } },
        history: [],
      },
    };
  };
}
export function createStoredMonthlyRustCalculator(
  db: SQLiteDatabase,
  transport: MonthlyRustTransport,
  diagnosis: RuleCatalogRuntimeDiagnosis,
): MonthlyRustCalculator {
  const calculate = createMonthlyRustBridge(transport);
  const read = createStoredMonthlyRustInputReader(db, diagnosis);
  const stored: MonthlyRustCalculator = async (request) => calculate(request, await read(request));
  return Object.assign(stored, { cacheIdentity: transport.expectedEngineVersion });
}
