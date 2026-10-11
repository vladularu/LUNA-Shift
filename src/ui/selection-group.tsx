import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { SPACING } from "@/theme/tokens";
import { SectionHeader } from "@/ui/design-system";

export function SelectionGroup({
  title,
  testID,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly testID?: string;
}>) {
  return (
    <View testID={testID} style={{ gap: SPACING.sm }}>
      <View accessible accessibilityRole="header">
        <SectionHeader title={title} />
      </View>
      {children}
    </View>
  );
}
