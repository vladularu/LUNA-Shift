import { View } from "react-native";
import { usePflegeShiftTestData } from "@/application/pflegeshift-provider";
import { useNetPayProfile } from "@/features/salary/use-net-pay-profile";
import { useAutomaticNetPay } from "@/features/salary/use-automatic-net-pay";
import { netPayForecastEuro, netPayForecastLabel } from "@/features/salary/net-pay-format";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { AnalysisValueRow } from "./analysis-list-card";

export function AnalysisNetPayRow({ month }: { readonly month: string }) {
  const palette = usePalette();
  const { testMonths } = usePflegeShiftTestData();
  const blocked = testMonths.includes(month);
  const data = useNetPayProfile(month, !blocked);
  const settings = data.saved?.settings ?? null;
  const forecast = useAutomaticNetPay(
    month,
    settings,
    !blocked && data.status === "ready" && settings?.version === 2,
    testMonths,
  );
  const available = forecast?.result.status === "available" ? forecast.result : null;
  const label =
    forecast?.annualPayment && !forecast.annualPayment.netIncluded
      ? "Netto ohne Sonderzahlung"
      : forecast?.annualPayment?.pensionOmitted
        ? "Netto vor Zusatzversorgung"
        : available && forecast?.pensionOmitted
          ? "Netto vor Zusatzversorgung"
          : "Voraussichtliches Netto";
  const value = blocked
    ? "Im Testmonat gesperrt"
    : available
      ? netPayForecastEuro(available.pay)
      : data.status === "loading"
        ? "—"
        : data.status === "error" || forecast?.result.status === "unavailable"
          ? "Nicht verfügbar"
          : "Noch nicht eingerichtet";
  const notice = blocked
    ? null
    : available
      ? netPayForecastLabel(available.pay)
      : data.status === "error"
        ? data.error
        : forecast?.result.status === "unavailable"
          ? forecast.result.reason
          : null;
  return (
    <View testID="analysis-net-pay-row">
      <AnalysisValueRow label={label} value={value} total={available !== null} reserveDisclosure />
      {notice ? (
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, paddingBottom: SPACING.md }}>
          {notice}
        </Text>
      ) : null}
      {forecast?.annualPayment ? (
        <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted, paddingBottom: SPACING.md }}>
          {forecast.annualPayment.netIncluded
            ? "Jahressonderzahlung enthalten"
            : "Sonderzahlung nur im Brutto"}
        </Text>
      ) : null}
    </View>
  );
}
