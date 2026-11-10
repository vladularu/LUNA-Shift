import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import type { ComplianceIssue } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { legalCheckPresentation } from "./legal-check-presentation";

export function LegalCheckDetails({
  issue,
  title,
  missing,
  children,
  embedded = false,
}: {
  readonly issue: ComplianceIssue;
  readonly title: string;
  readonly missing: boolean;
  readonly children?: ReactNode;
  readonly embedded?: boolean;
}) {
  const palette = usePalette();
  const presentation = legalCheckPresentation(issue);
  const heading = { color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" as const };
  const body = { color: palette.textMuted, ...TYPOGRAPHY.small };
  return (
    <View
      testID="legal-check-detail-content"
      style={{
        paddingHorizontal: embedded ? 0 : SPACING.lg,
        paddingVertical: SPACING.sm,
        gap: SPACING.md,
      }}
    >
      <Text style={{ color: palette.text, ...TYPOGRAPHY.body, fontWeight: "500" }}>{title}</Text>
      {children}
      <View style={{ gap: SPACING.sm }}>
        <Text style={heading}>Einordnung und Prüfmaßstab</Text>
        <Text style={body}>{issue.description}</Text>
        <Text style={body}>
          Die Prüfung berücksichtigt die erfassten Zeiten und die unterstützten Regeln. Persönliche,
          tarifliche oder betriebliche Ausnahmen können eine gesonderte Einordnung erfordern.
        </Text>
      </View>
      {missing ? (
        <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
      ) : null}
      {presentation.sources.length ? (
        <View style={{ gap: SPACING.sm }}>
          <Text style={heading}>Rechtsgrundlage</Text>
          {presentation.sources.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              accessibilityLabel={source.title}
              onPress={() => {
                void Linking.openURL(source.url).catch(() =>
                  Alert.alert("Link nicht geöffnet", "Du kannst die Quelle später erneut öffnen."),
                );
              }}
              style={{ minHeight: MINIMUM_TOUCH_TARGET, justifyContent: "center" }}
            >
              <Text style={body}>{source.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={body}>
          Für diesen Prüfpunkt ist keine konkrete Rechtsquelle hinterlegt. Maßgeblich ist zunächst
          die Klärung der erfassten Angaben.
        </Text>
      )}
    </View>
  );
}
