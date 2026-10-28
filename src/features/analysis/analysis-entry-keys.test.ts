import { describe, expect, it } from "vitest";
import { forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { createAnalysisEntryKeys } from "./analysis-entry-keys";

const key = (entries: readonly ReturnType<typeof forecastShift>[], repeats = entries) => {
  const contents = createAnalysisEntryKeys();
  return contents.stringify([contents.entries(entries), contents.entries(repeats)]);
};

describe("exact shared entry contents in analysis keys", () => {
  it("matches independently loaded contents while retaining duplicate counts and ordering", () => {
    const first = forecastShift({ id: "first" }),
      second = forecastShift({ id: "second" });
    const entries = [first, second, first];
    expect(key(entries)).toBe(key(structuredClone(entries)));
    expect(key(entries)).not.toBe(key([first, second]));
    expect(key(entries)).not.toBe(key([second, first, first]));
    expect(key(entries, [first])).not.toBe(key(entries, [second]));
  });
  it("detects content edits with the same revision and object identity on the next request", () => {
    const shift = forecastShift();
    const before = key([shift]);
    Object.assign(shift, { endTime: "09:30" });
    expect(key([shift])).not.toBe(before);
    expect(Object.isFrozen(shift)).toBe(false);
  });
  it("keeps delimiters and escaped text unambiguous without probabilistic hashes", () => {
    const first = forecastShift({ note: 'a],["b"' });
    const second = { ...first, note: 'a],["b" ' };
    expect(key([first])).not.toBe(key([second]));
    const contents = createAnalysisEntryKeys();
    const refs = contents.entries([first]);
    expect(contents.stringify([refs, "profile-a"])).not.toBe(
      contents.stringify([refs, "profile-b"]),
    );
  });
  it("has stable keys beyond bounded result-cache sizes and after unrelated requests", () => {
    const entries = Array.from({ length: 9000 }, (_, i) => forecastShift({ id: `large-${i}` }));
    const before = key(entries);
    key([forecastShift({ id: "unrelated" })]);
    expect(key(structuredClone(entries))).toBe(before);
  });
});
