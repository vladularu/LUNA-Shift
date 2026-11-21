import { it, expect } from "vitest";
import { TariffAnnualTestDatabase } from "@/infrastructure/database/tariff-annual-test-database";
import { saveShift } from "@/infrastructure/database/calendar-entry-repository";
import { work, shift } from "@/engine/remuneration-test-fixtures";
import { createStoredMonthlyRustInputReader } from "./monthly-rust-source";

it("prepares the loaded calendar window while rejecting changed revisions inside it", async () => {
  const adapter = new TariffAnnualTestDatabase();
  try {
    await adapter.setup();
    const read = createStoredMonthlyRustInputReader(adapter.db, {
      source: "APP_EMBEDDED",
      activeGeneration: null,
      selectedGeneration: null,
      keyId: null,
      fallbackReason: null,
    });
    const current = await saveShift(adapter.db, {
      ...shift({ date: "2026-11-20" }),
      id: undefined,
    });
    const request = { entries: [current], profile: work };
    const initial = await read(request);
    expect(initial.sources.CALENDAR_ENTRIES).toMatchObject({ shiftRows: [{ id: current.id }] });
    await saveShift(adapter.db, { ...shift({ date: "2020-01-10" }), id: undefined });
    expect((await read(request)).sources.CALENDAR_ENTRIES).toEqual(
      initial.sources.CALENDAR_ENTRIES,
    );
    await saveShift(adapter.db, {
      ...current,
      expectedRevision: current.revision,
      endTime: "04:00",
    });
    await expect(read(request)).rejects.toThrow("RUST_MONTH_INPUT_CHANGED");
  } finally {
    adapter.database.close();
  }
});
