import { ShiftAnalysisDetails } from "./shift-analysis-details";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { currentMonth, formatMonthTitle } from "@/engine/calendar";
import { formatMinutes, formatPreciseMinutes } from "@/engine/working-time";
import {
  parseMonthRouteParam,
  parseEnumRouteParam,
  type RouteParam,
} from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { calendarRoute, dayEditorRoute } from "@/navigation/routes";
import { EmptyState, SurfaceCard } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ReportScrollView } from "@/ui/report-layout";
import { AnalysisDetailSummaryCard } from "./analysis-detail-layout";
import { AnalysisCoverageNote } from "./analysis-coverage-note";
import { WorktimeCard } from "./analysis-report-cards";
import { calculateMonthlyAnalysis } from "./monthly-analysis";
import {
  timeAccountActual,
  timeAccountBalance,
  timeAccountCaption,
} from "./special-duty-time-presentation";
import { AnalysisListCard, AnalysisValueRow } from "./analysis-list-card";

export function WorktimeDetailsScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ month?: RouteParam; section?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const parsedSection = parseEnumRouteParam(params.section, ["WORK", "SHIFTS"]);
  const shiftsOnly = parsedSection.status === "valid" && parsedSection.value === "SHIFTS";
  const { profile: savedProfile, calculationProfile } = usePflegeShiftProfile();
  const profile = calculationProfile ?? savedProfile;
  const { entries } = usePflegeShiftEntries();
  const { ready, error, reload } = usePflegeShiftStatus();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { resolver } = useRuleCatalogRuntime();
  const month = parsed.status === "valid" ? parsed.value : currentMonth(profile?.timeZone);
  const data = useMemo(
    () =>
      parsed.status === "valid" && ready && !error && profile
        ? calculateMonthlyAnalysis(
            month,
            entries,
            profile,
            tariffDecisions,
            workPatternSettings,
            resolver,
          )
        : null,
    [
      parsed.status,
      ready,
      error,
      month,
      entries,
      profile,
      tariffDecisions,
      workPatternSettings,
      resolver,
    ],
  );
  if (parsed.status !== "valid" || parsedSection.status === "invalid")
    return (
      <LoadFailureView
        title="Stunden können nicht geöffnet werden"
        message="Der Link enthält keinen gültigen Monat."
        actionLabel="Schließen"
        onRetry={() => router.back()}
      />
    );
  if (ready && error) return <LoadFailureView message={error} onRetry={() => void reload()} />;
  if (!data) return <LoadingView />;
  const { summary, shiftTypeAnalysis } = data;
  if (shiftsOnly)
    return (
      <>
        <Stack.Screen options={{ title: "Schichten" }} />
        <ReportScrollView>
          <AnalysisDetailSummaryCard
            title="Deine Schichten"
            period={formatMonthTitle(month)}
            caption="Anzahl und Stunden pro Schichtart."
          />
          <ShiftAnalysisDetails analysis={shiftTypeAnalysis} creditsAvailable={summary.ok} />
        </ReportScrollView>
      </>
    );
  return (
    <ReportScrollView>
      <Stack.Screen options={{ title: "Stunden" }} />
      <AnalysisDetailSummaryCard title="Deine Stunden" period={formatMonthTitle(month)} />
      <WorktimeCard
        caption={
          summary.ok
            ? (timeAccountCaption(summary.value) ??
              (summary.value.targetCalculation?.status === "PROVISIONAL"
                ? "Sollzeit vorläufig · aus deinen bisherigen Angaben berechnet."
                : undefined))
            : undefined
        }
        actual={
          summary.ok
            ? timeAccountActual(summary.value)
            : formatMinutes(shiftTypeAnalysis.totalMinutes)
        }
        target={summary.ok ? formatMinutes(summary.value.targetMinutes) : "Nicht verfügbar"}
        balance={
          summary.ok
            ? summary.value.specialDutyNotes?.length
              ? "Noch offen"
              : timeAccountBalance(summary.value)
            : "Nicht verfügbar"
        }
        balanceAccent={
          summary.ok && summary.value.timeAccountMinutes !== null
            ? summary.value.balanceMinutes < 0
              ? palette.danger
              : palette.success
            : palette.textMuted
        }
      />
      {summary.ok && summary.value.specialDutyTimeCredits?.length ? (
        <AnalysisListCard
          title="Bereitschaften im Zeitkonto"
          caption="Geplante Gutschriften aus deiner vereinbarten Abgeltung."
        >
          {summary.value.specialDutyTimeCredits.map((line, index) => (
            <AnalysisValueRow
              key={line.shiftId}
              first={index === 0}
              label={`${line.date.slice(8, 10)}.${line.date.slice(5, 7)}. · ${line.title}\n${formatMinutes(line.recordedMinutes)} h geleistet · ${line.settlement === "TIME_OFF" ? "Freizeitausgleich" : line.settlement === "PAY" ? (line.creditedMinutes && line.creditedMinutes > 0 ? "Gesundheitlicher Ausgleich" : "Auszahlung") : "Abgeltung offen"}`}
              value={
                line.creditedMinutes === null
                  ? "Noch offen"
                  : `${formatPreciseMinutes(line.creditedMinutes)} h`
              }
              onPress={() => router.push(dayEditorRoute(line.date, "SHIFT", line.shiftId))}
            />
          ))}
        </AnalysisListCard>
      ) : null}
      {summary.ok && summary.value.specialDutyNotes?.length ? (
        <AnalysisCoverageNote message={summary.value.specialDutyNotes.join(" ")} />
      ) : null}
      {!summary.ok ? (
        <AnalysisCoverageNote message="Für Soll, Saldo und Abwesenheitsgutschriften fehlen Berechnungsgrundlagen." />
      ) : null}
      {shiftTypeAnalysis.totalCount === 0 ? (
        <SurfaceCard>
          <EmptyState
            title="Noch keine Dienste"
            message="Trage Dienste ein, um den Monat auszuwerten."
            action={
              <PrimaryButton onPress={() => router.push(calendarRoute(month))}>
                Kalender öffnen
              </PrimaryButton>
            }
          />
        </SurfaceCard>
      ) : (
        <>
          <ShiftAnalysisDetails analysis={shiftTypeAnalysis} creditsAvailable={summary.ok} />
        </>
      )}
    </ReportScrollView>
  );
}
