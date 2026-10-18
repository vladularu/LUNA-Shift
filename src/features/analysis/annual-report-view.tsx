import { Text } from "@/ui/text";
import { INTER_FONTS } from "@/theme/shadcn";
import type { ReactNode } from "react";
import { router } from "expo-router";
import { annualDetailsRoute } from "@/navigation/routes";
import Ionicons from "@/ui/icon";
import { Pressable, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";

import { SHIFT_TYPE_LABELS, type ShiftType } from "@/domain/types";
import { formatMonthTitle } from "@/engine/calendar";
import { formatMinutes, formatSignedMinutes } from "@/engine/working-time";
import { buildAnnualDistributionSections } from "@/features/analysis/annual-distribution";
import { AnalysisCoverageNote } from "@/features/analysis/analysis-coverage-note";
import type { AnnualReport } from "@/features/analysis/annual-report";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { PLANNING_HIDDEN_NOTICE, selectAnnualCheckDisplay } from "./check-visibility";
import {
  AnalysisYearHeader,
  formatEuro,
  ReportCardTitle,
  WorktimeCard,
} from "@/features/analysis/analysis-overview-cards";
import { AnalysisViewControls } from "./analysis-view-controls";
import { ShiftAnalysisDetails } from "./shift-analysis-details";
import { AnalysisListCard, AnalysisValueRow } from "./analysis-list-card";
import { AnnualPremiumReport } from "./annual-premium-report";
import { AnnualOverview } from "./annual-overview";
import { AnalysisDetailSummaryCard } from "./analysis-detail-layout";
import { CheckPeriod } from "./check-summary-card";
import { CheckPrerequisitesCard } from "./check-prerequisites-card";
import type { AnnualDetailSection } from "@/navigation/routes";
import { SHIFT_TYPE_COLORS, usePalette } from "@/theme/palette";
import { MOTION } from "@/theme/motion";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { CardFooterLine, CardSeparator, SurfaceCard } from "@/ui/design-system";
import { ReportPeriodContent, ReportScrollView } from "@/ui/report-layout";

export type AnalysisPeriod = "MONTH" | "YEAR";

export function AnnualReportScreen({
  exportControl,
  report: sourceReport,
  pending = false,
  testMonths,
  onBackToMonth,
  onMoveYear,
}: {
  readonly exportControl?: ReactNode;
  readonly report: AnnualReport;
  readonly pending?: boolean;
  readonly testMonths: readonly string[];
  readonly onBackToMonth: () => void;
  readonly onMoveYear: (delta: number) => void;
}) {
  const palette = usePalette();
  const preferences = useCheckPreferences();
  const showPlanning = preferences.enabled !== false;
  const report = selectAnnualCheckDisplay(sourceReport, showPlanning);
  const testMonthCount = report.months.filter((item) => testMonths.includes(item.month)).length;

  return (
    <View style={{ flex: 1, backgroundColor: palette.groupedBackground }}>
      <AnalysisYearHeader
        activeMonthCount={report.activeMonthCount}
        onNext={() => onMoveYear(1)}
        onOpenMonth={onBackToMonth}
        onPrevious={() => onMoveYear(-1)}
        year={report.year}
      />
      <ReportScrollView>
        <ReportPeriodContent>
          {testMonthCount > 0 ? <AnnualTestBadge count={testMonthCount} /> : null}
          {!showPlanning ? <AnalysisCoverageNote message={PLANNING_HIDDEN_NOTICE} /> : null}
          {preferences.error ? <AnalysisCoverageNote message={preferences.error} /> : null}
          {preferences.enabled === null && !preferences.error ? (
            <AnalysisCoverageNote message="Prüfung wird geladen …" />
          ) : null}

          <AnnualOverview report={report} pending={pending} />
          <AnalysisViewControls />
          {exportControl}
        </ReportPeriodContent>
      </ReportScrollView>
    </View>
  );
}

export function AnnualReportDetails({
  report: sourceReport,
  pending = false,
  section,
  testMonths,
  onSelectMonth,
}: {
  readonly report: AnnualReport;
  readonly pending?: boolean;
  readonly section: AnnualDetailSection;
  readonly testMonths: readonly string[];
  readonly onSelectMonth: (month: string) => void;
}) {
  const palette = usePalette();
  const preferences = useCheckPreferences();
  const showPlanning = preferences.enabled !== false;
  const report = selectAnnualCheckDisplay(sourceReport, showPlanning);
  const testMonthCount = report.months.filter((item) => testMonths.includes(item.month)).length;
  if (section === "PREMIUM")
    return <AnnualPremiumReport report={report} pending={pending} onSelectMonth={onSelectMonth} />;
  if (section === "SHIFTS")
    return (
      <ReportScrollView>
        <AnalysisDetailSummaryCard
          title="Deine Schichten"
          period={String(report.year)}
          caption="Anzahl und Stunden pro Schichtart."
        />
        {report.shiftTypeAnalysis ? (
          <ShiftAnalysisDetails
            analysis={report.shiftTypeAnalysis}
            creditsAvailable={!pending && report.worktimeCoverageComplete}
          />
        ) : (
          <AnalysisCoverageNote message="Schichtstunden sind noch nicht verfügbar." />
        )}
        <AnalysisListCard
          title="Monate"
          caption={
            pending || !report.worktimeCoverageComplete
              ? "Erfasste Stunden ohne Abwesenheitsgutschriften."
              : undefined
          }
        >
          {report.months.map((month, index) => (
            <AnalysisValueRow
              key={month.month}
              first={index === 0}
              label={formatMonthTitle(month.month)}
              value={formatMinutes(month.actualMinutes) + " h"}
              onPress={() => onSelectMonth(month.month)}
            />
          ))}
        </AnalysisListCard>
      </ReportScrollView>
    );

  return (
    <ReportScrollView>
      <ReportPeriodContent>
        {section === "CHECK" ? (
          <>
            <CheckPeriod period={String(report.year)} />
            {pending || !report.complianceCoverageComplete ? (
              <AnalysisCoverageNote
                message={
                  pending
                    ? "Die Jahresprüfung wird berechnet …"
                    : "Für die vollständige Jahresprüfung fehlen Berechnungsdaten."
                }
              />
            ) : null}
          </>
        ) : (
          <AnalysisDetailSummaryCard
            title={section === "WORK" ? "Deine Stunden" : "Gehaltsprognose"}
            period={String(report.year)}
            caption={section === "WORK" ? undefined : "Brutto nach Monaten"}
          />
        )}
        {testMonthCount > 0 ? <AnnualTestBadge count={testMonthCount} /> : null}
        {section === "CHECK" ? (
          <>
            {!showPlanning ? <AnalysisCoverageNote message={PLANNING_HIDDEN_NOTICE} /> : null}
            {preferences.error ? <AnalysisCoverageNote message={preferences.error} /> : null}
            {preferences.enabled === null && !preferences.error ? (
              <AnalysisCoverageNote message="Prüfung wird geladen …" />
            ) : null}
            {!pending && report.complianceCoverageComplete ? (
              <AnnualCheckDetails report={report} onSelectMonth={onSelectMonth} />
            ) : null}
          </>
        ) : section === "PAY" ? (
          pending ? (
            <AnalysisCoverageNote message="Das Jahresgehalt wird berechnet …" />
          ) : (
            <AnnualSalaryDetails report={report} onSelectMonth={onSelectMonth} />
          )
        ) : (
          <>
            <WorktimeCard
              actual={formatMinutes(report.actualMinutes)}
              balance={
                pending
                  ? "Wird berechnet"
                  : report.balanceMinutes === null
                    ? "Nicht verfügbar"
                    : formatSignedMinutes(report.balanceMinutes)
              }
              balanceAccent={
                report.balanceMinutes === null
                  ? palette.textMuted
                  : report.balanceMinutes < 0
                    ? palette.danger
                    : palette.success
              }
              target={
                pending
                  ? "Wird berechnet"
                  : report.targetMinutes === null
                    ? "Nicht verfügbar"
                    : formatMinutes(report.targetMinutes)
              }
            />

            {!pending && !report.worktimeCoverageComplete ? (
              <AnalysisCoverageNote message="Feiertagsdaten fehlen: Soll, Saldo und Zeitgutschriften sind nicht berechenbar." />
            ) : null}

            <MonthlyBars
              report={report}
              pending={pending}
              testMonths={testMonths}
              onSelectMonth={onSelectMonth}
            />

            {report.shiftTypeAnalysis ? (
              <ShiftAnalysisDetails
                analysis={report.shiftTypeAnalysis}
                creditsAvailable={!pending && report.worktimeCoverageComplete}
              />
            ) : (
              <DistributionList distribution={report.distribution} />
            )}
          </>
        )}
      </ReportPeriodContent>
    </ReportScrollView>
  );
}

function AnnualTestBadge({ count }: { readonly count: number }) {
  const palette = usePalette();
  return (
    <View
      accessibilityLabel={`${count} Testmonate enthalten`}
      style={{
        alignSelf: "center",
        borderRadius: RADII.pill,
        backgroundColor: palette.primarySoft,
        paddingHorizontal: 11,
        paddingVertical: SPACING.xs,
      }}
    >
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        selectable
        style={{ color: palette.primary, ...TYPOGRAPHY.overline }}
      >
        {count} TESTMONATE ENTHALTEN
      </Text>
    </View>
  );
}

function AnnualCheckDetails({
  report,
  onSelectMonth,
}: {
  readonly report: AnnualReport;
  readonly onSelectMonth: (month: string) => void;
}) {
  const palette = usePalette();
  const issueMonths = report.months.filter(
    (item) =>
      item.criticalCount +
        item.warningCount +
        (item.infoCount ?? 0) +
        (item.prerequisiteCount ?? 0) >
      0,
  );
  if (issueMonths.length === 0)
    return (
      <AnalysisCoverageNote message="Keine Auffälligkeiten in den eingeblendeten Prüfungen." />
    );
  return (
    <View style={{ gap: SPACING.md }}>
      {report.prerequisiteCount ? <CheckPrerequisitesCard /> : null}
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
      >
        {report.prerequisiteCount ? "Monate mit Hinweisen" : "Monate mit Meldungen"}
      </Text>
      <SurfaceCard style={{ paddingHorizontal: SPACING.lg }}>
        {issueMonths.map((item, index) => {
          const count = item.criticalCount + item.warningCount + (item.infoCount ?? 0);
          const countLabel = count
            ? `${count} ${count === 1 ? "Meldung" : "Meldungen"}`
            : "Prüfung eingeschränkt";
          const monthLabel = formatMonthTitle(item.month);
          const severity =
            item.criticalCount > 0
              ? "Kritische Meldung enthalten"
              : item.warningCount > 0
                ? "Warnung enthalten"
                : item.prerequisiteCount
                  ? "Prüfgrundlage unvollständig"
                  : "Hinweis enthalten";
          return (
            <View key={item.month}>
              {index > 0 ? <CardSeparator inset={0} /> : null}
              <Pressable
                accessibilityLabel={`${monthLabel}, ${countLabel}, ${severity}`}
                accessibilityHint="Öffnet die Prüfung für diesen Monat"
                accessibilityRole="button"
                onPress={() => onSelectMonth(item.month)}
                style={({ pressed }) => ({
                  minHeight: 64,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACING.md,
                  opacity: pressed ? 0.72 : 1,
                  paddingVertical: SPACING.md,
                })}
              >
                <View style={{ minWidth: 0, flex: 1, gap: SPACING.xxs }}>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                  >
                    {monthLabel.replace(` ${report.year}`, "")}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.xs }}>
                    <Ionicons
                      name={
                        item.criticalCount > 0
                          ? "alert-circle-outline"
                          : item.warningCount > 0
                            ? "warning-outline"
                            : "information-circle-outline"
                      }
                      size={15}
                      color={
                        item.criticalCount > 0
                          ? palette.danger
                          : item.warningCount > 0
                            ? palette.warning
                            : palette.primary
                      }
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      style={{ flexShrink: 1, color: palette.textMuted, ...TYPOGRAPHY.caption }}
                    >
                      {countLabel}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  color={palette.textMuted}
                  name="ellipsis-horizontal-circle"
                  size={18}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </Pressable>
            </View>
          );
        })}
        <View style={{ paddingBottom: SPACING.lg }}>
          <CardSeparator inset={0} />
        </View>
      </SurfaceCard>
    </View>
  );
}

function AnnualSalaryDetails({
  report,
  onSelectMonth,
}: {
  readonly report: AnnualReport;
  readonly onSelectMonth: (month: string) => void;
}) {
  const palette = usePalette();
  const available = report.availablePayMonthCount > 0;
  const rows = [
    {
      label: "Berücksichtigte Monate",
      value: `${report.availablePayMonthCount} von 12`,
    },
    ...(report.salarySource === "MANUAL"
      ? []
      : [
          { label: "Zeitzuschläge", value: formatEuro(report.premiumAmount) },
          { label: "Überstunden", value: formatEuro(report.overtimeAmount) },
          { label: "Zulagen", value: formatEuro(report.allowanceAmount) },
        ]),
  ];
  return (
    <SurfaceCard>
      <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.screenTitle, fontVariant: ["tabular-nums"] }}
        >
          {available ? formatEuro(report.estimatedGrossAmount) : "Nicht verfügbar"}
        </Text>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          {available
            ? `${report.availablePayMonthCount < 12 ? "Brutto-Teilsumme" : "Brutto-Schätzung"} · ${report.availablePayMonthCount} von 12 Monaten`
            : "Keine unterstützte Monatsschätzung verfügbar"}
        </Text>
      </View>
      {available ? (
        <View style={{ paddingHorizontal: SPACING.lg }}>
          {rows.map((row, index) => (
            <AnalysisValueRow
              key={row.label}
              first={index === 0}
              label={row.label}
              value={row.value}
              reserveDisclosure
              onPress={
                row.label === "Zeitzuschläge"
                  ? () => router.push(annualDetailsRoute(report.year, "PREMIUM"))
                  : undefined
              }
            />
          ))}
        </View>
      ) : (
        <View style={{ padding: SPACING.lg }}>
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            selectable
            style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
          >
            Ohne eingerichtete Gehaltsgrundlage werden keine Beträge ausgewiesen.
          </Text>
        </View>
      )}
      <CardSeparator inset={0} />
      <View style={{ paddingHorizontal: SPACING.lg }}>
        {report.months.map((item, index) => (
          <View key={item.month}>
            {index > 0 ? <CardSeparator inset={0} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${formatMonthTitle(item.month)}, ${item.estimatedGrossAmount === null ? "Nicht verfügbar" : formatEuro(item.estimatedGrossAmount)}`}
              accessibilityHint="Öffnet Gehalt und Zeitzuschläge für diesen Monat"
              onPress={() => onSelectMonth(item.month)}
              style={({ pressed }) => ({
                minHeight: 56,
                paddingVertical: SPACING.md,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.md,
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <View style={{ flex: 1, minWidth: 0, gap: SPACING.xs }}>
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                >
                  {formatMonthTitle(item.month)}
                </Text>
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
                >
                  {item.estimatedGrossAmount === null
                    ? "Nicht verfügbar"
                    : formatEuro(item.estimatedGrossAmount)}
                </Text>
              </View>
              <Ionicons name="ellipsis-horizontal-circle" color={palette.textMuted} size={20} />
            </Pressable>
          </View>
        ))}
      </View>
      <CardFooterLine />
    </SurfaceCard>
  );
}

function MonthlyBars({
  report,
  pending,
  testMonths,
  onSelectMonth,
}: {
  readonly report: AnnualReport;
  readonly pending: boolean;
  readonly testMonths: readonly string[];
  readonly onSelectMonth: (month: string) => void;
}) {
  const palette = usePalette();
  const maximum = Math.max(1, ...report.months.map((item) => item.actualMinutes));
  return (
    <SurfaceCard>
      <ReportCardTitle title="Jahresverlauf" />
      <View style={{ gap: SPACING.sm, padding: SPACING.lg }}>
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          Monat antippen, um die Stunden im Detail zu öffnen.
        </Text>
        {report.months.map((item, index) => (
          <View key={item.month}>
            {index > 0 ? <CardSeparator inset={0} /> : null}
            <Pressable
              accessibilityLabel={`${formatMonthTitle(item.month)}, ${formatMinutes(item.actualMinutes)} ${pending ? "erfasst; Prüfung ausstehend" : "Ist"}${testMonths.includes(item.month) ? ", Testdaten" : ""}`}
              accessibilityRole="button"
              onPress={() => onSelectMonth(item.month)}
              style={({ pressed }) => ({
                minHeight: 56,
                gap: SPACING.sm,
                paddingVertical: SPACING.md,
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
                <View style={{ flex: 1, minWidth: 0, gap: SPACING.xs }}>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={{ color: palette.text, ...TYPOGRAPHY.bodyStrong }}
                  >
                    {formatMonthTitle(item.month)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={TEXT_MAX_SCALE}
                    style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
                  >
                    {formatMinutes(item.actualMinutes)} h {pending ? "erfasst" : "Ist"} · Soll{" "}
                    {pending
                      ? "Wird berechnet"
                      : item.targetMinutes === null
                        ? "Nicht verfügbar"
                        : `${formatMinutes(item.targetMinutes)} h`}
                  </Text>
                  {testMonths.includes(item.month) ? (
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
                    >
                      Testdaten
                    </Text>
                  ) : null}
                </View>
                <Ionicons color={palette.textMuted} name="ellipsis-horizontal-circle" size={20} />
              </View>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  height: 6,
                  backgroundColor: palette.primarySoft,
                  borderRadius: RADII.pill,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${(item.actualMinutes / maximum) * 100}%`,
                    backgroundColor: palette.primary,
                    borderRadius: RADII.pill,
                  }}
                />
              </View>
            </Pressable>
          </View>
        ))}
      </View>
      <CardFooterLine />
    </SurfaceCard>
  );
}

function DistributionList({
  distribution,
}: {
  readonly distribution: ReadonlyMap<ShiftType, number>;
}) {
  const palette = usePalette();
  const sections = buildAnnualDistributionSections(distribution);
  const hasEntries = sections.services.length > 0 || sections.absences.length > 0;
  return (
    <SurfaceCard>
      <ReportCardTitle title="Dienstverteilung" />
      <View style={{ gap: 14, padding: SPACING.lg }}>
        {!hasEntries ? (
          <Text
            selectable
            style={{
              color: palette.textMuted,
              fontFamily: INTER_FONTS.regular,
              fontSize: TYPOGRAPHY.label.fontSize,
            }}
          >
            Keine Einträge in diesem Jahr.
          </Text>
        ) : null}

        {sections.services.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              selectable
              style={{ color: palette.textMuted, ...TYPOGRAPHY.overline }}
            >
              DIENSTE & FORTBILDUNG
            </Text>
            {sections.services.map(({ type, count, percentage }, index) => (
              <Animated.View
                key={type}
                entering={FadeInUp.delay(index * 28)
                  .duration(MOTION.duration.normal)
                  .reduceMotion(MOTION.reduceMotion)}
                style={{ minHeight: 24, flexDirection: "row", alignItems: "center", gap: 9 }}
              >
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: SHIFT_TYPE_COLORS[type],
                  }}
                />
                <Text
                  selectable
                  style={{
                    flex: 1,
                    color: palette.textSecondary,
                    fontFamily: INTER_FONTS.regular,
                    fontSize: TYPOGRAPHY.label.fontSize,
                  }}
                >
                  {SHIFT_TYPE_LABELS[type]}
                </Text>
                <Text
                  maxFontSizeMultiplier={TEXT_MAX_SCALE}
                  selectable
                  style={{
                    color: palette.text,
                    ...TYPOGRAPHY.label,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {count}
                </Text>
                <Text
                  selectable
                  style={{
                    width: 38,
                    color: palette.textMuted,
                    fontFamily: INTER_FONTS.regular,
                    fontSize: TYPOGRAPHY.caption.fontSize,
                    textAlign: "right",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {percentage}%
                </Text>
              </Animated.View>
            ))}
          </View>
        ) : null}

        {sections.services.length > 0 && sections.absences.length > 0 ? (
          <View style={{ height: 1, backgroundColor: palette.border }} />
        ) : null}

        {sections.absences.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text
              maxFontSizeMultiplier={TEXT_MAX_SCALE}
              selectable
              style={{ color: palette.textMuted, ...TYPOGRAPHY.overline }}
            >
              ABWESENHEITEN
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {sections.absences.map(({ type, count }) => (
                <View
                  key={type}
                  style={{
                    minWidth: 104,
                    minHeight: 52,
                    flexGrow: 1,
                    flexBasis: 0,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: RADII.control,
                    borderCurve: CORNER_CURVE,
                    backgroundColor: palette.surfaceRaised,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                >
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      backgroundColor: SHIFT_TYPE_COLORS[type],
                    }}
                  />
                  <View style={{ minWidth: 0, flex: 1, gap: 1 }}>
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      selectable
                      style={{
                        color: palette.textSecondary,
                        fontFamily: INTER_FONTS.regular,
                        fontSize: TYPOGRAPHY.caption.fontSize,
                      }}
                    >
                      {SHIFT_TYPE_LABELS[type]}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={TEXT_MAX_SCALE}
                      selectable
                      style={{
                        color: palette.text,
                        ...TYPOGRAPHY.label,
                        fontWeight: "700",
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {count} {count === 1 ? "Tag" : "Tage"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
      <CardFooterLine />
    </SurfaceCard>
  );
}
