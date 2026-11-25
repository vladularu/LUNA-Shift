import { describe, expect, it } from "vitest";

import { entryEditorScreenOptions } from "@/features/day-editor/entry-edit-presentation";

describe("entry editor presentation", () => {
  it("opens the native iOS sheet at a compact detent with room to expand", () => {
    const options = entryEditorScreenOptions("ios", "#151517");
    expect(options).toMatchObject({
      presentation: "formSheet",
      sheetAllowedDetents: [0.68, 1],
      sheetInitialDetentIndex: 0,
      sheetGrabberVisible: true,
      sheetExpandsWhenScrolledToEdge: false,
      gestureEnabled: true,
      contentStyle: { backgroundColor: "#151517" },
    });
    expect(options.animation).toBeUndefined();
  });

  it.each(["android", "web"])(
    "retains the custom %s host without a second native animation",
    (platform) => {
      expect(entryEditorScreenOptions(platform, "#f3f3f6")).toMatchObject({
        presentation: "transparentModal",
        animation: "none",
        gestureEnabled: false,
        contentStyle: { backgroundColor: "transparent" },
      });
    },
  );

  it("reserves the transparent iPhone host for an existing own shift", () => {
    const saved = { mode: "SHIFT", entryId: "shift-1" };
    expect(entryEditorScreenOptions("ios", "#151517", saved).presentation).toBe("transparentModal");
    expect(
      entryEditorScreenOptions("ios", "#151517", { ...saved, focus: "BILLING" }).presentation,
    ).toBe("formSheet");
    expect(
      entryEditorScreenOptions("ios", "#151517", { ...saved, sharedCalendarId: "calendar-1" })
        .presentation,
    ).toBe("formSheet");
  });

  it("uses the transparent iPhone host for both saved and new appointments", () => {
    const appointment = { mode: "APPOINTMENT", entryId: "appointment-1" };
    expect(entryEditorScreenOptions("ios", "#151517", appointment).presentation).toBe(
      "transparentModal",
    );
    expect(entryEditorScreenOptions("ios", "#151517", { mode: "APPOINTMENT" }).presentation).toBe(
      "transparentModal",
    );
    expect(entryEditorScreenOptions("ios", "#151517", { mode: "SHIFT" }).presentation).toBe(
      "formSheet",
    );
  });
});
