import { router } from "expo-router";
import { Text, View } from "react-native";
import type { ComplianceIssue } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";

const QUESTIONS: Readonly<Record<string, string>> = {
  ARBZG_DATA_ALL_EMPLOYMENT: "work",
  ARBZG_6_NIGHT_STATUS_UNKNOWN: "night",
  ARBZG_10_ELIGIBILITY: "sunday",
  HOLIDAY_REGION_UNKNOWN: "region",
};

export function CheckPrerequisitesCard({
  issues,
}: {
  readonly issues?: readonly ComplianceIssue[];
}) {
  const palette = usePalette();
  const questions = issues
    ? [...new Set(issues.map((issue) => QUESTIONS[issue.rule]).filter(Boolean))].join(",")
    : undefined;
  return (
    <SurfaceCard style={{ padding: SPACING.lg }}>
      <View style={{ gap: SPACING.md }}>
        <Text
          accessibilityRole="header"
          style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
        >
          Prüfung eingeschränkt
        </Text>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>
          Mit wenigen Angaben können wir deine Dienste genauer prüfen.
        </Text>
        <SecondaryButton
          onPress={() =>
            router.push({ pathname: "/check-profile", params: questions ? { questions } : {} })
          }
        >
          Angaben ergänzen
        </SecondaryButton>
      </View>
    </SurfaceCard>
  );
}
