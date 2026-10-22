import { useLayoutEffect, useState, type ReactNode } from "react";

/** Keep the actual previous screen visible underneath the native interactive pop. */
export function AnalysisScene({
  focused,
  children,
}: {
  readonly focused: boolean;
  readonly children: ReactNode;
}) {
  const [visible, setVisible] = useState(children);
  useLayoutEffect(() => {
    if (focused) setVisible(children);
  }, [children, focused]);
  return visible;
}
