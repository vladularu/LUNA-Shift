import { router } from "expo-router";
import { View, useWindowDimensions } from "react-native";
import { Text } from "@/ui/text";
import type { MonthlyPayEstimate, UserProfile } from "@/domain/types";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { NetPayResult } from "@/domain/net-pay";
import { CardSeparator, RowButton, SurfaceCard } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { salaryDetailsRoute, settingsInfoRoute } from "@/navigation/routes";
import { salaryComposition } from "./salary-composition";
import { SalaryAmountRow, SalaryNavigationRow, SalarySectionCard } from "./salary-ui";
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
}: {
  readonly month: string;
  readonly profile: UserProfile;
  readonly pay: MonthlyPayEstimate;
  readonly net: AvailablePay | null;
  readonly settings: MonthlyNetPaySettings | null;
  readonly pensionOmitted: boolean;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { caption, compositionRows } = salaryComposition(profile, pay, month);
  const gross =
    net?.amounts.grossCents ??
    (pay.estimatedGrossAmount === null ? null : Math.round(pay.estimatedGrossAmount * 100));
  const extra = settings?.automation?.additionalRecurringGrossCents ?? 0;
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
              <SalaryAmountRow label={row.label} value={row.value} onPress={row.onPress} quiet />
            </View>
          ))
        ) : (
          <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted, padding: SPACING.lg }}>
            Für diesen Monat liegt kein unterstützter Tarifstand vor.
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
          onPress={() => router.push(salaryDetailsRoute(month, "deductions"))}
          quiet
        />
        {net ? (
          <>
            <CardSeparator />
            <SalaryAmountRow
              label={pensionOmitted ? "Netto vor Zusatzversorgung" : "Voraussichtliches Netto"}
              value={netPayForecastEuro(net)}
              quiet
              emphasizeValue
            />
            {netPayForecastLabel(net) ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, padding: SPACING.lg }}>
                {netPayForecastLabel(net)}
              </Text>
            ) : null}
            {pensionOmitted ? (
              <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, padding: SPACING.lg }}>
                Zusatzversorgung offen
              </Text>
            ) : null}
          </>
        ) : null}
        <CardSeparator />
        <SalaryNavigationRow
          title="Berechnungsgrundlagen"
          onPress={() => router.push(salaryDetailsRoute(month, "basis"))}
        />
      </SalarySectionCard>
    </>
  );
}

export function SalaryBasisView({
  net,
  classification,
  pensionOmitted,
  nightMinutes,
}: {
  readonly net: AvailablePay | null;
  readonly classification: SalaryClassification | null;
  readonly pensionOmitted: boolean;
  readonly nightMinutes: number;
}) {
  const palette = usePalette();
  return (
    <>
      {net ? (
        <SurfaceCard>
          <SalaryAmountRow label="Steuerbrutto" value={netPayEuro(net.amounts.taxableGrossCents)} />
          <CardSeparator />
          <SalaryAmountRow
            label="SV-Brutto"
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
