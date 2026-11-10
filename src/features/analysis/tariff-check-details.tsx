import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import type { ShiftEntry } from "@/domain/types";
import { isTariffSourceUrl, TARIFF_SCOPE_SOURCE } from "@/domain/tariff-time-policy";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { CheckDetailDisclosure } from "./check-detail-disclosure";
import { tariffCheckPresentation } from "./tariff-check-presentation";
import { TariffCheckPeriod } from "./tariff-check-period";
import { CheckDutyOverview } from "./check-duty-overview";

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
  embedded = false,
  hideServices = false,
  shifts = [],
  timeZone,
}: {
  readonly evidence: TariffComplianceEvidence;
  readonly title: string;
  readonly description: string;
  readonly missing: boolean;
  readonly children?: ReactNode;
  readonly shifts?: readonly ShiftEntry[];
  readonly timeZone?: string;
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
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{period}</Text>
      {presentation.status === "planned" ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
          Geplant oder noch laufend
        </Text>
      ) : null}
      {presentation.status === "deviation" ? (
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>Abweichung erkannt</Text>
      ) : null}
      {scopeOnly ? (
        <CheckDutyOverview shifts={shifts} timeZone={timeZone} />
      ) : (
        <TariffCheckPeriod evidence={evidence} shifts={shifts} timeZone={timeZone} />
      )}
      <View
        style={{
          borderLeftWidth: 2,
          borderLeftColor: palette.tariffCheckBorder,
          paddingLeft: SPACING.md,
        }}
      >
        <Text testID="tariff-check-summary" style={body}>
          {presentation.summary}
        </Text>
      </View>
      {!hideServices && missing ? (
        <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
      ) : null}
      <CheckDetailDisclosure title="Quelle & Berechnung" testID="tariff-source-limits">
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
        <Text testID="tariff-check-limitation" style={body}>
          {presentation.limitation}
        </Text>
        {presentation.constraints.map((constraint) => (
          <Text key={constraint} style={body}>
            {constraint}
          </Text>
        ))}
        {!scopeOnly ||
        presentation.originalDescription ||
        presentation.originalRequirements.length ? (
          <CheckDetailDisclosure title="Weitere Angaben" testID="tariff-original-requirements">
            {!scopeOnly ? (
              <View style={{ gap: SPACING.sm }}>
                <Text style={heading}>Tarifregel · {evidence.tariffLabel}</Text>
                <Text style={body}>{evidence.ruleText}</Text>
              </View>
            ) : null}
            {presentation.originalDescription ? (
              <View style={{ gap: SPACING.sm }}>
                <Text style={heading}>Gespeicherte Erläuterung</Text>
                <Text style={body}>{presentation.originalDescription}</Text>
              </View>
            ) : null}
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
      </CheckDetailDisclosure>
    </View>
  );
}
