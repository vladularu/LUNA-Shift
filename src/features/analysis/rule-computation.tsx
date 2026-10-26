import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { Text } from "@/ui/text";
import { useEffect } from "react";
import { Pressable, View } from "react-native";

import { recordDiagnostic } from "@/infrastructure/diagnostics";
import { RuleResolutionError, type RuleResolutionFailure } from "@/rules/rule-resolver";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { SurfaceCard } from "@/ui/design-system";
import { LoadFailureView } from "@/ui/loading-view";

export interface RuleComputationFailure {
  readonly ok: false;
  readonly error: RuleResolutionError | WorkingTimeTargetError;
  readonly failure:
    | RuleResolutionFailure
    | {
        readonly code: "WORKING_TIME_TARGET_UNAVAILABLE";
        readonly kind: "WORKING_TIME";
        readonly message: string;
      };
}

export type RuleComputationResult<T> =
  { readonly ok: true; readonly value: T } | RuleComputationFailure;

export function captureRuleComputation<T>(compute: () => T): RuleComputationResult<T> {
  try {
    return { ok: true, value: compute() };
  } catch (error) {
    if (error instanceof WorkingTimeTargetError)
      return {
        ok: false,
        error,
        failure: {
          code: "WORKING_TIME_TARGET_UNAVAILABLE",
          kind: "WORKING_TIME",
          message: error.message,
        },
      };
    if (!(error instanceof RuleResolutionError)) throw error;
    return { ok: false, error, failure: error.failure };
  }
}

function ruleFailureMessage(failure: RuleComputationFailure["failure"]): string {
  if (failure.kind === "WORKING_TIME") return failure.message;
  if (failure.code === "INVALID_EFFECTIVE_DATE") {
    return "Der gewählte Zeitraum ist ungültig.";
  }
  if (failure.code === "RULE_PACKAGE_AMBIGUOUS") {
    return "Für diesen Zeitraum liegen widersprüchliche Berechnungsdaten vor.";
  }
  if (failure.kind === "HOLIDAY") {
    return "Für diesen Zeitraum fehlen geprüfte Feiertagsdaten.";
  }
  if (failure.kind === "TARIFF") {
    return "Für diesen Zeitraum fehlen geprüfte Tarifdaten.";
  }
  return "Für diesen Zeitraum fehlen geprüfte Arbeitszeitregeln.";
}

export function RuleComputationFailureView({
  failure,
  onRetry,
  title = "Auswertung nicht verfügbar",
}: {
  readonly failure: Pick<RuleComputationFailure, "error" | "failure">;
  readonly onRetry: () => void;
  readonly title?: string;
}) {
  const { code } = failure.failure;
  useEffect(() => {
    recordDiagnostic("reporting", code, failure.error);
  }, [code, failure.error]);

  return (
    <LoadFailureView
      diagnosticCode={code === "WORKING_TIME_TARGET_UNAVAILABLE" ? undefined : code}
      message={ruleFailureMessage(failure.failure)}
      onRetry={onRetry}
      title={title}
    />
  );
}

export function RuleComputationNotice({
  failure,
  onRetry,
  title,
}: {
  readonly failure: Pick<RuleComputationFailure, "error" | "failure">;
  readonly onRetry?: () => void;
  readonly title: string;
}) {
  const palette = usePalette();
  const { code } = failure.failure;
  useEffect(() => {
    recordDiagnostic("reporting", code, failure.error);
  }, [code, failure.error]);

  return (
    <View>
      <SurfaceCard style={{ gap: SPACING.sm, padding: SPACING.lg }}>
        <Text
          accessibilityRole="alert"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
        >
          {title}
        </Text>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
        >
          {ruleFailureMessage(failure.failure)}
        </Text>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          selectable
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          Diagnosecode: {code}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => ({
              borderCurve: CORNER_CURVE,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: RADII.control,
              backgroundColor: palette.primarySoft,
              opacity: pressed ? 0.72 : 1,
              paddingHorizontal: SPACING.lg,
            })}
          >
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              style={{ color: palette.primary, ...TYPOGRAPHY.bodyStrong }}
            >
              Erneut prüfen
            </Text>
          </Pressable>
        ) : null}
      </SurfaceCard>
    </View>
  );
}
