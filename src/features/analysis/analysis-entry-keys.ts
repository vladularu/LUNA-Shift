import type { CalendarEntry } from "@/domain/types";

/** Exact contents once per key, with positional references for repeated assessment windows. */
export function createAnalysisEntryKeys() {
  const seen = new WeakMap<CalendarEntry, number>();
  const contents: CalendarEntry[] = [];
  return {
    entries(entries: readonly CalendarEntry[]) {
      return entries.map((entry) => {
        const previous = seen.get(entry);
        if (previous !== undefined) return previous;
        const index = contents.length;
        contents.push(entry);
        seen.set(entry, index);
        return index;
      });
    },
    stringify(fields: readonly unknown[]) {
      return JSON.stringify([fields, contents]);
    },
  };
}
