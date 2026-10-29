import { View } from "react-native";
import type { SpecialDutyPayLine } from "@/domain/special-duty-pay";
import { Text } from "@/ui/text";
import { SurfaceCard } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { SPACING } from "@/theme/tokens";

const money = (cents: number) =>
  (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export function SpecialDutyPayCard({ lines }: { readonly lines: readonly SpecialDutyPayLine[] }) {
  const palette = usePalette();
  if (!lines.length) return null;
  return (
    <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
      <Text style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}>Bereitschaften</Text>
      {lines.map((line) => (
        <View key={line.shiftId} style={{ gap: SPACING.xs }}>
          <Text style={{ ...TYPOGRAPHY.bodyStrong, color: palette.text }}>
            {line.date.slice(8, 10)}.{line.date.slice(5, 7)}. · {line.title}
          </Text>
          <Text style={{ ...TYPOGRAPHY.body, color: palette.text }}>
            {line.baseAmountCents === null
              ? "Betrag noch offen"
              : `Rufbereitschaftspauschale: ${money(line.baseAmountCents)}`}
          </Text>
          {line.baseAmountCents !== null && line.paidHours !== null && line.hourlyCents !== null ? (
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
              {line.paidHours.toLocaleString("de-DE", { maximumFractionDigits: 4 })} Stunden ×{" "}
              {money(line.hourlyCents)}
              {line.source?.includes("TV-UK") ? " × 1,25" : ""}
            </Text>
          ) : null}
          <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
            {line.complete
              ? "Pauschale berechnet. Sie wird als steuerpflichtiger Betrag berücksichtigt und erhöht die Arbeitszeit nicht."
              : line.notes.join(" ")}
          </Text>
          {line.source ? (
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>{line.source}</Text>
          ) : null}
        </View>
      ))}
    </SurfaceCard>
  );
}
