import { employmentProfileAt, employmentWorkPatternAt } from "@/domain/employment-history";
import { settingsEditorRoute } from "@/navigation/routes";
import { Text } from "@/ui/text";
import { selectTvhKrAssessmentShifts } from "@/engine/simple-tvh-kr-profile-pay";
import { selectTvlKrAssessmentShifts } from "@/engine/simple-tvl-kr-profile-pay";
import { selectVkaEAssessmentShifts } from "@/engine/simple-vka-e-pay";
import { selectNursingTrainingAssessmentShifts } from "@/engine/simple-nursing-training-pay";
import Ionicons from "@/ui/icon";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import {
  ALLOWANCE_STATUSES,
  type AllowanceStatus,
  type TvoedWorkPatternSettings,
} from "@/domain/types";
import { userFacingErrorMessage } from "@/domain/errors";
import { currentMonth, formatMonthTitle } from "@/engine/calendar";
import { calculateMonthlyTvoedAssessment } from "@/engine/simple-pay";
import {
  selectAllowanceShifts,
  selectMonthlyAnalysisEntries,
} from "@/features/analysis/analysis-data";
import { AnalysisCoverageNote } from "@/features/analysis/analysis-coverage-note";
import { AnalysisDetailSummaryCard } from "@/features/analysis/analysis-detail-layout";
import {
  captureRuleComputation,
  RuleComputationNotice,
} from "@/features/analysis/rule-computation";
import { NightSequenceExplanationCard } from "@/features/analysis/night-sequence-explanation-card";
import { resolveEditorSession } from "@/features/editor-session";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { RADII, SPACING } from "@/theme/tokens";
import { CardSeparator, SurfaceCard, RowButton } from "@/ui/design-system";
import { FormStatus } from "@/ui/form-layout";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { successFeedback } from "@/ui/haptics";
import { ReportScrollView } from "@/ui/report-layout";
import { BackFooterLayout } from "@/ui/back-footer-layout";

const ALLOWANCE_LABELS: Readonly<Record<AllowanceStatus, string>> = {
  NONE: "Keine Zulage",
  SHIFT_MONTHLY: "Ständige Schichtarbeit",
  SHIFT_HOURLY: "Nichtständige Schichtarbeit",
  ALTERNATING_MONTHLY: "Ständige Wechselschicht",
  ALTERNATING_HOURLY: "Nichtständige Wechselschicht",
};

const CRITERION_ICON_SIZE = 28;

export function TariffAssessmentScreen() {
  const palette = usePalette();
  return (
    <>
      <Stack.Screen
        options={{
          title: "Schichtzulage",
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          statusBarStyle: palette.dark ? "light" : "dark",
        }}
      />
      <TariffAssessmentContent />
    </>
  );
}

function TariffAssessmentContent() {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const { error, ready, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { workPatternSettings } = usePflegeShiftTariff();
  const parsedMonth = parseMonthRouteParam(params.month);
  const month =
    parsedMonth.status === "valid" ? parsedMonth.value : currentMonth(profile?.timeZone);
  if (parsedMonth.status !== "valid") {
    return (
      <LoadFailureView
        actionLabel="Schließen"
        message="Der Link zur Tarifprüfung enthält keinen gültigen Monat."
        onRetry={() => router.back()}
        title="Tarifprüfung kann nicht geöffnet werden"
      />
    );
  }
  if (ready && error) {
    return <LoadFailureView message={error} onRetry={() => void reload()} />;
  }
  const session = resolveEditorSession(ready && profile !== null, month, () =>
    profile
      ? employmentWorkPatternAt(profile, workPatternSettings, month + "-01")
      : workPatternSettings,
  );
  if (session === null || profile === null) return <LoadingView />;
  return (
    <TariffAssessmentForm key={session.key} initialSettings={session.initialValue} month={month} />
  );
}

function TariffAssessmentForm({
  initialSettings,
  month,
}: {
  readonly initialSettings: TvoedWorkPatternSettings;
  readonly month: string;
}) {
  const palette = usePalette();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const { tariffDecisions, workPatternSettings, upsertTariffDecision } = usePflegeShiftTariff();
  const { workplaceCoverage: coverage, assignment } = initialSettings;
  const [showOverride, setShowOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleRetryRevision, setRuleRetryRevision] = useState(0);

  const decision = tariffDecisions.find((item) => item.month === month) ?? null;
  const calculation = useMemo(() => {
    void ruleRetryRevision;
    return captureRuleComputation(() => {
      const monthlyEntries = selectMonthlyAnalysisEntries(entries, month);
      const allowanceShifts = profile?.tvhKrTariff
        ? selectTvhKrAssessmentShifts(entries, month)
        : profile?.tvlKrTariff || profile?.tvalPflegeTariff
          ? selectTvlKrAssessmentShifts(entries, month)
          : profile?.vkaETariff
            ? selectVkaEAssessmentShifts(entries, month)
            : profile?.nursingTrainingTariff
              ? selectNursingTrainingAssessmentShifts(entries, month)
              : selectAllowanceShifts(entries, month, ruleResolver);
      return calculateMonthlyTvoedAssessment(
        month,
        monthlyEntries.monthShifts,
        allowanceShifts,
        { workplaceCoverage: coverage, assignment, updatedAt: workPatternSettings.updatedAt },
        ruleResolver,
        profile
          ? {
              ...employmentProfileAt(profile, month + "-01"),
              employmentTimeline: undefined,
              workPattern: { workplaceCoverage: coverage, assignment },
            }
          : undefined,
      );
    });
  }, [
    assignment,
    coverage,
    entries,
    month,
    profile,
    ruleResolver,
    ruleRetryRevision,
    workPatternSettings.updatedAt,
  ]);

  if (!calculation.ok) {
    return (
      <BackFooterLayout onPress={() => router.back()}>
        {(bottomPadding) => (
          <ReportScrollView bottomPadding={bottomPadding}>
            <AnalysisDetailSummaryCard
              caption="Deine Angaben bleiben erhalten."
              period={formatMonthTitle(month)}
              title="Nicht verfügbar"
            />
            <RuleComputationNotice
              failure={calculation}
              onRetry={() => setRuleRetryRevision((value) => value + 1)}
              title="Tarifprüfung nicht verfügbar"
            />
          </ReportScrollView>
        )}
      </BackFooterLayout>
    );
  }
  const assessmentResult = calculation.value;
  if (!assessmentResult.available || assessmentResult.assessment === null) {
    return (
      <BackFooterLayout onPress={() => router.back()}>
        {(bottomPadding) => (
          <ReportScrollView bottomPadding={bottomPadding}>
            <AnalysisDetailSummaryCard
              caption="Deine Angaben bleiben erhalten."
              period={formatMonthTitle(month)}
              title="Nicht verfügbar"
            />
            <AnalysisCoverageNote message="Schichtzulage nicht berechenbar: Tarifdaten fehlen." />
          </ReportScrollView>
        )}
      </BackFooterLayout>
    );
  }
  const assessment = assessmentResult.assessment;
  const resultTitle = decision
    ? ALLOWANCE_LABELS[decision.allowanceStatus]
    : assessment.suggestedAllowance !== "NONE"
      ? ALLOWANCE_LABELS[assessment.suggestedAllowance]
      : assessment.requiresConfirmation
        ? "Bestätigung erforderlich"
        : assessment.alternatingShiftWork === "REVIEW"
          ? "Wechselschicht noch nicht eindeutig"
          : assessment.shiftWork === "DETECTED"
            ? "Schichtarbeit erkannt"
            : "Kein eindeutiges Schichtmuster";

  async function confirmOverride(status: AllowanceStatus) {
    try {
      setSaving(true);
      setError(null);
      await upsertTariffDecision({
        month,
        allowanceStatus: status,
        expectedRevision: decision?.revision,
      });
      successFeedback();
      router.back();
    } catch (saveError) {
      setError(userFacingErrorMessage(saveError, "Monatswert konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BackFooterLayout onPress={() => router.back()} disabled={saving}>
      {(bottomPadding) => (
        <ReportScrollView bottomPadding={bottomPadding}>
          <AnalysisDetailSummaryCard
            caption={
              decision
                ? "Für diesen Monat gilt deine Auswahl."
                : (assessment.estimateNote ??
                  "Schätzung aus deinen Diensten, kein bestätigter Monatsanspruch.")
            }
            period={formatMonthTitle(month)}
            title={resultTitle}
          />

          <SurfaceCard>
            {assessment.criteria.map((criterion, index) => (
              <View key={criterion.key}>
                {index > 0 ? (
                  <CardSeparator inset={SPACING.lg + CRITERION_ICON_SIZE + SPACING.md} />
                ) : null}
                <View
                  style={{
                    minHeight: 64,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.md,
                    paddingHorizontal: SPACING.lg,
                    paddingVertical: SPACING.sm,
                  }}
                >
                  <View
                    style={{
                      width: CRITERION_ICON_SIZE,
                      height: CRITERION_ICON_SIZE,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: RADII.pill,
                      backgroundColor:
                        criterion.state === "MET"
                          ? palette.primarySoft
                          : criterion.state === "NOT_MET"
                            ? `${palette.danger}1A`
                            : palette.surfaceMuted,
                    }}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={
                        criterion.state === "MET"
                          ? palette.primary
                          : criterion.state === "NOT_MET"
                            ? palette.danger
                            : palette.textMuted
                      }
                      name={
                        criterion.state === "MET"
                          ? "checkmark"
                          : criterion.state === "NOT_MET"
                            ? "remove"
                            : "help"
                      }
                      size={16}
                    />
                  </View>
                  <View style={{ flex: 1, gap: SPACING.xxs }}>
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      selectable
                      style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                    >
                      {criterion.label}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      selectable
                      style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
                    >
                      {criterion.detail}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </SurfaceCard>

          {profile?.tariff?.sector === "BT_K" ? (
            <NightSequenceExplanationCard
              key={month}
              entries={entries}
              month={month}
              timeZone={profile.timeZone}
              explanation={assessmentResult.nightSequence}
              estimateNote={null}
            />
          ) : null}

          <SurfaceCard>
            <RowButton
              title="Arbeitsmodell bearbeiten"
              subtitle="Deine gespeicherten Angaben und ihren Zeitraum ändern"
              onPress={() => router.push(settingsEditorRoute("MODEL"))}
            />
          </SurfaceCard>
          <FormStatus error={error} />

          <Pressable
            accessibilityLabel="Schichtzulage selbst festlegen"
            accessibilityRole="button"
            accessibilityState={{ expanded: showOverride }}
            onPress={() => setShowOverride((current) => !current)}
            style={({ pressed }) => ({
              minHeight: 56,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: SPACING.md,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: SPACING.xxs,
            })}
          >
            <View style={{ flex: 1, gap: SPACING.xxs }}>
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
              >
                Schichtzulage selbst festlegen
              </Text>
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
              >
                Nur verwenden, wenn die automatische Einordnung abweicht.
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={palette.textMuted}
              name={showOverride ? "chevron-up" : "chevron-down"}
              size={20}
            />
          </Pressable>

          {showOverride ? (
            <SurfaceCard>
              <View
                accessibilityLabel="Schichtzulage selbst festlegen"
                accessibilityRole="radiogroup"
              >
                {ALLOWANCE_STATUSES.map((status, index) => (
                  <View key={status}>
                    {index > 0 ? <CardSeparator inset={SPACING.lg} /> : null}
                    <Pressable
                      accessibilityLabel={`Schichtzulage selbst festlegen: ${ALLOWANCE_LABELS[status]}`}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: decision?.allowanceStatus === status,
                        disabled: saving,
                      }}
                      disabled={saving}
                      onPress={() => void confirmOverride(status)}
                      style={({ pressed }) => ({
                        minHeight: 56,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: SPACING.md,
                        backgroundColor: pressed ? palette.surfaceMuted : "transparent",
                        paddingHorizontal: SPACING.lg,
                      })}
                    >
                      <Text
                        maxFontSizeMultiplier={TEXT_MAX_SCALE}
                        style={{ flex: 1, color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                      >
                        {ALLOWANCE_LABELS[status]}
                      </Text>
                      <Ionicons
                        accessibilityElementsHidden
                        color={
                          decision?.allowanceStatus === status ? palette.primary : palette.textMuted
                        }
                        name={
                          decision?.allowanceStatus === status
                            ? "radio-button-on"
                            : "radio-button-off"
                        }
                        size={20}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            </SurfaceCard>
          ) : null}
        </ReportScrollView>
      )}
    </BackFooterLayout>
  );
}
