import { Image } from "react-native";
import { SvgUri } from "react-native-svg";
import { Text } from "@/ui/text";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";

const LOGO = require("../../../assets/brand/lunashift/onboarding-vka.svg");
const ignoreLogoError = () => undefined;

export function OnboardingVkaLogo() {
  const p = useOnboardingPalette();
  return (
    <SvgUri
      uri={Image.resolveAssetSource(LOGO).uri}
      width={75}
      height={24}
      accessible={false}
      onError={ignoreLogoError}
      fallback={<Text style={[ONBOARDING_TYPOGRAPHY.tariffLabel, { color: p.text }]}>VKA</Text>}
    />
  );
}
