import type { RefObject } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Text, TextInput } from "@/ui/text";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SPACING, CONTROL_HEIGHT } from "@/theme/tokens";
import { FieldError } from "./onboarding-controls";
import { PercentageSlider, weeklyPercentage } from "./percentage-slider";

export function OnboardingWorkTime({
  hours,
  basis,
  onHoursChange,
  onBasisChange,
  onInteractionChange,
  inputRef,
  error,
}: {
  readonly hours: string;
  readonly basis: number;
  readonly onHoursChange: (value: string) => void;
  readonly onBasisChange: (value: number) => void;
  readonly onInteractionChange: (active: boolean) => void;
  readonly inputRef: RefObject<TextInput | null>;
  readonly error?: string;
}) {
  const p = useOnboardingPalette();
  const { width, fontScale } = useWindowDimensions();
  const percentage = weeklyPercentage(hours, basis);
  return (
    <View style={s.root}>
      <Text testID="onboarding-percentage-value" style={[s.percentage, { color: p.text }]}>
        {percentage == null ? "–" : Number(percentage.toFixed(1)).toLocaleString("de-DE")} %
      </Text>
      <View style={s.hoursRow}>
        <TextInput
          ref={inputRef}
          testID="onboarding-weekly-hours"
          accessibilityLabel="Wochenstunden"
          accessibilityHint={error}
          aria-invalid={Boolean(error)}
          keyboardType="decimal-pad"
          returnKeyType="done"
          value={hours}
          onChangeText={onHoursChange}
          placeholder="38,5"
          placeholderTextColor={p.muted}
          style={[
            s.hours,
            {
              width: Math.max(84, Math.min(width - SPACING.xl * 2, 84 * fontScale)),
              color: p.text,
              borderColor: error ? p.error : p.control,
            },
          ]}
        />
        <Text style={[s.unit, { color: p.muted }]}>Stunden pro Woche</Text>
      </View>
      <FieldError message={error} />
      <PercentageSlider
        weeklyHours={hours}
        basis={basis}
        onBasisChange={onBasisChange}
        onHoursChange={onHoursChange}
        onInteractionChange={onInteractionChange}
        showValue={false}
      />
    </View>
  );
}
const s = StyleSheet.create({
  root: { gap: SPACING.sm },
  percentage: {
    ...ONBOARDING_TYPOGRAPHY.percentage,
  },
  hoursRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING.sm },
  hours: {
    width: 84,
    minHeight: CONTROL_HEIGHT.compact,
    ...ONBOARDING_TYPOGRAPHY.hours,
    borderBottomWidth: 1,
    paddingVertical: SPACING.xxs,
  },
  unit: ONBOARDING_TYPOGRAPHY.hoursUnit,
});
