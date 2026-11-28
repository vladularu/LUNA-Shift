import { describe, expect, it } from "vitest";
import { EMPTY_ABSENCE_PAY, validateAbsencePay } from "@/domain/absence-pay";
import { listCalendarEntries, saveShift } from "./calendar-entry-repository";
import { restoreLocalBackup } from "./local-backup-restore";
import {
  setupTvlShiftWork,
  exportTvlBackup,
  validateTvlBackup,
} from "./tvl-shift-work-test-fixtures";

describe("§ 21 Abwesenheitsangaben", () => {
  it("erhält einen bestätigten Nullsatz nach Sicherung und Wiederherstellung und löscht die Zuordnung beim Typwechsel", async () => {
    const source = await setupTvlShiftWork();
    const target = await setupTvlShiftWork();
    try {
      const facts = { ...EMPTY_ABSENCE_PAY, day: "PAID" as const, dailyRateCents: 0 };
      const entry = await saveShift(source.db, {
        ...source.shift,
        expectedRevision: source.shift.revision,
        type: "SICK",
        allDay: true,
        startTime: null,
        endTime: null,
        breakMinutes: 0,
        absencePay: facts,
      });
      const file = await exportTvlBackup(source);
      await restoreLocalBackup(target.db, await validateTvlBackup(file.serialized));
      expect(
        (await listCalendarEntries(target.db)).find((row) => row.id === entry.id),
      ).toMatchObject({ absencePay: facts });
      const changed = await saveShift(target.db, {
        ...source.shift,
        expectedRevision: entry.revision,
        absencePay: undefined,
      });
      expect(changed.absencePay).toBeUndefined();
    } finally {
      source.adapter.database.close();
      target.adapter.database.close();
    }
  });
  it("verwirft unpassende Tage und künftige Ereignisbeginne", () => {
    expect(() => validateAbsencePay(EMPTY_ABSENCE_PAY, "FREE", "2026-09-01")).toThrow();
    expect(() =>
      validateAbsencePay({ ...EMPTY_ABSENCE_PAY, eventStart: "2026-09-02" }, "SICK", "2026-09-01"),
    ).toThrow();
  });
});
