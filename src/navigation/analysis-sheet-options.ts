/** Shared by Schichtzulage and individual Dienstplan-Check details. */
export function analysisSheetOptions() {
  return {
    presentation: "formSheet" as const,
    contentStyle: { backgroundColor: "transparent" },
    sheetAllowedDetents: [1],
    sheetGrabberVisible: true,
  };
}
