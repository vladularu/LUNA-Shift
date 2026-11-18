import { nativeSheetScrollEdgeOptions } from "@/ui/native-sheet-scroll-edge";

/** Native sheet presentation for the Schichtzulage route. */
export function analysisSheetOptions() {
  return {
    ...nativeSheetScrollEdgeOptions(),
    presentation: "formSheet" as const,
    contentStyle: { backgroundColor: "transparent" },
    sheetAllowedDetents: [1],
    sheetGrabberVisible: true,
  };
}
