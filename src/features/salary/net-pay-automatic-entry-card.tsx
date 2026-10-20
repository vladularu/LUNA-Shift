import { useState } from "react";
import { router } from "expo-router";
import { Text } from "@/ui/text";
import { View } from "react-native";
import { usePflegeShiftProfile, usePflegeShiftTestData } from "@/application/pflegeshift-provider";
import { useAnnualSalaryForecast } from "./use-annual-salary-forecast";
import { dayEditorRoute, salaryDetailsRoute, settingsEditorRoute } from "@/navigation/routes";
import { SPACING } from "@/theme/tokens";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, SurfaceCard } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { NetPayText } from "./net-pay-controls";
import { NetPaySalarySummary, NetPaySummaryMetric } from "./net-pay-salary-summary";
import { AnnualSalaryPaymentEditor } from "./annual-salary-payment-editor";
import { annualSalaryGrossCents } from "@/domain/annual-salary-payment";
import { NetPaySheet } from "./net-pay-sheet";
import { NetPaySetupForm } from "./net-pay-setup-form";
import { useNetPayProfile } from "./use-net-pay-profile";
import { useAutomaticNetPay } from "./use-automatic-net-pay";
import { NetPayWorkflowAction, NetPayWorkflowText } from "./net-pay-workflow-controls";
import { SalaryNavigationRow, SalaryPremiumCard, SalarySectionCard } from "./salary-ui";

type Dialog = "setup" | "settings";
const TITLES: Record<Dialog, string> = {
  setup: "Netto einrichten",
  settings: "Meine Netto-Angaben",
};

export function NetPayAutomaticEntryCard({
  month,
  proposedGrossCents,
  blocked,
  caption,
  showPremiumDetails = false,
  premiumCents,
}: {
  readonly month: string;
  readonly proposedGrossCents: number | null;
  readonly blocked: boolean;
  readonly caption?: string;
  readonly showPremiumDetails?: boolean;
  readonly premiumCents?: number;
}) {
  const palette = usePalette();
  const { profile } = usePflegeShiftProfile();
  const { testMonths } = usePflegeShiftTestData();
  const data = useNetPayProfile(month, !blocked);
  const annual = useAnnualSalaryForecast(
    Number(month.slice(0, 4)),
    data.annualPayments,
    !blocked && data.status === "ready",
    testMonths,
  );
  const settings = data.saved?.settings ?? null;
  const configured = settings?.version === 2;
  const forecast = useAutomaticNetPay(
    month,
    settings,
    configured && !blocked && data.status === "ready",
    testMonths,
  );
  const available = forecast?.result.status === "available" ? forecast.result : null;
  const [dialog, setDialog] = useState<{ month: string; view: Dialog } | null>(null);
  const view = dialog?.month === month && !blocked && data.status === "ready" ? dialog.view : null;
  function open(next: Dialog) {
    setDialog({ month, view: next });
  }
  function close() {
    if (!data.busy) setDialog(null);
  }
  const components = () => router.push(salaryDetailsRoute(month, "components"));
  const premiums = () => router.push(salaryDetailsRoute(month, "premiums"));
  const showServices = available !== null || showPremiumDetails;
  const showComponentsLink = available === null && proposedGrossCents === null;
  const showPremiumsLink = available === null && showServices && premiumCents === undefined;
  const showSettingsLink = configured && !blocked && data.status === "ready";
  const recovery =
    forecast?.recovery ??
    (forecast?.result.status === "unavailable" && forecast.result.stage === "net-pay"
      ? { kind: "net-settings" as const }
      : null);
  function recover() {
    if (recovery?.kind === "entry")
      router.push(dayEditorRoute(recovery.date, "SHIFT", recovery.entryId));
    else if (recovery?.kind === "profile") router.push(settingsEditorRoute(recovery.section));
    else if (recovery?.kind === "net-settings") open("settings");
  }
  const summary = configured
    ? `Steuerklasse ${settings.profile.taxClass} · ${settings.profile.churchTaxRatePercent ? "mit" : "ohne"} Kirchensteuer${forecast?.pensionOmitted ? " · Zusatzversorgung nicht berücksichtigt" : ""}`
    : "Einmal einrichten · danach automatisch";
  return (
    <>
      <View
        accessibilityElementsHidden={view !== null}
        importantForAccessibility={view !== null ? "no-hide-descendants" : "auto"}
        style={{ gap: SPACING.lg }}
      >
        {available ? (
          <NetPaySalarySummary
            pay={available.pay}
            pensionOmitted={forecast!.pensionOmitted ?? false}
            annualPayment={forecast?.annualPayment}
            premiums={available.classification}
            caption={caption}
            onGross={components}
            onDeductions={() => router.push(salaryDetailsRoute(month, "deductions"))}
            onPremiums={premiums}
          />
        ) : (
          <>
            <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
              {caption ? (
                <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>{caption}</Text>
              ) : null}
              {proposedGrossCents !== null ? (
                <NetPaySummaryMetric
                  label="Gesamtbrutto"
                  cents={
                    proposedGrossCents +
                    (settings?.automation?.additionalRecurringGrossCents ?? 0) +
                    annualSalaryGrossCents(month, annual.payments)
                  }
                  onPress={components}
                  large
                />
              ) : null}
              {blocked ? (
                <NetPayText>Für Testdaten gibt es keine Netto-Prognose.</NetPayText>
              ) : data.status === "loading" ? (
                <NetPayText>Netto-Angaben werden geladen …</NetPayText>
              ) : data.status === "error" ? (
                <>
                  <FormStatus error={data.error} />
                  <SecondaryButton onPress={data.reload}>Erneut laden</SecondaryButton>
                </>
              ) : !configured ? (
                <>
                  <NetPayWorkflowText>
                    Gehalt und Dienste sind übernommen. Richte dein Netto einmalig ein.
                  </NetPayWorkflowText>
                  <NetPayWorkflowAction onPress={() => open("setup")} disabled={data.busy}>
                    Netto einmal einrichten
                  </NetPayWorkflowAction>
                  <NetPayWorkflowText>Drei kurze Schritte – danach automatisch.</NetPayWorkflowText>
                </>
              ) : (
                <>
                  <NetPayText>
                    {forecast?.result.status === "unavailable"
                      ? forecast.result.reason
                      : "Netto wird berechnet …"}
                  </NetPayText>
                  {forecast?.result.status === "unavailable" && recovery ? (
                    <SecondaryButton onPress={recover}>
                      {recovery.kind === "entry"
                        ? "Dienstzeiten prüfen"
                        : recovery.kind === "net-settings"
                          ? "Netto-Angaben prüfen"
                          : recovery.section === "WORK"
                            ? "Arbeitsprofil prüfen"
                            : "Gehaltsangaben prüfen"}
                    </SecondaryButton>
                  ) : null}
                </>
              )}
            </SurfaceCard>
            {showServices && premiumCents !== undefined ? (
              <SalaryPremiumCard
                totalCents={premiumCents}
                taxFreeCents={null}
                onPress={premiums}
                grouped
              />
            ) : null}
          </>
        )}
        {configured && settings && profile && !blocked && data.status === "ready" ? (
          <AnnualSalaryPaymentEditor
            key={`${month}:${settings.month}:${data.saved?.revision}:${JSON.stringify(settings.automation?.annualPayments)}`}
            month={month}
            profile={profile}
            settings={settings}
            busy={data.busy}
            onSave={data.save}
            forecastPayments={annual.payments}
            proposal={annual.proposal}
            automatic={annual.automatic}
          />
        ) : null}
        {showComponentsLink || showPremiumsLink || showSettingsLink ? (
          <SalarySectionCard title="Details">
            {showComponentsLink ? (
              <SalaryNavigationRow title="Gehaltsbestandteile" onPress={components} />
            ) : null}
            {showPremiumsLink ? (
              <>
                {showComponentsLink ? <CardSeparator /> : null}
                <SalaryNavigationRow title="Zeitzuschläge" onPress={premiums} />
              </>
            ) : null}
            {showSettingsLink ? (
              <>
                {showComponentsLink || showPremiumsLink ? <CardSeparator /> : null}
                <SalaryNavigationRow
                  title="Netto-Angaben"
                  subtitle={summary}
                  onPress={() => open("settings")}
                  disabled={data.busy}
                />
              </>
            ) : null}
          </SalarySectionCard>
        ) : null}
        <Text style={{ textAlign: "center", color: palette.textMuted, ...TYPOGRAPHY.footnote }}>
          Prognose aus deinem geplanten Dienstplan.
        </Text>
      </View>
      {view ? (
        <NetPaySetupForm
          key={`${month}:${view}`}
          month={month}
          initial={settings}
          firstSetup={data.timeline.length === 0}
          allowSectionSwitch={view === "settings"}
          worksInSaxony={profile?.federalState === "SN"}
          churchTaxDefaultPercent={
            profile?.federalState === "BY" || profile?.federalState === "BW" ? 8 : 9
          }
          busy={data.busy}
          renderLayout={({ content, footer, onBack, locked, editing, page }) => (
            <NetPaySheet
              title={editing ? "Angaben ändern" : TITLES[view]}
              visible
              busy={locked}
              onClose={close}
              onBack={onBack}
              backLabel={
                view === "settings" ? "Zurück zur Angaben-Übersicht" : "Vorheriger Schritt"
              }
              footer={footer}
              contentKey={`${view}:${page}`}
            >
              {settings?.version === 1 && view === "setup" ? (
                <NetPayText>
                  Deine bisherigen Angaben gelten nur für diesen Monat. Nach dem Speichern werden
                  sie auch für folgende Monate übernommen.
                </NetPayText>
              ) : null}
              {content}
            </NetPaySheet>
          )}
          onSave={async (value, effectiveMonth) => {
            await data.save(value, effectiveMonth);
            if (view === "setup")
              setDialog((current) => (current?.month === value.month ? null : current));
          }}
        />
      ) : null}
    </>
  );
}
