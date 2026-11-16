/** Keep the persisted Map format readable by existing app versions. */
export function encodeAnalysisCacheValue(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) => {
    if (typeof child === "number" && !Number.isFinite(child))
      throw new Error("Non-finite cache value");
    if (child instanceof Map) return { $lunaAnalysisMapV1: [...child] };
    return child;
  });
}

function restoreMaps(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = restoreMaps(value[index]);
    return value;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) record[key] = restoreMaps(record[key]);
  if (
    keys.length === 1 &&
    keys[0] === "$lunaAnalysisMapV1" &&
    Array.isArray(record.$lunaAnalysisMapV1)
  ) {
    if (!record.$lunaAnalysisMapV1.every((item) => Array.isArray(item) && item.length === 2))
      throw new Error("Invalid cached map");
    return new Map(record.$lunaAnalysisMapV1 as [unknown, unknown][]);
  }
  return record;
}

export function decodeAnalysisCacheValue(payload: string): unknown {
  // Native parsing avoids a JS reviver callback for every primitive field.
  // Walk parsed containers afterwards to restore only the existing Map format.
  return restoreMaps(JSON.parse(payload));
}
