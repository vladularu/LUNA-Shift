import { router } from "expo-router";
import { Text } from "@/ui/text";
import { Pressable, View } from "react-native";
import Ionicons from "@/ui/icon";
import { NET_PAY_PENSION_LABELS } from "@/domain/net-pay-pension-schemes";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { usePflegeShiftProfile, usePflegeShiftTestData } from "@/application/pflegeshift-provider";
import { useAnnualSalaryForecast } from "./use-annual-salary-forecast";
import {
  dayEditorRoute,
  netPaySettingsRoute,
  salaryDetailsRoute,
  settingsEditorRoute,
  tariffAssessmentRoute,
} from "@/navigation/routes";
import { RADII, SPACING } from "@/theme/tokens";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, SurfaceCard } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { NetPayText } from "./net-pay-controls";
import { NetPaySalarySummary, NetPaySummaryMetric } from "./net-pay-salary-summary";
import { AnnualSalaryPaymentEditor } from "./annual-salary-payment-editor";
import { annualSalaryGrossCents } from "@/domain/annual-salary-payment";
import { useNetPayProfile } from "./use-net-pay-profile";
import { useAutomaticNetPay } from "./use-automatic-net-pay";
import { NetPayWorkflowAction, NetPayWorkflowText } from "./net-pay-workflow-controls";
import { SalaryNavigationRow, SalaryPremiumCard, SalarySectionCard } from "./salary-ui";

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
  const openSettings = () => router.push(netPaySettingsRoute(month));
  const components = () => router.push(salaryDetailsRoute(month, "components"));
  const premiums = () => router.push(salaryDetailsRoute(month, "premiums"));
  const showServices = available !== null || showPremiumDetails;
  const showComponentsLink = available === null && proposedGrossCents === null;
  const showPremiumsLink = available === null && showServices && premiumCents === undefined;
  const showSettingsEntry = configured && !blocked && data.status === "ready";
  const showAllowanceLink =
    !blocked &&
    !!(
      profile?.tariff ||
      profile?.vkaETariff ||
      profile?.tvlKrTariff ||
      profile?.tvUkNursingTariff ||
      profile?.tvhKrTariff ||
      profile?.tvalPflegeTariff ||
      profile?.nursingTrainingTariff
    );
  const showBasisLink = !blocked && (available !== null || proposedGrossCents !== null);
  const recovery =
    forecast?.recovery ??
    (forecast?.result.status === "unavailable" && forecast.result.stage === "net-pay"
      ? { kind: "net-settings" as const }
      : null);
  function recover() {
    if (recovery?.kind === "entry")
      router.push(dayEditorRoute(recovery.date, "SHIFT", recovery.entryId));
    else if (recovery?.kind === "profile") router.push(settingsEditorRoute(recovery.section));
    else if (recovery?.kind === "net-settings") openSettings();
  }
  const settingsEntry =
    showSettingsEntry && settings ? (
      <NetPaySettingsEntry settings={settings} disabled={data.busy} onPress={openSettings} />
    ) : null;
  return (
    <>
      <View style={{ gap: SPACING.lg }}>
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
            afterSummary={settingsEntry}
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
                  <NetPayWorkflowAction onPress={openSettings} disabled={data.busy}>
                    Netto einmal einrichten
                  </NetPayWorkflowAction>
                  <NetPayWorkflowText>
                    Alle Angaben auf einer Seite – danach automatisch.
                  </NetPayWorkflowText>
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
            {settingsEntry}
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
            onResetAutomatic={data.resetAnnualPayments}
          />
        ) : null}
        {showComponentsLink || showPremiumsLink || showAllowanceLink || showBasisLink ? (
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
            {showAllowanceLink ? (
              <>
                {showComponentsLink || showPremiumsLink ? <CardSeparator /> : null}
                <SalaryNavigationRow
                  title="Zulage prüfen"
                  onPress={() => router.push(tariffAssessmentRoute(month))}
                />
              </>
            ) : null}
            {showBasisLink ? (
              <>
                {showComponentsLink || showPremiumsLink || showAllowanceLink ? (
                  <CardSeparator />
                ) : null}
                <SalaryNavigationRow
                  title="Berechnungsgrundlagen"
                  onPress={() => router.push(salaryDetailsRoute(month, "basis"))}
                />
              </>
            ) : null}
          </SalarySectionCard>
        ) : null}
        <Text style={{ textAlign: "center", color: palette.textMuted, ...TYPOGRAPHY.footnote }}>
          Prognose aus deinem geplanten Dienstplan.
        </Text>
      </View>
    </>
  );
}

function NetPaySettingsEntry({
  settings,
  disabled,
  onPress,
}: {
  readonly settings: MonthlyNetPaySettings;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const palette = usePalette();
  const p = settings.profile;
  const family = p.isParent
    ? p.childrenUnder25 === 0
      ? "Kinder · keine unter 25"
      : `${p.childrenUnder25} ${p.childrenUnder25 === 1 ? "Kind" : "Kinder"} unter 25`
    : "Keine Kinder";
  const insurance = settings.specialCases?.includes("PRIVATE_INSURANCE")
    ? "privat versichert"
    : settings.specialCases?.includes("OTHER_INSURANCE_STATUS")
      ? "abweichender Versicherungsstatus"
      : "gesetzlich versichert";
  const pension = NET_PAY_PENSION_LABELS[settings.automation?.pensionScheme ?? "UNKNOWN"];
  return (
    <Pressable
      testID="net-pay-settings-entry"
      accessibilityRole="button"
      accessibilityLabel={`Netto-Einstellungen. Steuerklasse ${p.taxClass} · ${p.churchTaxRatePercent ? "mit" : "ohne"} Kirchensteuer. ${family} · ${insurance}. ${pension}. Angaben ansehen und ändern.`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: SPACING.lg,
        gap: SPACING.sm,
        borderWidth: 1,
        borderColor: palette.primary,
        borderRadius: RADII.card,
        borderCurve: "continuous",
        backgroundColor: palette.primarySoft,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
        <Text style={{ flex: 1, color: palette.text, ...TYPOGRAPHY.sectionTitle }}>
          Netto-Einstellungen
        </Text>
        <Ionicons
          accessibilityElementsHidden
          name="chevron-forward"
          size={20}
          color={palette.primary}
        />
      </View>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
        Klasse {p.taxClass}
        {p.factorPermille === null ? "" : " mit Faktor"} · {p.churchTaxRatePercent ? "mit" : "ohne"}{" "}
        Kirchensteuer
      </Text>
      <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}>
        {family} · {insurance}
      </Text>
      <Text style={{ color: palette.primary, ...TYPOGRAPHY.label }}>Angaben ansehen & ändern</Text>
    </Pressable>
  );
}
