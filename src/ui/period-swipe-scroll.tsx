import { createContext, useContext, type ReactElement } from "react";
import { GestureDetector, type Gesture } from "react-native-gesture-handler";

export const PeriodSwipeScrollContext = createContext<ReturnType<typeof Gesture.Native> | null>(
  null,
);

/** Only reports inside a period pager participate in its native gesture relation. */
export function PeriodSwipeScroll({ children }: { readonly children: ReactElement }) {
  const gesture = useContext(PeriodSwipeScrollContext);
  return gesture ? <GestureDetector gesture={gesture}>{children}</GestureDetector> : children;
}
