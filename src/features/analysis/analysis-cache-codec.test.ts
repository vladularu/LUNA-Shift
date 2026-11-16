import { describe, expect, it } from "vitest";
import { decodeAnalysisCacheValue, encodeAnalysisCacheValue } from "./analysis-cache-codec";

function legacyDecode(payload: string): unknown {
  return JSON.parse(payload, (_key, child: unknown) => {
    if (
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      "$lunaAnalysisMapV1" in child &&
      Object.keys(child).length === 1 &&
      Array.isArray(child.$lunaAnalysisMapV1)
    ) {
      if (
        !child.$lunaAnalysisMapV1.every((item: unknown) => Array.isArray(item) && item.length === 2)
      )
        throw new Error("Invalid cached map");
      return new Map(child.$lunaAnalysisMapV1);
    }
    return child;
  });
}

describe("analysis cache codec compatibility", () => {
  it.each([null, true, 0, "Text", [], {}, { empty: new Map() }])(
    "keeps scalar and empty values compatible: %j",
    (value) => {
      const payload = encodeAnalysisCacheValue(value);
      expect(decodeAnalysisCacheValue(payload)).toEqual(value);
      expect(decodeAnalysisCacheValue(payload)).toEqual(legacyDecode(payload));
    },
  );

  it("restores nested Maps in keys, values and arrays without changing persisted bytes", () => {
    const value = {
      daily: new Map([
        ["2026-10-01", { minutes: 480, evidence: new Map([["source", [1, null, true]]]) }],
      ]),
      keys: [new Map([[new Map([["id", 1]]), new Map([["result", false]])]])],
    };
    const payload = encodeAnalysisCacheValue(value);
    const restored = decodeAnalysisCacheValue(payload);
    expect(restored).toEqual(value);
    expect(restored).toEqual(legacyDecode(payload));
    expect(encodeAnalysisCacheValue(restored)).toBe(payload);
    expect(value.daily.get("2026-10-01")?.evidence).toBeInstanceOf(Map);
  });

  it.each([
    '{"$lunaAnalysisMapV1":[[1]]}',
    '{"$lunaAnalysisMapV1":[[1,2,3]]}',
    '{"$lunaAnalysisMapV1":[null]}',
    '{"$lunaAnalysisMapV1":[{}]}',
    '{"inside":{"$lunaAnalysisMapV1":["bad"]}}',
    '{"$lunaAnalysisMapV1":[[{"$lunaAnalysisMapV1":[[1]]},2]]}',
  ])("rejects malformed Map entries: %s", (payload) => {
    expect(() => legacyDecode(payload)).toThrow("Invalid cached map");
    expect(() => decodeAnalysisCacheValue(payload)).toThrow("Invalid cached map");
  });

  it.each([
    '{"$lunaAnalysisMapV1":null}',
    '{"$lunaAnalysisMapV1":"ordinary text"}',
    '{"$lunaAnalysisMapV1":[["key",1]],"other":true}',
  ])("preserves non-wrapper objects for the existing domain validator: %s", (payload) => {
    expect(decodeAnalysisCacheValue(payload)).toEqual(legacyDecode(payload));
  });

  it("keeps prototype-named JSON fields as own data properties", () => {
    const payload =
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"nested":1}},"map":{"$lunaAnalysisMapV1":[["__proto__",2]]}}';
    const restored = decodeAnalysisCacheValue(payload) as Record<string, unknown>;
    expect(restored).toEqual(legacyDecode(payload));
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.hasOwn(restored, "__proto__")).toBe(true);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(encodeAnalysisCacheValue(restored)).toBe(payload);
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite values on write: %s", (value) => {
    expect(() => encodeAnalysisCacheValue({ nested: new Map([["value", value]]) })).toThrow(
      "Non-finite cache value",
    );
  });

  it("rejects broken JSON and returns independent objects for separate decodes", () => {
    expect(() => decodeAnalysisCacheValue("{broken")).toThrow();
    const payload = '{"map":{"$lunaAnalysisMapV1":[["key",{"minutes":480}]]}}';
    const first = decodeAnalysisCacheValue(payload) as { map: Map<string, { minutes: number }> };
    first.map.get("key")!.minutes = 0;
    expect(decodeAnalysisCacheValue(payload)).toEqual(legacyDecode(payload));
  });
});
