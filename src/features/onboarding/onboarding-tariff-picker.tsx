import { useState } from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "@/ui/text";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SPACING, RADII, CONTROL_HEIGHT, CORNER_CURVE } from "@/theme/tokens";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { isTrainingTariff, type OnboardingTariffMode } from "./onboarding-tariff-values";
import { OnboardingVkaLogo } from "./onboarding-vka-logo";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import Svg, { Text as SvgText } from "react-native-svg";

const TDL = require("../../../assets/brand/lunashift/onboarding-tdl.png");
export function OnboardingTariffLogo({ mode }: { readonly mode: OnboardingTariffMode }) {
  const p = useOnboardingPalette();
  const vka = ["TVOED_P", "TVOED_E", "TVAOED_PFLEGE"].includes(mode);
  const tdl = ["TVL_KR", "TVAL_PFLEGE"].includes(mode);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.logo,
        p.dark &&
          (vka || tdl) && {
            backgroundColor: LIGHT_PALETTE.surface,
            borderRadius: RADII.small,
            padding: SPACING.xxs,
          },
      ]}
    >
      {vka ? (
        <OnboardingVkaLogo />
      ) : tdl ? (
        <Image source={TDL} style={s.tdl} resizeMode="contain" />
      ) : (
        <Svg width={82} height={36} accessible={false}>
          <SvgText
            x={0}
            y={27}
            fill={p.text}
            fontFamily="Arial"
            fontWeight="600"
            fontSize={ONBOARDING_TYPOGRAPHY.tariffWordmark.fontSize}
            letterSpacing={ONBOARDING_TYPOGRAPHY.tariffWordmark.letterSpacing}
          >
            {mode === "TVH_KR" ? "TV-H" : "TV-UK"}
          </SvgText>
        </Svg>
      )}
    </View>
  );
}
export function tariffProvider(mode: OnboardingTariffMode) {
  return ["TVOED_P", "TVOED_E", "TVAOED_PFLEGE"].includes(mode)
    ? "Arbeitgeberverband VKA"
    : ["TVL_KR", "TVAL_PFLEGE"].includes(mode)
      ? "Arbeitgeberverband TdL"
      : mode === "TVH_KR"
        ? "Hessen"
        : "Baden-Württemberg";
}
export function OnboardingTariffPicker({
  selected,
  onChange,
}: {
  readonly selected: OnboardingTariffMode | null;
  readonly onChange: (mode: OnboardingTariffMode) => void;
}) {
  const p = useOnboardingPalette();
  const { fontScale } = useWindowDimensions();
  const [training, setTraining] = useState(isTrainingTariff(selected));
  const options = SALARY_BASIS_OPTIONS.filter(
    (option) =>
      option.value !== "MANUAL" &&
      option.value !== "UNSET" &&
      isTrainingTariff(option.value) === training,
  );
  return (
    <View style={s.root}>
      <View style={s.filters}>
        {([false, true] as const).map((value) => (
          <Pressable
            key={String(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: training === value }}
            onPress={() => setTraining(value)}
            style={[
              s.filter,
              { borderColor: p.control, backgroundColor: training === value ? p.accent : p.canvas },
            ]}
          >
            <Text style={[s.filterLabel, { color: training === value ? p.onAccent : p.muted }]}>
              {value ? "Ausbildung" : "Beruf"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={s.grid}>
        {options.map((option, index) => {
          const mode = option.value as OnboardingTariffMode;
          const wide = options.length % 2 === 1 && index === options.length - 1;
          return (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityLabel={"selectionLabel" in option ? option.selectionLabel : option.label}
              accessibilityState={{ selected: selected === mode }}
              onPress={() => onChange(mode)}
              style={({ pressed }) => [
                s.card,
                wide && s.wide,
                {
                  flexBasis: fontScale > 1.3 || wide ? "100%" : "47%",
                  backgroundColor: p.surface,
                  borderColor: selected === mode ? p.accent : p.control,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <OnboardingTariffLogo mode={mode} />
              <View style={s.cardCopy}>
                <Text style={[s.title, { color: p.text }]}>{option.label}</Text>
                <Text style={[s.caption, { color: p.muted }]}>{tariffProvider(mode)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  root: { gap: SPACING.lg },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  filter: {
    paddingHorizontal: SPACING.lg,
    minHeight: CONTROL_HEIGHT.compact,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: RADII.pill,
  },
  filterLabel: ONBOARDING_TYPOGRAPHY.smallCaption,
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md },
  card: {
    flexGrow: 1,
    minHeight: 124,
    padding: SPACING.md,
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADII.card,
    borderCurve: CORNER_CURVE,
  },
  wide: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  cardCopy: { gap: SPACING.xxs, flexShrink: 1 },
  logo: { width: 82, height: 36, alignItems: "flex-start", justifyContent: "center" },
  tdl: { width: 47, height: 32 },
  wordmark: ONBOARDING_TYPOGRAPHY.tariffWordmark,
  title: ONBOARDING_TYPOGRAPHY.tariffLabel,
  caption: ONBOARDING_TYPOGRAPHY.tariffCaption,
});
