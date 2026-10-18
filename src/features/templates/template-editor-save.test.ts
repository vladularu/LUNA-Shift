import { describe, expect, it, vi } from "vitest";

import type { SaveShiftTemplateInput, ShiftEntry, ShiftTemplate } from "@/domain/types";
import {
  saveTemplateWithOptionalCalendarEntry,
  type TemplateEditorSaveProgress,
} from "@/features/templates/template-editor-save";

const template: ShiftTemplate = {
  id: "early",
  name: "Früh",
  type: "EARLY",
  allDay: false,
  startTime: "06:00",
  endTime: "14:12",
  breakMinutes: 30,
  color: "#7C4DCC",
  symbol: "F",
  notification: { amount: 30, unit: "MINUTE", direction: "BEFORE", reference: "START" },
  location: { name: "Heppenheim", latitude: 49.64, longitude: 8.64 },
  sortOrder: 10,
  revision: 1,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
  deletedAt: null,
};

const input: SaveShiftTemplateInput = {
  name: template.name,
  type: template.type,
  allDay: template.allDay,
  startTime: template.startTime,
  endTime: template.endTime,
  breakMinutes: template.breakMinutes,
  color: template.color,
  symbol: template.symbol,
  notification: template.notification,
  location: template.location,
  sortOrder: template.sortOrder,
};

function entry(): ShiftEntry {
  return {
    kind: "SHIFT",
    id: "shift-early",
    date: "2026-08-15",
    templateId: template.id,
    title: template.name,
    type: template.type,
    allDay: false,
    startTime: template.startTime,
    endTime: template.endTime,
    breakMinutes: template.breakMinutes,
    color: template.color,
    symbol: template.symbol,
    notification: null,
    location: null,
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("template editor quick-entry completion", () => {
  it("saves the template and applies it to the selected calendar day", async () => {
    const upsertTemplate = vi.fn(async () => template);
    const upsertShift = vi.fn(async () => entry());

    await saveTemplateWithOptionalCalendarEntry({
      entries: [],
      input,
      quickEntryDate: "2026-08-15",
      upsertShift,
      upsertTemplate,
    });

    expect(upsertTemplate).toHaveBeenCalledWith(input);
    expect(upsertShift).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-08-15",
        templateId: "early",
        title: "Früh",
        location: template.location,
        notification: template.notification,
      }),
    );
  });

  it("does not duplicate a service that is already assigned to the day", async () => {
    const upsertShift = vi.fn(async () => entry());

    await saveTemplateWithOptionalCalendarEntry({
      entries: [entry()],
      input,
      quickEntryDate: "2026-08-15",
      upsertShift,
      upsertTemplate: vi.fn(async () => template),
    });

    expect(upsertShift).not.toHaveBeenCalled();
  });

  it("only saves an existing template even when an old link includes a calendar date", async () => {
    const upsertShift = vi.fn(async () => entry());
    const upsertTemplate = vi.fn(async () => template);
    const editInput = { ...input, id: template.id, expectedRevision: template.revision };

    await saveTemplateWithOptionalCalendarEntry({
      entries: [],
      input: editInput,
      quickEntryDate: "2026-08-15",
      upsertShift,
      upsertTemplate,
    });

    expect(upsertTemplate).toHaveBeenCalledWith(editInput);
    expect(upsertShift).not.toHaveBeenCalled();
  });

  it("retries the pending calendar insertion without creating the new template again", async () => {
    let previousSave: TemplateEditorSaveProgress | null = null;
    const upsertTemplate = vi.fn(async () => template);
    const upsertShift = vi.fn<() => Promise<ShiftEntry>>();
    upsertShift.mockRejectedValueOnce(new Error("Temporary write failure"));
    upsertShift.mockResolvedValueOnce(entry());
    const save = () =>
      saveTemplateWithOptionalCalendarEntry({
        entries: [],
        input,
        quickEntryDate: "2026-08-15",
        upsertShift,
        upsertTemplate,
        previousSave,
        onTemplateSaved: (progress) => {
          previousSave = progress;
        },
      });

    await expect(save()).rejects.toThrow("Temporary write failure");
    await save();

    expect(upsertTemplate).toHaveBeenCalledTimes(1);
    expect(upsertShift).toHaveBeenCalledTimes(2);
    expect(upsertShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: "2026-08-15", templateId: template.id }),
    );
  });

  it("updates the same new template when its fields change before retrying insertion", async () => {
    const changedInput = { ...input, name: "Früh geändert" };
    const upsertTemplate = vi.fn(async () => ({
      ...template,
      name: changedInput.name,
      revision: 2,
    }));
    const upsertShift = vi.fn(async () => entry());

    await saveTemplateWithOptionalCalendarEntry({
      entries: [],
      input: changedInput,
      quickEntryDate: "2026-08-15",
      previousSave: { input, template },
      upsertShift,
      upsertTemplate,
    });

    expect(upsertTemplate).toHaveBeenCalledWith({
      ...changedInput,
      id: template.id,
      expectedRevision: template.revision,
    });
    expect(upsertShift).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: template.id, title: "Früh geändert" }),
    );
  });
});
