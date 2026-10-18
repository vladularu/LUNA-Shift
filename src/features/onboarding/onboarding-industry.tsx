import { StyleSheet, View, useWindowDimensions } from "react-native";
import { INDUSTRIES, INDUSTRY_LABELS, type Industry } from "@/domain/types";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SPACING, RADII, CORNER_CURVE } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { AnimatedPressable, usePressMotion } from "@/ui/press-motion";
import { BlueprintIcon, FieldError, type BlueprintIconName } from "./onboarding-controls";
import { OnboardingReveal } from "./onboarding-motion";
import Svg, { Path } from "react-native-svg";

export function OnboardingCheck({
  color,
  size = 14,
}: {
  readonly color: string;
  readonly size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" accessible={false}>
      <Path
        d="M2 6l3 3 5-6"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function IndustryOption({
  value,
  selected,
  onPress,
  reduced,
}: {
  readonly value: Industry;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly reduced: boolean;
}) {
  const p = useOnboardingPalette();
  const { fontScale } = useWindowDimensions();
  const motion = usePressMotion(1, 0.985);
  const icon: BlueprintIconName = {
    HEALTHCARE: "heart-pulse",
    EMERGENCY_SERVICES: "ambulance",
    SOCIAL_SERVICES: "account-group-outline",
    OTHER_SHIFT_WORK: "briefcase-outline",
  }[value] as BlueprintIconName;
  return (
    <AnimatedPressable
      accessibilityRole="radio"
      accessibilityLabel={INDUSTRY_LABELS[value]}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      onPressIn={motion.onPressIn}
      onPressOut={motion.onPressOut}
      style={[
        s.option,
        {
          flexBasis: fontScale > 1.3 ? "100%" : "47%",
          backgroundColor: selected ? p.rose : p.surface,
          borderColor: selected ? p.accent : p.control,
        },
        reduced ? undefined : motion.animatedStyle,
      ]}
    >
      <View style={[s.icon, { backgroundColor: selected ? p.highlightSoft : p.canvas }]}>
        <BlueprintIcon name={icon} size={23} />
      </View>
      <Text style={[s.label, { color: p.text }]}>{INDUSTRY_LABELS[value]}</Text>
      {selected ? (
        <OnboardingReveal reduced={reduced} style={[s.check, { backgroundColor: p.highlight }]}>
          <OnboardingCheck color={p.onHighlight} />
        </OnboardingReveal>
      ) : null}
    </AnimatedPressable>
  );
}
export function OnboardingIndustry({
  value,
  onChange,
  error,
  reduced,
}: {
  readonly value: Industry | null;
  readonly onChange: (value: Industry) => void;
  readonly error?: string;
  readonly reduced: boolean;
}) {
  return (
    <View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Berufsbereich" style={s.grid}>
        {INDUSTRIES.map((industry) => (
          <IndustryOption
            key={industry}
            value={industry}
            selected={value === industry}
            onPress={() => onChange(industry)}
            reduced={reduced}
          />
        ))}
      </View>
      <FieldError message={error} />
    </View>
  );
}
const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md },
  option: {
    flexGrow: 1,
    minHeight: 112,
    padding: SPACING.md,
    gap: SPACING.md,
    borderWidth: 1,
    borderRadius: RADII.card,
    borderCurve: CORNER_CURVE,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: RADII.control,
    alignItems: "center",
    justifyContent: "center",
  },
  label: ONBOARDING_TYPOGRAPHY.optionLabel,
  check: {
    position: "absolute",
    top: SPACING.md,
    right: SPACING.md,
    width: 20,
    height: 20,
    borderRadius: RADII.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
