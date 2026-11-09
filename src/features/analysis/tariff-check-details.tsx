import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import { isTariffSourceUrl, TARIFF_SCOPE_SOURCE } from "@/domain/tariff-time-policy";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { CheckDetailDisclosure } from "./check-detail-disclosure";
import { tariffCheckPresentation } from "./tariff-check-presentation";

export function tariffCheckStatus(status: TariffComplianceEvidence["status"]): string {
  switch (status) {
    case "REVIEW":
      return "Tarifhinweis";
    case "PENDING":
      return "Geplant oder noch laufend";
    case "UNAVAILABLE":
      return "Tarifprüfung eingeschränkt";
    case "DEVIATION":
      return "Abweichung erkannt";
  }
}

const dateLabel = (date: string) => date.split("-").reverse().join(".");

export function TariffCheckDetails({
  evidence,
  title,
  description,
  missing,
  children,
  embedded = false,
  hideServices = false,
}: {
  readonly evidence: TariffComplianceEvidence;
  readonly title: string;
  readonly description: string;
  readonly missing: boolean;
  readonly children: ReactNode;
  readonly embedded?: boolean;
  readonly hideServices?: boolean;
}) {
  const palette = usePalette();
  const heading = { color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" as const };
  const body = { color: palette.textMuted, ...TYPOGRAPHY.body };
  const scopeOnly = evidence.source.url === TARIFF_SCOPE_SOURCE.url;
  const presentation = tariffCheckPresentation(evidence, title, description);
  const period = `${dateLabel(evidence.period.from).slice(0, evidence.period.from.slice(0, 4) === evidence.period.until.slice(0, 4) ? 6 : undefined)}–${dateLabel(evidence.period.until)}`;
  const source = (
    <View style={{ gap: SPACING.xs }}>
      <Text style={{ color: palette.text, ...TYPOGRAPHY.small }}>{evidence.source.title}</Text>
      <Text style={body}>{evidence.source.section}</Text>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
        Fassung: {evidence.source.version}
      </Text>
    </View>
  );

  return (
    <View
      testID="tariff-check-detail-content"
      style={{
        paddingHorizontal: embedded ? 0 : SPACING.lg,
        paddingVertical: SPACING.sm,
        gap: SPACING.md,
      }}
    >
      <Text style={{ color: palette.text, ...TYPOGRAPHY.body, fontWeight: "500" }}>
        {presentation.title}
      </Text>
      {presentation.status === "planned" ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
          Geplant oder noch laufend
        </Text>
      ) : null}
      {presentation.status === "deviation" ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>Abweichung erkannt</Text>
      ) : null}
      <Text testID="tariff-check-summary" style={body}>
        {presentation.summary}
      </Text>
      <Text testID="tariff-check-limitation" style={body}>
        {presentation.limitation}
      </Text>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{period}</Text>
      {!hideServices ? (
        <View style={{ gap: SPACING.sm }}>
          <Text style={heading}>Zugehörige Dienste</Text>
          {children ??
            (!missing ? (
              <Text style={body}>Für diesen Befund sind keine Dienste zugeordnet.</Text>
            ) : null)}
          {missing ? (
            <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
          ) : null}
        </View>
      ) : null}
      <CheckDetailDisclosure title="Quelle & Prüfgrenzen" testID="tariff-source-limits">
        {!scopeOnly ? (
          <View style={{ gap: SPACING.sm }}>
            <Text style={heading}>Tarifregel · {evidence.tariffLabel}</Text>
            <Text style={body}>{evidence.ruleText}</Text>
          </View>
        ) : null}
        {presentation.constraints.map((constraint) => (
          <Text key={constraint} style={body}>
            {constraint}
          </Text>
        ))}
        {presentation.originalDescription ? (
          <Text style={body}>{presentation.originalDescription}</Text>
        ) : null}
        {presentation.originalRequirements.length ? (
          <CheckDetailDisclosure
            title="Gespeicherte Originalbedingungen"
            testID="tariff-original-requirements"
          >
            {presentation.originalRequirements.map((condition, index) => (
              <Text
                key={index}
                accessibilityLabel={`Gespeicherte Originalbedingung: ${condition}`}
                style={body}
              >
                {condition}
              </Text>
            ))}
          </CheckDetailDisclosure>
        ) : null}
        <Text style={heading}>{scopeOnly ? "Grundlage des Prüfumfangs" : "Quelle"}</Text>
        {isTariffSourceUrl(evidence.source.url) ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={evidence.source.title}
            onPress={() => {
              void Linking.openURL(evidence.source.url).catch(() => {
                Alert.alert("Link nicht geöffnet", "Du kannst die Quelle später erneut öffnen.");
              });
            }}
            style={{ minHeight: MINIMUM_TOUCH_TARGET, justifyContent: "center" }}
          >
            {source}
          </Pressable>
        ) : (
          source
        )}
      </CheckDetailDisclosure>
    </View>
  );
}
