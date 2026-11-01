import { formatMonthTitle } from "@/engine/calendar";
import { View } from "react-native";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { NetPayWorkflowSelect, NetPayWorkflowText } from "./net-pay-workflow-controls";

export function NetPayValidity({
  month,
  firstSetup,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  readonly month: string;
  readonly firstSetup: boolean;
  readonly value: string;
  readonly onChange: (month: string) => void;
  readonly disabled: boolean;
  readonly compact?: boolean;
}) {
  const palette = usePalette();
  const year = month.slice(0, 4);
  if (firstSetup)
    return compact ? (
      <View style={{ padding: SPACING.lg, gap: SPACING.xs }}>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>Gültigkeit</Text>
        <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>Für das ganze Jahr {year}</Text>
      </View>
    ) : (
      <NetPayWorkflowText>Für das ganze Jahr {year}</NetPayWorkflowText>
    );
  const options = Array.from({ length: 12 }, (_, index) => {
    const value = year + "-" + String(index + 1).padStart(2, "0");
    return { value, label: formatMonthTitle(value) };
  });
  return (
    <NetPayWorkflowSelect
      label="Gültig ab"
      compact={compact}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
