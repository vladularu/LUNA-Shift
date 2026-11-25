export function usesEntryOverviewSheet(params?: object, mode?: "SHIFT" | "APPOINTMENT"): boolean {
  return (
    params !== undefined &&
    "mode" in params &&
    (params.mode === "SHIFT" || params.mode === "APPOINTMENT") &&
    (mode === undefined || params.mode === mode) &&
    ("entryId" in params
      ? typeof params.entryId === "string" && params.entryId.length > 0
      : params.mode === "APPOINTMENT") &&
    !("sharedCalendarId" in params) &&
    !("focus" in params)
  );
}

export function entryEditorScreenOptions(
  platform: string,
  backgroundColor: string,
  params?: object,
) {
  if (platform === "ios" && !usesEntryOverviewSheet(params)) {
    return {
      headerShown: false,
      presentation: "formSheet" as const,
      sheetAllowedDetents: [0.68, 1],
      sheetInitialDetentIndex: 0,
      sheetGrabberVisible: true,
      // Scroll the fields without expanding the sheet; use the grabber to expand it.
      sheetExpandsWhenScrolledToEdge: false,
      gestureEnabled: true,
      contentStyle: { backgroundColor },
    };
  }
  return {
    headerShown: false,
    presentation: "transparentModal" as const,
    animation: "none" as const,
    gestureEnabled: false,
    contentStyle: { backgroundColor: "transparent" },
  };
}
