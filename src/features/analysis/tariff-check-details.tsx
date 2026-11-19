import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import type { ShiftEntry } from "@/domain/types";
import { isTariffSourceUrl, TARIFF_SCOPE_SOURCE } from "@/domain/tariff-time-policy";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { CheckDetailDisclosure } from "./check-detail-disclosure";
import { tariffCheckPresentation } from "./tariff-check-presentation";
import { TariffCheckPeriod, tariffCheckCalendar } from "./tariff-check-period";
import { CheckDutyOverview } from "./check-duty-overview";
import {
  CheckDetailCard,
  checkSourceLinkStyle,
  CheckDetailStack,
  CheckDetailHeading,
  useCheckReferenceDetail,
} from "./check-detail-layout";
import { checkPeriodLabel } from "./check-period-label";

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
  const reference = useCheckReferenceDetail();
  const heading = { color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" as const };
  const body = reference
    ? { ...CHECK_REFERENCE_TYPOGRAPHY.body, color: reference.secondary }
    : { color: palette.textMuted, ...TYPOGRAPHY.body };
  const scopeOnly = evidence.source.url === TARIFF_SCOPE_SOURCE.url;
  const calendar = scopeOnly ? null : tariffCheckCalendar(evidence);
  const presentation = tariffCheckPresentation(evidence, title, description);
  const period = `${dateLabel(evidence.period.from).slice(0, evidence.period.from.slice(0, 4) === evidence.period.until.slice(0, 4) ? 6 : undefined)}–${dateLabel(evidence.period.until)}`;
  const sourceLinked = isTariffSourceUrl(evidence.source.url);
  const source = (
    <View style={{ gap: SPACING.xs }}>
      <Text
        style={[
          { color: palette.text, ...TYPOGRAPHY.small },
          sourceLinked && checkSourceLinkStyle(palette),
        ]}
      >
        {evidence.source.title}
      </Text>
      <Text style={body}>{evidence.source.section}</Text>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
        Fassung: {evidence.source.version}
      </Text>
    </View>
  );

  return (
    <CheckDetailStack testID="tariff-check-detail-content" embedded={embedded}>
      <CheckDetailHeading
        kind="tariff"
        period={reference ? checkPeriodLabel(evidence.period.from, evidence.period.until) : period}
        title={presentation.title}
        caption={
          presentation.status === "planned"
            ? "Tarifprüfung · Geplant oder noch laufend"
            : presentation.status === "deviation"
              ? "Tarifprüfung · Abweichung erkannt"
              : "Tarifprüfung"
        }
      />
      <CheckDetailCard
        title={
          reference
            ? calendar?.dates.length === 7 && calendar.recorded.length === 7
              ? "Dienstbeginn an sieben Tagen"
              : "Dienstbeginn im Prüfzeitraum"
            : undefined
        }
        accent={reference?.tariffLine}
      >
        {scopeOnly ? (
          <CheckDutyOverview shifts={shifts} timeZone={timeZone} />
        ) : (
          <TariffCheckPeriod
            evidence={evidence}
            shifts={shifts}
            timeZone={timeZone}
            calendar={calendar}
          />
        )}
      </CheckDetailCard>
      <CheckDetailCard
        title={reference ? "Was zeigt der Hinweis?" : "Einordnung"}
        accent={reference ? undefined : palette.tariffCheckBorder}
      >
        {reference && (presentation.status === "planned" || presentation.status === "deviation") ? (
          <Text style={body}>{tariffCheckStatus(evidence.status)}</Text>
        ) : null}
        <Text testID="tariff-check-summary" style={body}>
          {presentation.summary}
        </Text>
        {!hideServices && missing ? (
          <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
        ) : null}
      </CheckDetailCard>
      <CheckDetailCard disclosure>
        <CheckDetailDisclosure
          title={reference ? "Prüfgrundlage" : "Quelle & Berechnung"}
          testID="tariff-source-limits"
        >
          <Text style={heading}>{scopeOnly ? "Grundlage des Prüfumfangs" : "Quelle"}</Text>
          {sourceLinked ? (
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
      </CheckDetailCard>
    </CheckDetailStack>
  );
}
