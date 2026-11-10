import { incompleteSpecialDuties } from "@/domain/special-duty-review";
import { SpecialDutyReviewRow } from "./special-duty-review-row";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Alert, Pressable, View, useWindowDimensions } from "react-native";
import type { NetPayResult } from "@/domain/net-pay";
import { annualSalaryGrossCents } from "@/domain/annual-salary-payment";
import type { SalaryPaymentContribution, SalaryPaymentProjection } from "@/domain/salary-payment";
import type { AllowanceStatus, MonthlyPayEstimate, UserProfile } from "@/domain/types";
import type { AnnualPaymentForecast } from "@/engine/net-pay-annual-payment";
import type { AutomaticNetPayForecast } from "@/engine/net-pay-automatic-forecast";
import { formatMonthTitle } from "@/engine/calendar";
import { usePflegeShiftTestData } from "@/application/pflegeshift-provider";
import {
  dayEditorRoute,
  netPaySettingsRoute,
  salaryDetailsRoute,
  settingsEditorRoute,
  tariffAssessmentRoute,
} from "@/navigation/routes";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, REPORT_CARD_GAP, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, InlineNotice, SurfaceCard } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";
import { SalaryAmountRow, SalaryNavigationRow, SalarySectionCard } from "./salary-ui";
import { salaryProfileCaption } from "./salary-composition";
import { salaryDeductions } from "./salary-deductions";
import {
  netPayEuro,
  netPayForecastEuro,
  netPayForecastLabel,
  netPayCrossYearLabel,
} from "./net-pay-format";
import { SalaryPayrollSettings } from "./salary-payroll-settings";
import { NetPaySettingsEntry } from "./net-pay-automatic-entry-card";
import { useNetPayProfile } from "./use-net-pay-profile";
import { useAutomaticNetPay } from "./use-automatic-net-pay";
import { useAnnualSalaryForecast } from "./use-annual-salary-forecast";
import {
  AnnualSalaryPaymentEditor,
  annualSalaryPaymentEditorVisible,
} from "./annual-salary-payment-editor";

export type PayrollView = "salary" | "net";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;
const ALLOWANCE_LABELS: Readonly<Record<AllowanceStatus, string>> = {
  NONE: "Schicht-/Wechselschichtzulage",
  SHIFT_MONTHLY: "Ständige Schichtzulage",
  SHIFT_HOURLY: "Nichtständige Schichtzulage",
  ALTERNATING_MONTHLY: "Ständige Wechselschichtzulage",
  ALTERNATING_HOURLY: "Nichtständige Wechselschichtzulage",
};
const VARIABLE = ["PREMIUMS", "MONTHLY_ALLOWANCE", "HOURLY_ALLOWANCE", "OVERTIME", "SPECIAL_DUTY"];

function hasTariff(profile: UserProfile) {
  return !!(
    profile.tariff ||
    profile.vkaETariff ||
    profile.tvlKrTariff ||
    profile.tvhKrTariff ||
    profile.tvUkNursingTariff ||
    profile.nursingTrainingTariff ||
    profile.tvalPflegeTariff
  );
}

function deductionEuro(cents: number) {
  return netPayEuro(cents === 0 ? 0 : -cents);
}

function PayrollDisclosure({
  label,
  value,
  children,
  testID,
}: {
  readonly label: string;
  readonly value?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const palette = usePalette();
  return (
    <View testID={testID}>
      {value !== undefined ? (
        <SalaryAmountRow
          label={label}
          value={value}
          onPress={() => setExpanded(!expanded)}
          expanded={expanded}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={({ pressed }) => ({
            minHeight: MINIMUM_TOUCH_TARGET,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md,
            flexDirection: "row",
            alignItems: "center",
            gap: SPACING.sm,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text, flex: 1, minWidth: 0 }}>
            {label}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={palette.textMuted}
            accessibilityElementsHidden
          />
        </Pressable>
      )}
      {expanded ? children : null}
    </View>
  );
}

function PayrollNote({ children }: { readonly children: ReactNode }) {
  const palette = usePalette();
  return (
    <Text
      style={{
        ...TYPOGRAPHY.small,
        color: palette.textMuted,
        paddingHorizontal: SPACING.lg,
        paddingBottom: SPACING.md,
      }}
    >
      {children}
    </Text>
  );
}

function contributionLabel(part: SalaryPaymentContribution, projection: SalaryPaymentProjection) {
  const source = projection.sources.find((value) => value.month === part.claimMonth)!;
  if (part.group === "MONTHLY_ALLOWANCE" || part.group === "HOURLY_ALLOWANCE")
    return ALLOWANCE_LABELS[
      source.pay.confirmedAllowance ?? source.pay.assessment.suggestedAllowance
    ];
  if (part.group === "PREMIUMS") return "Zeitzuschläge";
  if (part.group === "OVERTIME") return "Überstunden";
  return "Bereitschaftsvergütung";
}

export function SalaryPayrollStatement({
  view = "salary",
  month,
  profile,
  pay,
  projection,
  net,
  annualGrossCents,
  additionalGrossCents,
  annualPayment,
  pensionOmitted = false,
  payrollTimingEstimate,
  blocked = false,
  onReviewAllowance,
  afterStatement,
}: {
  readonly view?: PayrollView;
  readonly month: string;
  readonly profile: UserProfile;
  readonly pay: MonthlyPayEstimate;
  readonly projection: SalaryPaymentProjection;
  readonly net: AvailablePay | null;
  readonly annualGrossCents: number;
  readonly additionalGrossCents: number;
  readonly annualPayment?: AnnualPaymentForecast;
  readonly pensionOmitted?: boolean;
  readonly payrollTimingEstimate?: AutomaticNetPayForecast["payrollTimingEstimate"];
  readonly blocked?: boolean;
  readonly onReviewAllowance: (months: readonly string[]) => void;
  readonly afterStatement?: ReactNode;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.4;
  const available = blocked || !pay.available ? null : net;
  const fullAnnual = pay.available
    ? (annualPayment?.grossCents ?? annualGrossCents)
    : annualGrossCents;
  const partial = !pay.available && pay.knownGrossAmount !== undefined;
  const monthlyGross = pay.estimatedGrossAmount ?? pay.knownGrossAmount ?? null;
  const gross =
    (pay.available ? annualPayment?.totalGrossCents : null) ??
    available?.amounts.grossCents ??
    (monthlyGross === null
      ? null
      : Math.round(monthlyGross * 100) + additionalGrossCents + fullAnnual);
  const deductions = available ? salaryDeductions(available) : null;
  const netLabel =
    annualPayment && !annualPayment.netIncluded
      ? "Netto ohne Jahressonderzahlung"
      : pensionOmitted
        ? "Netto vor Zusatzversorgung"
        : "Netto geschätzt";
  const baseLabel =
    profile.nursingTrainingTariff || profile.tvalPflegeTariff
      ? "Ausbildungsentgelt"
      : profile.manualMonthlyGrossCents != null && !hasTariff(profile)
        ? "Monatsbrutto"
        : "Grundentgelt";
  const fixed = [
    {
      label: baseLabel,
      value: pay.personalBaseAmount === null ? null : Math.round(pay.personalBaseAmount * 100),
    },
    ...(pay.careAllowanceAmount > 0
      ? [
          {
            label: profile.tvhKrTariff
              ? "Pflegezulage TV-H"
              : profile.tvUkNursingTariff
                ? "Pflegezulage TV-UK"
                : profile.tvlKrTariff
                  ? "Pflegezulage TV-L"
                  : "Pflegezulage TVöD-P",
            value: Math.round(pay.careAllowanceAmount * 100),
          },
        ]
      : []),
    ...(pay.tvoedAllowanceAmount > 0
      ? [{ label: "TVöD-Zulage", value: Math.round(pay.tvoedAllowanceAmount * 100) }]
      : []),
    ...(additionalGrossCents > 0
      ? [{ label: "Weitere feste monatliche Zulage", value: additionalGrossCents }]
      : []),
  ];
  const parts = projection.contributions.filter((part) => VARIABLE.includes(part.group));
  const months = [...new Set(parts.map((part) => part.claimMonth))].sort();
  const allowanceParts = parts.filter(
    (part) => part.group === "MONTHLY_ALLOWANCE" || part.group === "HOURLY_ALLOWANCE",
  );
  const positiveAllowance = allowanceParts.filter((part) => part.amountCents > 0);
  const allowanceMonths = [
    ...new Set(
      (positiveAllowance.length ? positiveAllowance : allowanceParts).map(
        (part) => part.claimMonth,
      ),
    ),
  ].sort();
  return (
    <>
      <SurfaceCard>
        <View
          testID="salary-payroll-totals"
          style={{
            flexDirection: stacked ? "column" : "row",
            gap: SPACING.lg,
            padding: SPACING.lg,
          }}
        >
          {(view === "salary"
            ? [{ label: partial ? "Bekanntes Brutto" : "Gesamtbrutto", amount: gross }]
            : [{ label: netLabel, amount: available?.netCents ?? null }]
          ).map((total) => (
            <View
              key={total.label}
              accessible
              accessibilityLabel={`${total.label}: ${total.amount === null ? "Nicht verfügbar" : total.label === netLabel && available ? netPayForecastEuro(available) : netPayEuro(total.amount)}`}
              style={{ flex: 1, minWidth: 0, gap: SPACING.xs }}
            >
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>{total.label}</Text>
              <Text
                selectable
                style={{
                  ...TYPOGRAPHY.screenTitle,
                  color: palette.text,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {total.amount === null
                  ? "Noch offen"
                  : total.label === netLabel && available
                    ? netPayForecastEuro(available)
                    : netPayEuro(total.amount)}
              </Text>
            </View>
          ))}
        </View>
        {view === "net" && available && netPayForecastLabel(available) ? (
          <PayrollNote>{netPayForecastLabel(available)}</PayrollNote>
        ) : null}
        {view === "net" && available && netPayCrossYearLabel(payrollTimingEstimate) ? (
          <PayrollNote>{netPayCrossYearLabel(payrollTimingEstimate)}</PayrollNote>
        ) : null}
      </SurfaceCard>
      <View testID="salary-payroll-statement" style={{ gap: REPORT_CARD_GAP }}>
        {view === "salary" ? (
          <SalarySectionCard title="Zusammensetzung">
            <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.md }}>
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                {formatMonthTitle(month)}
                {salaryProfileCaption(profile) ? ` · ${salaryProfileCaption(profile)}` : ""}
              </Text>
            </View>
            {fixed.map((row, index) => (
              <View key={row.label}>
                {index ? <CardSeparator /> : null}
                <SalaryAmountRow
                  label={row.label}
                  value={row.value === null ? "Noch offen" : netPayEuro(row.value)}
                  quiet
                />
              </View>
            ))}
            {months.map((claimMonth) => {
              const source = projection.sources.find((value) => value.month === claimMonth)!;
              const sourceParts = parts.filter((part) => part.claimMonth === claimMonth);
              const open = sourceParts.some((part) =>
                projection.issues.some(
                  (issue) => issue.month === claimMonth && issue.group === part.group,
                ),
              );
              const visible = sourceParts.filter((part) => part.amountCents > 0);
              const openParts = sourceParts.filter(
                (part) =>
                  part.amountCents === 0 &&
                  projection.issues.some(
                    (issue) => issue.month === claimMonth && issue.group === part.group,
                  ),
              );
              if (!visible.length && !open) return null;
              return (
                <View key={claimMonth}>
                  <CardSeparator />
                  <Text
                    style={{
                      ...TYPOGRAPHY.small,
                      color: palette.textMuted,
                      paddingHorizontal: SPACING.lg,
                      paddingTop: SPACING.lg,
                    }}
                  >
                    Zulagen aus {formatMonthTitle(claimMonth)}
                  </Text>
                  {visible.map((part, index) => (
                    <View key={part.group}>
                      {index ? <CardSeparator /> : null}
                      <SalaryAmountRow
                        label={contributionLabel(part, projection)}
                        value={netPayEuro(part.amountCents)}
                        subtitle={
                          part.group === "MONTHLY_ALLOWANCE" || part.group === "HOURLY_ALLOWANCE"
                            ? projection.issues.some(
                                (issue) => issue.month === claimMonth && issue.group === part.group,
                              )
                              ? "Prüfung offen"
                              : source.pay.confirmedAllowance === null
                                ? "Geschätzt"
                                : "Monatsangabe gespeichert"
                            : undefined
                        }
                        quiet
                      />
                    </View>
                  ))}
                  {openParts.length ? (
                    <>
                      {visible.length ? <CardSeparator /> : null}
                      <SalaryAmountRow
                        label={
                          openParts.length === 1 && openParts[0].group === "SPECIAL_DUTY"
                            ? "Bereitschaftsvergütung"
                            : "Weitere Zulagen"
                        }
                        value="Noch offen"
                        quiet
                      />
                    </>
                  ) : null}
                </View>
              );
            })}
            {!blocked && hasTariff(profile) ? (
              <>
                <CardSeparator />
                <SalaryNavigationRow
                  title="Zulage prüfen"
                  subtitle={
                    allowanceMonths.length === 1
                      ? `Anspruch ${formatMonthTitle(allowanceMonths[0])}`
                      : "Anspruchsmonat auswählen"
                  }
                  onPress={() =>
                    onReviewAllowance(allowanceMonths.length ? allowanceMonths : [month])
                  }
                />
              </>
            ) : null}
            <SpecialDutyReviewRow duties={incompleteSpecialDuties(pay)} disabled={blocked} />
            {fullAnnual > 0 ? (
              <>
                <CardSeparator />
                <SalaryAmountRow label="Jahressonderzahlung" value={netPayEuro(fullAnnual)} quiet />
              </>
            ) : null}
            <CardSeparator />
            <SalaryAmountRow
              label={partial ? "Bekanntes Brutto" : "Gesamtbrutto"}
              value={gross === null ? "Noch offen" : netPayEuro(gross)}
              quiet
              emphasizeValue
            />
          </SalarySectionCard>
        ) : null}
        {view === "net" ? (
          <SalarySectionCard title="Netto-Berechnung">
            <SalaryAmountRow
              label={partial ? "Bekanntes Brutto" : "Gesamtbrutto"}
              value={gross === null ? "Noch offen" : netPayEuro(gross)}
              quiet
            />
            <CardSeparator />
            <SpecialDutyReviewRow duties={incompleteSpecialDuties(pay)} disabled={blocked} />
            {annualPayment && !annualPayment.netIncluded && available ? (
              <>
                <PayrollNote>
                  Jahressonderzahlung im Brutto enthalten; die Netto-Berechnung dafür ist noch
                  offen.
                </PayrollNote>
                <SalaryAmountRow
                  label="Brutto für Netto-Prognose"
                  value={netPayEuro(available.amounts.grossCents)}
                  quiet
                />
              </>
            ) : null}
            {deductions ? (
              <SalaryAmountRow
                label="Abzüge"
                value={deductionEuro(deductions.totalCents)}
                onPress={() => router.push(salaryDetailsRoute(month, "deductions"))}
                chevronPlacement="label"
                quiet
              />
            ) : (
              <SalaryAmountRow label="Abzüge" value="Nicht verfügbar" quiet />
            )}
            <CardSeparator />
            <SalaryAmountRow
              label={netLabel}
              value={available ? netPayForecastEuro(available) : "Nicht verfügbar"}
              quiet
              emphasizeValue
            />
            {pensionOmitted ? (
              <PayrollNote>Zusatzversorgung nicht berücksichtigt.</PayrollNote>
            ) : null}
            {annualPayment?.pensionOmitted ? (
              <PayrollNote>
                Zusatzversorgung auf die Jahressonderzahlung nicht berücksichtigt.
              </PayrollNote>
            ) : null}
          </SalarySectionCard>
        ) : null}
        {afterStatement ? <SurfaceCard>{afterStatement}</SurfaceCard> : null}
      </View>
    </>
  );
}

export function SalaryPayrollContent({
  view = "salary",
  month,
  blocked,
  profile,
  pay,
  projection,
  onDirtyChange,
  onBusyChange,
}: {
  readonly view?: PayrollView;
  readonly month: string;
  readonly blocked: boolean;
  readonly profile: UserProfile;
  readonly pay: MonthlyPayEstimate;
  readonly projection: SalaryPaymentProjection;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const { testMonths } = usePflegeShiftTestData();
  const data = useNetPayProfile(month, !blocked);
  const settings = data.saved?.settings ?? null;
  const configured = settings?.version === 2;
  const annual = useAnnualSalaryForecast(
    Number(month.slice(0, 4)),
    data.annualPayments,
    !blocked && data.status === "ready",
    testMonths,
  );
  const forecast = useAutomaticNetPay(
    month,
    settings,
    !blocked && configured && data.status === "ready",
    testMonths,
    data.timeline,
  );
  const net = forecast?.result.status === "available" ? forecast.result.pay : null;
  function reviewAllowance(months: readonly string[]) {
    if (months.length === 1) router.push(tariffAssessmentRoute(months[0]));
    else
      Alert.alert("Anspruchsmonat wählen", "Welche Zulagenangabe möchtest du prüfen?", [
        ...months.map((claimMonth) => ({
          text: formatMonthTitle(claimMonth),
          onPress: () => router.push(tariffAssessmentRoute(claimMonth)),
        })),
        { text: "Abbrechen", style: "cancel" },
      ]);
  }
  const recovery = forecast?.recovery;
  function recover() {
    if (recovery?.kind === "entry")
      router.push(dayEditorRoute(recovery.date, "SHIFT", recovery.entryId));
    else if (recovery?.kind === "profile") router.push(settingsEditorRoute(recovery.section));
    else if (recovery?.kind === "net-settings")
      router.push(netPaySettingsRoute(recovery.month ?? month));
  }
  const hasBasis = !!(
    profile.tariff ||
    profile.vkaETariff ||
    profile.tvlKrTariff ||
    profile.tvhKrTariff ||
    profile.tvUkNursingTariff ||
    profile.nursingTrainingTariff ||
    profile.tvalPflegeTariff ||
    profile.manualMonthlyGrossCents != null
  );
  const netNotice = blocked
    ? "Für Testdaten gibt es keine Netto-Prognose."
    : data.status === "loading"
      ? "Netto-Angaben werden geladen …"
      : data.status === "error"
        ? data.error
        : !configured
          ? "Ergänze deine Netto-Angaben über die Einstellungskarte."
          : forecast?.result.status === "unavailable"
            ? forecast.result.reason
            : null;
  const notice =
    view === "net"
      ? netNotice
      : blocked
        ? null
        : data.status === "loading"
          ? "Weitere Bezüge werden geladen …"
          : data.status === "error"
            ? "Weitere Bezüge konnten nicht geladen werden. Die Gehaltsübersicht ist unvollständig."
            : null;
  return (
    <>
      {view === "net" && !blocked && data.status === "ready" ? (
        settings ? (
          <NetPaySettingsEntry
            settings={settings}
            disabled={data.busy}
            onPress={() => router.push(netPaySettingsRoute(month))}
          />
        ) : (
          <SalaryNavigationRow
            title="Netto-Einstellungen"
            subtitle="Netto einrichten"
            onPress={() => router.push(netPaySettingsRoute(month))}
          />
        )
      ) : null}
      {view === "salary" ? (
        <SalaryPayrollSettings
          timingOnly
          month={month}
          blocked={blocked}
          onChanged={data.reload}
          onDirtyChange={onDirtyChange}
          onBusyChange={onBusyChange}
        />
      ) : null}
      {!hasBasis ? (
        <>
          <InlineNotice message="Hinterlege einen Tarif oder dein Monatsbrutto." />
          <SecondaryButton onPress={() => router.push(settingsEditorRoute("TARIFF"))}>
            Gehalt einrichten
          </SecondaryButton>
        </>
      ) : null}
      {view === "salary" &&
      hasBasis &&
      pay.available &&
      hasTariff(profile) &&
      projection.sources.every((source) => source.shifts.length === 0) ? (
        <PayrollNote>
          Noch keine Dienste in diesem Monat. Grundentgelt und bekannte Monatsbezüge bleiben
          sichtbar.
        </PayrollNote>
      ) : null}
      {notice ? (
        <View style={{ gap: SPACING.sm }}>
          <InlineNotice message={notice} />
          {data.status === "error" ? (
            <SecondaryButton onPress={data.reload}>Erneut laden</SecondaryButton>
          ) : null}
          {view === "net" && recovery && !blocked ? (
            <SecondaryButton onPress={recover}>
              {recovery.kind === "entry"
                ? "Dienstzeiten prüfen"
                : recovery.kind === "profile"
                  ? "Gehaltsangaben prüfen"
                  : "Netto-Angaben ergänzen"}
            </SecondaryButton>
          ) : null}
        </View>
      ) : null}
      <SalaryPayrollStatement
        view={view}
        month={month}
        profile={profile}
        pay={pay}
        projection={projection}
        net={net}
        annualGrossCents={annualSalaryGrossCents(month, annual.payments)}
        additionalGrossCents={settings?.automation?.additionalRecurringGrossCents ?? 0}
        annualPayment={forecast?.annualPayment}
        pensionOmitted={forecast?.pensionOmitted ?? false}
        payrollTimingEstimate={forecast?.payrollTimingEstimate}
        blocked={blocked}
        onReviewAllowance={reviewAllowance}
        afterStatement={
          configured &&
          settings &&
          !blocked &&
          annualSalaryPaymentEditorVisible(month, profile, annual.payments) ? (
            <PayrollDisclosure label="Jahressonderzahlung bearbeiten">
              <AnnualSalaryPaymentEditor
                embedded
                key={`${month}:${settings.month}:${data.saved?.revision}`}
                month={month}
                profile={profile}
                settings={settings}
                busy={data.busy}
                onSave={data.save}
                forecastPayments={annual.payments}
                proposal={annual.proposal}
                issue={annual.issue}
                automatic={annual.automatic}
                onResetAutomatic={data.resetAnnualPayments}
              />
            </PayrollDisclosure>
          ) : null
        }
      />
    </>
  );
}
