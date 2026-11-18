import { nativeSheetScrollEdgeOptions } from "@/ui/native-sheet-scroll-edge";

/** Shared by Schichtzulage and individual Dienstplan-Check details. */
export function analysisSheetOptions() {
  return {
    ...nativeSheetScrollEdgeOptions(),
    presentation: "formSheet" as const,
    contentStyle: { backgroundColor: "transparent" },
    sheetAllowedDetents: [1],
    sheetGrabberVisible: true,
  };
}
