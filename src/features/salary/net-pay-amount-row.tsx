import { View } from "react-native";
import { SPACING } from "@/theme/tokens";
import { SalaryAmountRow } from "./salary-ui";

export function NetPayAmountRow({
  label,
  value,
  onPress,
  expanded,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPress?: () => void;
  readonly expanded?: boolean;
}) {
  return (
    <View style={{ marginHorizontal: -SPACING.lg }}>
      <SalaryAmountRow label={label} value={value} onPress={onPress} expanded={expanded} />
    </View>
  );
}
