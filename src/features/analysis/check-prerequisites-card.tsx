import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import Ionicons from "@/ui/icon";
import { SelectionSheet } from "@/ui/selection-sheet";
import { Text } from "@/ui/text";
import { AffectedCheckShifts } from "./compliance-issue-content";
import { TariffCheckDetails } from "./tariff-check-details";
import { CheckScopeDisclosure } from "./check-scope-disclosure";
import { isCheckScopeNotice } from "./check-visibility";
import { CHECK_NOT_ASSESSABLE, CHECK_STATUS_TITLE } from "./check-copy";
import { tariffCheckPresentation } from "./tariff-check-presentation";

const QUESTIONS: Readonly<Record<string, string>> = {
  ARBZG_DATA_ALL_EMPLOYMENT: "work",
  ARBZG_6_NIGHT_STATUS_UNKNOWN: "night",
  ARBZG_10_ELIGIBILITY: "sunday",
  HOLIDAY_REGION_UNKNOWN: "region",
};

export function CheckPrerequisitesCard({
  issues,
  shifts = [],
  scopeIssues = [],
  aggregateTariffCount = 0,
  aggregatePrerequisiteCount,
  aggregateScopeCount = 0,
}: {
  readonly issues?: readonly ComplianceIssue[];
  readonly shifts?: readonly ShiftEntry[];
  readonly scopeIssues?: readonly ComplianceIssue[];
  readonly aggregateTariffCount?: number;
  readonly aggregatePrerequisiteCount?: number;
  readonly aggregateScopeCount?: number;
}) {
  const palette = usePalette();
  const [showDetails, setShowDetails] = useState(false);
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null);
  const scopeCount = scopeIssues.some(isCheckScopeNotice) ? 1 : aggregateScopeCount;
  const questions = issues
    ? [...new Set(issues.map((issue) => QUESTIONS[issue.rule]).filter(Boolean))].join(",")
    : undefined;
  const tariffIssues = (issues ?? []).filter(
    (issue): issue is ComplianceIssue & { readonly tariff: TariffComplianceEvidence } =>
      issue.tariff !== undefined,
  );
  const tariffIds = new Set(tariffIssues.map((issue) => issue.id));
  const generalIssues = [
    ...new Map(
      (issues ?? [])
        .filter((issue) => !tariffIds.has(issue.id))
        .map((issue) => [
          JSON.stringify([QUESTIONS[issue.rule] ?? issue.rule, issue.title, issue.description]),
          issue,
        ]),
    ).values(),
  ];
  const missingCount =
    issues === undefined
      ? Math.max(0, (aggregatePrerequisiteCount ?? aggregateTariffCount) - aggregateTariffCount)
      : generalIssues.length;
  const unavailableTariff = tariffIssues.some((issue) => issue.tariff.status === "UNAVAILABLE");
  const pendingTariff = tariffIssues.some((issue) => issue.tariff.status === "PENDING");
  const aggregateTariff = issues === undefined && aggregateTariffCount > 0;
  const showGeneralSetup = !!questions;
  const selected = tariffIssues.find((issue) => issue.id === selectedTariffId);
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
  const related = selected
    ? selected.relatedShiftIds
        .map((id) => shiftsById.get(id))
        .filter((shift): shift is ShiftEntry => shift !== undefined)
    : [];
  const summary = [
    missingCount
      ? missingCount + " " + (missingCount === 1 ? "Angabe offen" : "Angaben offen")
      : null,
    unavailableTariff || aggregateTariff ? "Tarifprüfung eingeschränkt" : null,
    pendingTariff ? "Geplante Tarifbeobachtung" : null,
    scopeCount ? "Prüfumfang eingeschränkt" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!missingCount && !scopeCount && !tariffIssues.length && !aggregateTariff) return null;

  return (
    <SurfaceCard testID="check-status-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CHECK_STATUS_TITLE + ": " + summary}
        accessibilityHint="Zeigt offene Angaben und die Grenzen der unterstützten Prüfungen"
        accessibilityState={{ expanded: showDetails }}
        onPress={() => {
          setSelectedTariffId(null);
          setShowDetails(true);
        }}
        style={({ pressed }) => ({
          minHeight: MINIMUM_TOUCH_TARGET,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACING.md,
          padding: SPACING.lg,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: SPACING.xs }}>
          <Text style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}>
            {CHECK_STATUS_TITLE}
          </Text>
          <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>{summary}</Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={palette.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {showDetails ? (
        <SelectionSheet
          title={selected ? "Details zur Tarifprüfung" : CHECK_STATUS_TITLE}
          visible
          cancelLabel="Schließen"
          onClose={() => {
            setShowDetails(false);
            setSelectedTariffId(null);
          }}
        >
          {() =>
            selected ? (
              <View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Zurück zum Prüfstatus"
                  onPress={() => setSelectedTariffId(null)}
                  style={{
                    minHeight: MINIMUM_TOUCH_TARGET,
                    justifyContent: "center",
                    paddingHorizontal: SPACING.lg,
                  }}
                >
                  <Text style={{ color: palette.text, ...TYPOGRAPHY.small }}>
                    Zurück zum Prüfstatus
                  </Text>
                </Pressable>
                <TariffCheckDetails
                  evidence={selected.tariff}
                  title={selected.title}
                  description={selected.description}
                  missing={selected.relatedShiftIds.some((id) => !shiftsById.has(id))}
                >
                  {related.length ? <AffectedCheckShifts shifts={related} /> : null}
                </TariffCheckDetails>
              </View>
            ) : (
              <View
                testID="check-status-details"
                style={{
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.sm,
                  gap: SPACING.md,
                }}
              >
                <Text style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}>
                  {missingCount || scopeCount || unavailableTariff || aggregateTariff
                    ? CHECK_NOT_ASSESSABLE
                    : "Geplante Tarifbeobachtung"}
                </Text>
                {missingCount ? (
                  <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                    Für einzelne unterstützte Prüfungen fehlen Angaben oder eine eindeutige
                    Grundlage.
                  </Text>
                ) : null}
                {generalIssues.map((issue) => (
                  <View key={issue.id} style={{ gap: SPACING.xs }}>
                    <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
                      {issue.title}
                    </Text>
                    <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                      {issue.description}
                    </Text>
                  </View>
                ))}
                {showGeneralSetup ? (
                  <SecondaryButton
                    onPress={() => {
                      setShowDetails(false);
                      setSelectedTariffId(null);
                      router.push({
                        pathname: "/check-profile",
                        params: questions ? { questions } : {},
                      });
                    }}
                  >
                    Angaben ergänzen
                  </SecondaryButton>
                ) : null}
                {scopeCount ? (
                  <CheckScopeDisclosure
                    issues={scopeIssues}
                    shifts={shifts}
                    scopeCount={scopeCount}
                    embedded
                  />
                ) : null}
                {tariffIssues.map((issue) => {
                  const presentation = tariffCheckPresentation(
                    issue.tariff,
                    issue.title,
                    issue.description,
                  );
                  return (
                    <View
                      key={issue.id}
                      style={{
                        gap: SPACING.xs,
                        borderTopWidth: 1,
                        borderTopColor: palette.separator,
                        paddingTop: SPACING.sm,
                      }}
                    >
                      <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
                        {presentation.title}
                      </Text>
                      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
                        {presentation.summary}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={"Details ansehen: " + presentation.title}
                        onPress={() => setSelectedTariffId(issue.id)}
                        style={({ pressed }) => ({
                          minHeight: MINIMUM_TOUCH_TARGET,
                          justifyContent: "center",
                          opacity: pressed ? 0.65 : 1,
                        })}
                      >
                        <Text
                          style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}
                        >
                          Details ansehen
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
                {aggregateTariffCount > 0 && tariffIssues.length === 0 ? (
                  <View style={{ gap: SPACING.xs }}>
                    <Text style={{ color: palette.text, ...TYPOGRAPHY.small, fontWeight: "500" }}>
                      Tarifgrundlagen unvollständig
                    </Text>
                    <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.small }}>
                      Einzelheiten findest du in den Monatsprüfungen.
                    </Text>
                  </View>
                ) : null}
              </View>
            )
          }
        </SelectionSheet>
      ) : null}
    </SurfaceCard>
  );
}
