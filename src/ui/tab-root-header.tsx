import type { ReactNode } from "react";
import { TabScreenHeader, type ScreenSurface } from "@/ui/screen-layout";

import { SPACING } from "@/theme/tokens";
import { SoftScrollAnchor } from "@/ui/soft-scroll-layout";

export function TabRootHeader({
  accessory,
  surface = "background",
  title,
}: {
  readonly accessory?: ReactNode;
  readonly surface?: ScreenSurface;
  readonly title: string;
}) {
  return (
    <SoftScrollAnchor extendBelow={SPACING.xl}>
      <TabScreenHeader accessory={accessory} surface={surface} title={title} />
    </SoftScrollAnchor>
  );
}
