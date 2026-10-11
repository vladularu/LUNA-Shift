import { View } from "react-native";
import { NET_PAY_PENSION_LABELS } from "@/domain/net-pay-pension-schemes";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { formatMonthTitle } from "@/engine/calendar";
import { SPACING } from "@/theme/tokens";
import { usePalette } from "@/theme/palette";
import { SurfaceCard } from "@/ui/design-system";
import type { NetPaySetupSection } from "./net-pay-setup-form";
import { NetPayWorkflowRow, NetPayWorkflowText } from "./net-pay-workflow-controls";

export function NetPaySettingsOverview({
  month,
  settings,
  busy,
  onSelect,
}: {
  readonly month: string;
  readonly settings: MonthlyNetPaySettings;
  readonly busy: boolean;
  readonly onSelect: (section: NetPaySetupSection) => void;
}) {
  const palette = usePalette();
  const p = settings.profile;
  const family = p.isParent
    ? p.childrenUnder25 === 0
      ? "Kinder · keine unter 25"
      : `${p.childrenUnder25} ${p.childrenUnder25 === 1 ? "Kind" : "Kinder"} unter 25`
    : "Keine Kinder";
  const health = settings.specialCases?.includes("PRIVATE_INSURANCE")
    ? "Privat versichert"
    : settings.specialCases?.includes("OTHER_INSURANCE_STATUS")
      ? "Abweichender Versicherungsstatus"
      : `Gesetzlich · ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(p.healthAdditionalRateBps / 100)} % Zusatzbeitrag`;
  const rows = [
    {
      section: "tax",
      title: "Steuern",
      subtitle: `Klasse ${p.taxClass}${p.factorPermille === null ? "" : " mit Faktor"} · ${p.churchTaxRatePercent ? `${p.churchTaxRatePercent} % Kirchensteuer` : "ohne Kirchensteuer"}`,
    },
    { section: "family", title: "Familie", subtitle: family },
    {
      section: "insurance",
      title: "Versicherung & Zusatzversorgung",
      subtitle: `${health} · ${NET_PAY_PENSION_LABELS[settings.automation?.pensionScheme ?? "UNKNOWN"]}${settings.automation?.pensionEmployeeRateBps == null ? "" : ` · ${new Intl.NumberFormat("de-DE").format(settings.automation.pensionEmployeeRateBps / 100)} % Eigenanteil`}${settings.specialCases?.length ? " · Sonderfall" : ""}`,
    },
  ] as const;
  return (
    <View testID="net-pay-settings-overview" style={{ gap: SPACING.md }}>
      <NetPayWorkflowText>
        {settings.month === month
          ? `Gültig ab ${formatMonthTitle(month)}.`
          : `Gültig ab ${formatMonthTitle(settings.month)}. Änderungen gelten ab ${formatMonthTitle(month)}.`}
      </NetPayWorkflowText>
      <SurfaceCard style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((row, index) => (
          <View
            key={row.section}
            style={index ? { borderTopWidth: 1, borderTopColor: palette.separator } : undefined}
          >
            <NetPayWorkflowRow
              embedded
              title={row.title}
              subtitle={row.subtitle}
              disabled={busy}
              onPress={() => onSelect(row.section)}
            />
          </View>
        ))}
      </SurfaceCard>
    </View>
  );
}
