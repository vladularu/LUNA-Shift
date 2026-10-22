import { useLayoutEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
/** Keep the complete previous page while the requested month's data is prepared. */
export function AnalysisMonthTransition({
  month,
  ready,
  available,
  header,
  children,
}: {
  readonly month: string;
  readonly ready: boolean;
  readonly available: boolean;
  readonly header: (visibleMonth: string) => ReactNode;
  readonly children: ReactNode;
}) {
  const [page, setPage] = useState({ month, children });
  useLayoutEffect(() => {
    if (!ready && !(available && page.month === month)) return;
    setPage((current) =>
      current.month === month && current.children === children
        ? current
        : {
            month,
            children,
          },
    );
  }, [available, children, month, page.month, ready]);

  return (
    <View
      style={{ flex: 1, overflow: "hidden" }}
      accessibilityState={{ busy: page.month !== month }}
    >
      <View key={page.month} style={{ flex: 1 }} testID={`analysis-month-page-${page.month}`}>
        {header(page.month)}
        {page.children}
      </View>
    </View>
  );
}
