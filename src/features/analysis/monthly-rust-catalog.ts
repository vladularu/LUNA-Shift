import type { SQLiteDatabase } from "expo-sqlite";
import type { RuleCatalogRuntimeDiagnosis } from "../../application/rule-catalog-runtime";
import { withImmediateTransaction } from "@/infrastructure/database/transaction";
class NativeEngineSourceReadSuperseded extends Error {
  constructor() {
    super("RUST_MONTH_INPUT_CHANGED");
  }
}
interface NativeRawCatalogPart {
  readonly kind: "TARIFF" | "LEGAL" | "HOLIDAY";
  readonly state: "READY" | "FAILED";
  readonly presence: "VALUE" | "NULL";
  readonly body: string;
}
interface EncodedPart {
  count: number;
  bytes: number;
  body: string | null;
}
const kinds = ["TARIFF", "LEGAL", "HOLIDAY"] as const;
const MAX_BYTES = 33_554_432 - 262_144;
function chunks(column: string) {
  return `json(CASE WHEN instr(${column},char(0))>0 THEN json_array(${column}) ELSE (
    WITH RECURSIVE pieces(pos,part) AS (
      SELECT 1,substr(${column},1,16000)
      UNION ALL SELECT pos+16000,substr(${column},pos+16000,16000)
      FROM pieces WHERE pos+16000<=length(${column})
    ) SELECT json_group_array(part) FROM pieces) END)`;
}
function partQuery(kind: (typeof kinds)[number]) {
  const packages = `(SELECT json_group_array(json(encoded)) FROM package_rows)`;
  const body =
    kind === "TARIFF"
      ? `json_object('mode','EXTERNAL',
    'packageJsonChunks',json(${packages}),
    'manifestJsonChunks',${chunks("(SELECT manifest_json FROM manifest_row)")},
    'historicalPolicy','APP_COMPATIBILITY','collationRanks',json('{}'))`
      : `json_object('mode','EXTERNAL','packageJsonChunks',json(${packages}))`;
  return `WITH manifest_row AS (SELECT manifest_json FROM rule_catalog_generations WHERE generation=?),
  package_rows AS NOT MATERIALIZED (
    SELECT ${chunks("payload_json")} AS encoded FROM rule_catalog_packages
    WHERE generation=? AND kind=? ORDER BY package_id,version_id
  ), budget AS (
    SELECT count(*) AS count,coalesce(sum(length(CAST(encoded AS BLOB))),0)+count(*)+256+
      ${kind === "TARIFF" ? "coalesce((SELECT length(CAST(manifest_json AS BLOB))*6 FROM manifest_row),0)" : "0"} AS bytes
    FROM package_rows
  ) SELECT count,bytes,CASE WHEN count<=256 AND bytes<=? THEN ${body} ELSE NULL END AS body FROM budget`;
}
const failed = () =>
  Object.freeze(
    kinds.map((kind) =>
      Object.freeze({
        kind,
        state: "FAILED" as const,
        presence: "NULL" as const,
        body: "",
      }),
    ),
  );
/** I/O only: the already selected catalog's ORIGINAL artifact strings travel
 * to Rust. This never evaluates rules, reconstructs package objects or picks a
 * fallback. Native preflight supplies defaults/collation after reading slots. */
export function createNativeEngineCatalogReader(db: SQLiteDatabase) {
  const generation = async () =>
    (
      await db.getFirstAsync<{ active_generation: number }>(
        "SELECT active_generation FROM rule_catalog_state WHERE id='active'",
      )
    )?.active_generation ?? null;
  return {
    async collect(
      diagnosis: RuleCatalogRuntimeDiagnosis,
    ): Promise<readonly NativeRawCatalogPart[]> {
      const captured = await withImmediateTransaction(db, async (tx) => {
        const observed = await generation().catch(() => undefined);
        if (observed === undefined) return { superseded: false, parts: failed() };
        if (observed !== diagnosis.activeGeneration) return { superseded: true, parts: failed() };
        let parts: readonly NativeRawCatalogPart[];
        if (diagnosis.source !== "STORED") {
          const mode = diagnosis.source === "APP_EMBEDDED" ? "COMPILED_PREVIEW" : "COMPILED_LEGACY";
          parts = Object.freeze(
            kinds.map((kind) =>
              Object.freeze({
                kind,
                state: "READY" as const,
                presence: "VALUE" as const,
                body: JSON.stringify({ mode }),
              }),
            ),
          );
        } else {
          try {
            const selected = diagnosis.selectedGeneration;
            if (
              !Number.isSafeInteger(selected) ||
              selected === null ||
              selected < 1 ||
              observed === null ||
              selected > observed
            )
              throw new Error("CATALOG_READ_FAILED");
            const manifest = await tx.getFirstAsync<{ generation: number }>(
              "SELECT generation FROM rule_catalog_generations WHERE generation=?",
              selected,
            );
            if (!manifest) throw new Error("CATALOG_READ_FAILED");
            let remaining = MAX_BYTES;
            const collected: NativeRawCatalogPart[] = [];
            for (const kind of kinds) {
              const args = [selected, selected, kind, remaining];
              const row = await tx.getFirstAsync<EncodedPart>(partQuery(kind), ...args);
              if (
                !row ||
                !Number.isSafeInteger(row.count) ||
                row.count < 1 ||
                row.count > 256 ||
                !Number.isSafeInteger(row.bytes) ||
                row.bytes < 0 ||
                row.bytes > remaining ||
                typeof row.body !== "string"
              )
                throw new Error("CATALOG_READ_FAILED");
              remaining -= row.bytes;
              collected.push(
                Object.freeze({ kind, state: "READY", presence: "VALUE", body: row.body }),
              );
            }
            parts = Object.freeze(collected);
          } catch {
            // An atomic catalog failure does not become an unrelated preset.
            parts = failed();
          }
        }
        const after = await generation().catch(() => undefined);
        if (after === undefined) return { superseded: false, parts: failed() };
        return { superseded: after !== observed, parts };
      });
      // Never roll back an interleaved same-handle user write merely to retry.
      if (captured.superseded) throw new NativeEngineSourceReadSuperseded();
      return captured.parts;
    },
  };
}
