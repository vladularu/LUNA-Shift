import { router } from "expo-router";
import { View, useWindowDimensions } from "react-native";
import { Text } from "@/ui/text";
import type { MonthlyPayEstimate, UserProfile } from "@/domain/types";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { NetPayResult } from "@/domain/net-pay";
import { annualSalaryGrossCents } from "@/domain/annual-salary-payment";
import type { AnnualSalaryPayment } from "@/domain/annual-salary-payment";
import type { AnnualPaymentForecast } from "@/engine/net-pay-annual-payment";
import { CardSeparator, RowButton, SurfaceCard } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { settingsInfoRoute } from "@/navigation/routes";
import { salaryComposition } from "./salary-composition";
import { SalaryAmountRow, SalarySectionCard } from "./salary-ui";
import { netPayEuro, netPayForecastEuro, netPayForecastLabel } from "./net-pay-format";
import { NetPayPremiumExplanation } from "./net-pay-premium-details";
import type { SalaryClassification } from "./salary-service-presentation";

type AvailablePay = Extract<NetPayResult, { status: "available" }>;

export function SalaryComponentsView({
  month,
  profile,
  pay,
  net,
  settings,
  pensionOmitted,
  annualPayment,
  annualPayments,
}: {
  readonly month: string;
  readonly profile: UserProfile;
  readonly pay: MonthlyPayEstimate;
  readonly net: AvailablePay | null;
  readonly settings: MonthlyNetPaySettings | null;
  readonly pensionOmitted: boolean;
  readonly annualPayment?: AnnualPaymentForecast;
  readonly annualPayments?: readonly AnnualSalaryPayment[];
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { caption, compositionRows } = salaryComposition(profile, pay);
  const extra = settings?.automation?.additionalRecurringGrossCents ?? 0;
  const annualGross = annualSalaryGrossCents(
    month,
    annualPayments ?? settings?.automation?.annualPayments,
  );
  const gross =
    pay.estimatedGrossAmount === null
      ? null
      : Math.round(pay.estimatedGrossAmount * 100) + extra + annualGross;
  return (
    <>
      <SalarySectionCard title="Gesamtbrutto">
        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Text
            accessible
            accessibilityLabel={`Gesamtbrutto: ${gross === null ? "Nicht verfügbar" : netPayEuro(gross)}`}
            style={{
              ...(width < 360 ? TYPOGRAPHY.hero : TYPOGRAPHY.salaryHero),
              color: palette.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {gross === null ? "Nicht verfügbar" : netPayEuro(gross).replaceAll("\u00a0", " ")}
          </Text>
          {caption ? (
            <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>{caption}</Text>
          ) : null}
          <View style={{ height: 1, backgroundColor: palette.separator }} />
        </View>
      </SalarySectionCard>
      <SalarySectionCard title="Zusammensetzung">
        {pay.available ? (
          compositionRows.map((row, index) => (
            <View key={row.label}>
              {index ? <CardSeparator /> : null}
              <SalaryAmountRow label={row.label} value={row.value} subtitle={row.subtitle} quiet />
            </View>
          ))
        ) : (
          <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted, padding: SPACING.lg }}>
            Für diesen Monat fehlen Tarifdaten.
          </Text>
        )}
        {extra > 0 ? (
          <>
            <CardSeparator />
            <SalaryAmountRow
              label="Weitere feste monatliche Zulage"
              value={netPayEuro(extra)}
              quiet
            />
          </>
        ) : null}
        {annualGross > 0 ? (
          <>
            <CardSeparator />
            <SalaryAmountRow label="Jahressonderzahlung" value={netPayEuro(annualGross)} quiet />
          </>
        ) : null}
      </SalarySectionCard>
      {(pay.nightCompensatoryMinutes ?? 0) > 0 ? (
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
          Zusätzlich{" "}
          {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(
            pay.nightCompensatoryMinutes!,
          )}{" "}
          Min. Freizeitausgleich für Nachtarbeit.
        </Text>
      ) : null}
      <SalarySectionCard title="Netto-Berechnung">
        <SalaryAmountRow
          label="Abzüge"
          value={net ? netPayEuro(-(net.amounts.grossCents - net.netCents)) : "Nicht verfügbar"}
          quiet
        />
        {net ? (
          <>
            <CardSeparator />
            <SalaryAmountRow
              label={
                annualPayment && !annualPayment.netIncluded
                  ? "Netto ohne Sonderzahlung"
                  : annualPayment?.pensionOmitted
                    ? "Netto vor Zusatzversorgung"
                    : pensionOmitted
                      ? "Netto vor Zusatzversorgung"
                      : "Voraussichtliches Netto"
              }
              value={netPayForecastEuro(net)}
              quiet
              emphasizeValue
            />
            {annualPayment ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, padding: SPACING.lg }}>
                {annualPayment.netIncluded
                  ? "Jahressonderzahlung enthalten"
                  : "Sonderzahlung nur im Brutto"}
              </Text>
            ) : null}
            {netPayForecastLabel(net) ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, padding: SPACING.lg }}>
                {netPayForecastLabel(net)}
              </Text>
            ) : null}
            {pensionOmitted ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, padding: SPACING.lg }}>
                Zusatzversorgung nicht berücksichtigt
              </Text>
            ) : null}
          </>
        ) : null}
      </SalarySectionCard>
    </>
  );
}

export function SalaryBasisView({
  net,
  classification,
  pensionOmitted,
  nightMinutes,
  annualPayment,
  annualProposal,
  annualAutomatic = false,
}: {
  readonly net: AvailablePay | null;
  readonly classification: SalaryClassification | null;
  readonly pensionOmitted: boolean;
  readonly nightMinutes: number;
  readonly annualPayment?: AnnualPaymentForecast;
  readonly annualProposal?: import("./annual-salary-proposal").AnnualSalaryProposal | null;
  readonly annualAutomatic?: boolean;
}) {
  const palette = usePalette();
  return (
    <>
      {annualProposal || annualPayment ? (
        <SalarySectionCard title="Jahressonderzahlung">
          <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>
            {annualProposal ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                {annualAutomatic
                  ? `${annualProposal.rateBasisPoints / 100} % aus ${annualProposal.referenceMonths.join(", ")}. ${annualProposal.note}`
                  : `Für die Berechnung gilt dein gespeicherter eigener Betrag. Die aktuelle automatische Tarifprognose beträgt ${netPayEuro(annualProposal.grossCents)}.`}
              </Text>
            ) : null}
            {annualPayment ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                {annualPayment.note}
              </Text>
            ) : null}
          </View>
        </SalarySectionCard>
      ) : null}
      {net ? (
        <SurfaceCard>
          <SalaryAmountRow label="Steuerbrutto" value={netPayEuro(net.amounts.taxableGrossCents)} />
          <CardSeparator />
          <SalaryAmountRow
            label="Brutto für Sozialversicherung"
            value={netPayEuro(net.amounts.socialInsuranceGrossCents)}
          />
          <View style={{ padding: SPACING.lg, gap: SPACING.sm }}>
            {netPayForecastLabel(net) ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                {netPayForecastLabel(net)}
              </Text>
            ) : null}
            <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
              Krankenversicherung einschließlich Zusatzbeitrag. Geschätzte Abzüge · Die tatsächliche
              Auszahlung kann abweichen.
            </Text>
            {pensionOmitted ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                Beiträge zur Zusatzversorgung und ihre Auswirkungen auf Steuern und
                Sozialversicherung fehlen noch.
              </Text>
            ) : null}
          </View>
        </SurfaceCard>
      ) : null}
      {classification ? (
        <SurfaceCard style={{ padding: SPACING.lg }}>
          <NetPayPremiumExplanation classification={classification} />
        </SurfaceCard>
      ) : null}
      {nightMinutes > 0 ? (
        <SurfaceCard style={{ padding: SPACING.lg }}>
          <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
            Zusätzlich{" "}
            {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(nightMinutes)} Min.
            Freizeitausgleich für Nachtarbeit.
          </Text>
        </SurfaceCard>
      ) : null}
      <SurfaceCard>
        <RowButton
          title="Grundlagen zu Gehalt und Zuschlägen"
          onPress={() => router.push(settingsInfoRoute("CALCULATION"))}
        />
      </SurfaceCard>
    </>
  );
}
