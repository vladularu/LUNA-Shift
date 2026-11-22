import { useMemo } from "react";
import { View } from "react-native";
import type { MonthlyComplianceResult } from "@/domain/types";
import type { MonthlyCheckArea } from "@/navigation/routes";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { CardFooterLine, CardSeparator, RowButton, SurfaceCard } from "@/ui/design-system";
import Icon from "@/ui/icon";
import { AnalysisCardHeader, AnalysisValueRow } from "./analysis-list-card";
import { CHECK_TITLE, LEGAL_TARIFF_TITLE } from "./check-copy";
import { checkDisplayProjection } from "./check-display-groups";
import { checkCategory, PLANNING_TITLE } from "./check-presentation";
import { isCheckLimited } from "./check-visibility";
import { checkCountLabel } from "./dashboard-cards";
import {
  planningWeekendWindowsForIssue,
  weekendAssessmentOpen,
} from "./weekend-assessment-summary";

function hintCount(count: number) {
  return `${count} ${count === 1 ? "Hinweis" : "Hinweise"}`;
}

export function MonthlyCheckCard({
  compliance,
  workplaceCount = 0,
  status,
  caption,
  onOpen,
}: {
  readonly compliance: MonthlyComplianceResult | null;
  readonly workplaceCount?: number;
  readonly status?: string;
  readonly caption?: string;
  readonly onOpen: (area?: MonthlyCheckArea) => void;
}) {
  const p = usePalette();
  const findings = useMemo(() => {
    if (!compliance) return null;
    const projection = checkDisplayProjection(compliance);
    const legal = projection.issues.filter((issue) => issue.kind !== "PLANNING");
    const planning = projection.issues.filter((issue) => issue.kind === "PLANNING");
    return {
      legalCount: legal.length,
      legalValue: checkCountLabel({
        criticalCount: legal.filter(({ severity }) => severity === "critical").length,
        warningCount: legal.filter(({ severity }) => severity === "warning").length,
        infoCount: legal.filter(({ severity }) => severity === "info").length,
      }),
      legalTypes: new Set(legal.map(checkCategory)),
      planningCount: planning.reduce(
        (count, issue) => count + Math.max(1, planningWeekendWindowsForIssue(issue).length),
        0,
      ),
      limited:
        isCheckLimited(compliance) ||
        projection.unavailable ||
        weekendAssessmentOpen(compliance.weekendAssessment),
    };
  }, [compliance]);
  const loading = status === "Wird geprüft …";
  const rows = [
    {
      area: "legal",
      title: LEGAL_TARIFF_TITLE,
      count: status ? 0 : (findings?.legalCount ?? 0),
      value: findings?.legalValue,
      colors: [
        ...(findings?.legalTypes.has("legal") ? [p.legalCheckBorder] : []),
        ...(findings?.legalTypes.has("tariff") ? [p.tariffCheckBorder] : []),
      ],
    },
    {
      area: "planning",
      title: PLANNING_TITLE,
      count: status ? 0 : (findings?.planningCount ?? 0),
      colors: [p.textMuted],
    },
    {
      area: "workplace",
      title: "Betriebsregeln",
      count: loading ? 0 : workplaceCount,
      colors: [p.textMuted],
    },
  ] satisfies readonly {
    readonly area: MonthlyCheckArea;
    readonly title: string;
    readonly count: number;
    readonly value?: string;
    readonly colors: readonly string[];
  }[];
  const activeRows = rows.filter(({ count }) => count > 0);
  const total = activeRows.reduce((sum, row) => sum + row.count, 0);
  const summary = status ?? (findings?.limited ? "Prüfung eingeschränkt" : undefined);
  const statusLabel = summary ?? "Keine Auffälligkeiten";
  const allLabel = total === 1 ? "1 Hinweis ansehen" : `Alle ${hintCount(total)}`;

  return (
    <SurfaceCard>
      <AnalysisCardHeader title={CHECK_TITLE} />
      {activeRows.length ? (
        <View style={{ paddingHorizontal: SPACING.lg }}>
          {activeRows.map(({ area, title, count, colors, value }) => (
            <View key={area}>
              <CardSeparator inset={0} visible />
              <AnalysisValueRow
                label={title}
                value={value ?? hintCount(count)}
                onPress={() => onOpen(area)}
                leading={
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{ flexDirection: "row", gap: SPACING.xxs }}
                  >
                    {colors.map((color) => (
                      <View
                        key={color}
                        style={{
                          width: SPACING.xs,
                          height: SPACING.xs,
                          borderRadius: RADII.pill,
                          backgroundColor: color,
                        }}
                      />
                    ))}
                  </View>
                }
              />
            </View>
          ))}
        </View>
      ) : null}
      {summary || total === 0 ? (
        <RowButton
          title={statusLabel}
          accessibilityLabel={`${CHECK_TITLE}, ${statusLabel}`}
          accessibilityState={{ busy: loading }}
          leading={
            <Icon
              name={summary ? "information-circle-outline" : "checkmark-circle-outline"}
              size={18}
              color={p.textMuted}
              accessibilityElementsHidden
            />
          }
          onPress={() => onOpen()}
        />
      ) : null}
      {total > 0 ? (
        <RowButton
          title={allLabel}
          accessibilityLabel={`${CHECK_TITLE}, ${allLabel}`}
          titleColor={p.primary}
          onPress={() => onOpen()}
        />
      ) : null}
      {caption ? <CardFooterLine caption={caption} /> : null}
    </SurfaceCard>
  );
}
