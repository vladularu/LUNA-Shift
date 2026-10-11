export function entryEditorScreenOptions(platform: string, backgroundColor: string) {
  if (platform === "ios") {
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
