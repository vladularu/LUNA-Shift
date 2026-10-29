import { describe, expect, it } from "vitest";
import { calendarDesignPreviewData } from "./calendar-design-preview-data";
import { buildCalendarEntryIndex } from "@/features/calendar/calendar-entry-index";
import { createMonthGrid } from "@/engine/calendar";
import type { ShiftTemplate } from "@/domain/types";

describe("calendar design examples", () => {
  it.each(Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`))(
    "keeps every example in the visible two weeks of %s",
    (month) => {
      const examples = calendarDesignPreviewData(month, [], []);
      const visible = createMonthGrid(month)
        .slice(0, 14)
        .filter((item) => item.inMonth);
      expect(examples.entries.map((entry) => entry.date)).toEqual(visible.map((item) => item.date));
      expect(examples.entries.every((entry) => entry.kind === "SHIFT")).toBe(true);
      expect(examples.holidays.size).toBe(1);
      const [markedDate, marker] = [...examples.holidays][0];
      expect(visible.some((day) => day.date === markedDate && !day.weekend)).toBe(true);
      expect(marker.name).toContain("Beispiel");
    },
  );
  it("uses saved template colors and symbols without modifying the templates or plan", () => {
    const template: ShiftTemplate = {
      id: "mine",
      name: "Mein Frühdienst",
      type: "EARLY",
      startTime: "07:00",
      endTime: "15:00",
      breakMinutes: 30,
      color: "#7E57C2",
      symbol: "star",
      sortOrder: 1,
      revision: 4,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      deletedAt: null,
    };
    const templates = [Object.freeze(template)];
    const existing = Object.freeze(calendarDesignPreviewData("2026-08", [], []).entries);
    const before = JSON.stringify({ templates, existing });
    const examples = calendarDesignPreviewData("2026-10", templates, existing);
    expect(examples.entries.find((entry) => entry.date === "2026-10-06")).toMatchObject({
      color: template.color,
      symbol: template.symbol,
      title: "Früh",
      date: "2026-10-06",
    });
    expect(JSON.stringify({ templates, existing })).toBe(before);
    expect(examples.entries).not.toBe(existing);
    expect(examples.entries.every((entry) => entry.id.startsWith("calendar-design-example"))).toBe(
      true,
    );
  });
  it("shows realistic service blocks with rest days and deducted breaks", () => {
    const examples = calendarDesignPreviewData("2026-06", [], []);
    expect(examples.entries.map((entry) => entry.kind === "SHIFT" && entry.type)).toEqual([
      "EARLY",
      "EARLY",
      "LATE",
      "LATE",
      "NIGHT",
      "NIGHT",
      "FREE",
      "FREE",
      "EARLY",
      "EARLY",
      "LATE",
      "LATE",
      "FREE",
      "FREE",
    ]);
    let previousEnd: number | undefined;
    let workingMinutes = 0;
    for (const entry of examples.entries) {
      if (entry.kind !== "SHIFT") throw new Error("Unexpected sample appointment");
      if (entry.type === "FREE") {
        expect(entry).toMatchObject({
          allDay: true,
          startTime: null,
          endTime: null,
          breakMinutes: 0,
        });
        continue;
      }
      expect(entry).toMatchObject({ allDay: false, breakMinutes: 30 });
      const start = Date.parse(`${entry.date}T${entry.startTime}:00Z`);
      let end = Date.parse(`${entry.date}T${entry.endTime}:00Z`);
      if (end <= start) end += 24 * 60 * 60 * 1000;
      if (previousEnd !== undefined)
        expect((start - previousEnd) / (60 * 60 * 1000)).toBeGreaterThanOrEqual(16);
      workingMinutes += (end - start) / (60 * 1000) - entry.breakMinutes;
      previousEnd = end;
    }
    expect(workingMinutes).toBe(75 * 60);
  });
  it("keeps services controlled by their filter without introducing appointments", () => {
    const examples = calendarDesignPreviewData("2026-10", [], []);
    expect(
      buildCalendarEntryIndex(examples.entries, { showShifts: false, showAppointments: true })
        .entriesByDate.size,
    ).toBe(0);
    expect(
      buildCalendarEntryIndex(examples.entries, { showShifts: true, showAppointments: false })
        .entriesByDate.size,
    ).toBe(11);
    expect(
      buildCalendarEntryIndex(examples.entries, { showShifts: false, showAppointments: false })
        .entriesByDate.size,
    ).toBe(0);
  });
});
