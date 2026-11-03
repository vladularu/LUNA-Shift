import { Image, StyleSheet, View } from "react-native";
import { Text } from "@/ui/text";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SPACING } from "@/theme/tokens";
import { OnboardingReveal } from "./onboarding-motion";

const LIGHT = require("../../../assets/brand/lunashift/logo-horizontal-light.png");
const DARK = require("../../../assets/brand/lunashift/logo-horizontal-dark.png");

export function OnboardingBrand({ reduced }: { readonly reduced: boolean }) {
  const p = useOnboardingPalette();
  return (
    <View style={s.root}>
      <OnboardingReveal reduced={reduced}>
        <Image
          testID="onboarding-brand-image"
          accessible
          accessibilityRole="image"
          accessibilityLabel="LUNA Shift"
          source={p.dark ? DARK : LIGHT}
          resizeMode="contain"
          style={s.signature}
        />
      </OnboardingReveal>
      <View style={s.slogan}>
        <OnboardingReveal reduced={reduced} delay={40}>
          <Text style={[s.sentence, { color: p.muted }]}>Schichtdienst ist kompliziert genug.</Text>
        </OnboardingReveal>
        <OnboardingReveal reduced={reduced} delay={90}>
          <Text style={[s.sentence, s.bold, { color: p.text }]}>
            Dein Dienstplan sollte es nicht sein.
          </Text>
        </OnboardingReveal>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  root: { gap: SPACING.lg },
  signature: { width: "100%", maxWidth: 360, height: 90 },
  bold: { fontWeight: "600" },
  slogan: { gap: 2 },
  sentence: ONBOARDING_TYPOGRAPHY.slogan,
});
