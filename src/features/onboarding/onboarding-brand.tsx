import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Defs,
  G,
  Image as SvgImage,
  LinearGradient,
  Mask,
  Rect,
  Stop,
} from "react-native-svg";
import { Text } from "@/ui/text";
import { LIGHT_PALETTE } from "@/theme/palette-values";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SPACING } from "@/theme/tokens";
import { OnboardingReveal } from "./onboarding-motion";

const LIGHT = require("../../../assets/brand/lunashift/onboarding-symbol-light.png");
const DARK = require("../../../assets/brand/lunashift/onboarding-symbol-dark.png");

export function OnboardingBrand({ reduced }: { readonly reduced: boolean }) {
  const p = useOnboardingPalette();
  const id = useId().replace(/:/g, "");
  return (
    <View style={s.root}>
      <OnboardingReveal reduced={reduced}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel="LUNA Shift"
          style={s.signature}
        >
          <View testID="onboarding-brand-symbol" style={[s.symbol, { backgroundColor: p.canvas }]}>
            <View
              testID="onboarding-brand-blend"
              style={{ mixBlendMode: p.dark ? "screen" : "multiply" }}
            >
              <Svg
                width={90}
                height={90}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Defs>
                  {(["x", "y"] as const).map((axis) => (
                    <LinearGradient
                      key={axis}
                      id={`${id}-${axis}`}
                      x1="0"
                      y1="0"
                      x2={axis === "x" ? "1" : "0"}
                      y2={axis === "y" ? "1" : "0"}
                    >
                      <Stop offset="0" stopColor={LIGHT_PALETTE.surface} stopOpacity="0" />
                      <Stop offset="0.09" stopColor={LIGHT_PALETTE.surface} stopOpacity="1" />
                      <Stop offset="0.91" stopColor={LIGHT_PALETTE.surface} stopOpacity="1" />
                      <Stop offset="1" stopColor={LIGHT_PALETTE.surface} stopOpacity="0" />
                    </LinearGradient>
                  ))}
                  {(["x", "y"] as const).map((axis) => (
                    <Mask
                      key={axis}
                      id={`${id}-mask-${axis}`}
                      x="0"
                      y="0"
                      width="90"
                      height="90"
                      maskUnits="userSpaceOnUse"
                    >
                      <Rect width="90" height="90" fill={`url(#${id}-${axis})`} />
                    </Mask>
                  ))}
                </Defs>
                <G mask={`url(#${id}-mask-x)`}>
                  <SvgImage
                    testID="onboarding-brand-image"
                    href={p.dark ? DARK : LIGHT}
                    x={-19}
                    y={-19}
                    width={128}
                    height={128}
                    mask={`url(#${id}-mask-y)`}
                  />
                </G>
              </Svg>
            </View>
          </View>
          <Text style={[s.name, { color: p.text }]}>
            <Text style={s.bold}>LUNA</Text> Shift
          </Text>
        </View>
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
  signature: { flexDirection: "row", alignItems: "center", gap: SPACING.md, minHeight: 90 },
  symbol: { width: 90, height: 90, isolation: "isolate", overflow: "hidden", flexShrink: 0 },
  name: { ...ONBOARDING_TYPOGRAPHY.brandName, flexShrink: 1 },
  bold: { fontWeight: "600" },
  slogan: { gap: 2 },
  sentence: ONBOARDING_TYPOGRAPHY.slogan,
});
