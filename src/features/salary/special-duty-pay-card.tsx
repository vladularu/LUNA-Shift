import { Pressable, View } from "react-native";
import type { SpecialDutyPayLine } from "@/domain/special-duty-pay";
import { Text } from "@/ui/text";
import { SurfaceCard } from "@/ui/design-system";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CONTROL_HEIGHT, CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";

const money = (cents: number) =>
  (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export function SpecialDutyPayCard({
  lines,
  onOpenDuty,
}: {
  readonly lines: readonly SpecialDutyPayLine[];
  readonly onOpenDuty?: (line: SpecialDutyPayLine) => void;
}) {
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
              : line.standbyPay
                ? `Auszahlung Bereitschaftsdienst: ${money(line.baseAmountCents)}`
                : `Rufbereitschaftspauschale: ${money(line.baseAmountCents)}`}
          </Text>
          {!line.standbyPay &&
          line.baseAmountCents !== null &&
          line.paidHours !== null &&
          line.hourlyCents !== null ? (
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
              {line.paidHours.toLocaleString("de-DE", { maximumFractionDigits: 4 })}{" "}
              {line.paidHours === 1 ? "Stunde" : "Stunden"} × {money(line.hourlyCents)}
              {line.source?.includes("TV-UK") ? " × 1,25" : ""}
            </Text>
          ) : null}
          {line.standbyPay ? (
            <View style={{ gap: SPACING.xs }}>
              <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                Geleistet: {line.standbyPay.actualMinutes} Min.
                {line.standbyPay.weightedMinutes === null
                  ? ""
                  : ` Für die Vergütung: ${line.standbyPay.weightedMinutes.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Min.`}
              </Text>
              {line.standbyPay.hourlyCents !== null ? (
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  Entgeltgrundlage: {line.standbyPay.payGroup} ·{" "}
                  {money(line.standbyPay.hourlyCents)}/Std.
                </Text>
              ) : null}
              {line.standbyPay.baseAmountCents !== null ? (
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  Grundbetrag: {money(line.standbyPay.baseAmountCents)}
                  {[
                    ["Überstunden", line.standbyPay.overtimePremiumCents],
                    ["Nacht", line.standbyPay.nightPremiumCents],
                    ["Feiertag", line.standbyPay.holidayPremiumCents],
                    ["Sonntag", line.standbyPay.sundayPremiumCents],
                  ]
                    .filter(([, amount]) => typeof amount === "number" && amount > 0)
                    .map(([label, amount]) => ` · ${label}: ${money(amount as number)}`)
                    .join("")}
                </Text>
              ) : null}
              {line.standbyPay.timeCreditMinutes !== null &&
              line.standbyPay.timeCreditMinutes > 0 ? (
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  Geplante Zeitgutschrift:{" "}
                  {line.standbyPay.timeCreditMinutes.toLocaleString("de-DE", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  Min. Als Prognose aus deiner Abgeltung berechnet.
                  {line.standbyPay.mandatoryRestMinutes
                    ? ` Davon ${line.standbyPay.mandatoryRestMinutes.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Min. gesundheitlicher Ausgleich.`
                    : ""}
                </Text>
              ) : null}
            </View>
          ) : null}
          {line.calloutPay ? (
            <View style={{ gap: SPACING.xs }}>
              <Text style={{ ...TYPOGRAPHY.body, color: palette.text }}>
                {line.calloutPay.baseAmountCents === null ||
                line.calloutPay.overtimePremiumCents === null
                  ? "Einsatzvergütung noch offen"
                  : `Einsatzentgelt: ${money(line.calloutPay.baseAmountCents)} + ${money(line.calloutPay.overtimePremiumCents)} Überstundenzuschlag`}
              </Text>
              <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                Tatsächlich: {line.calloutPay.actualMinutes} Min. einschließlich Wege.
                {line.calloutPay.paidMinutes === null
                  ? ""
                  : ` Tariflich bewertet: ${line.calloutPay.paidMinutes} Min.`}
              </Text>
              {line.calloutPay.rates ? (
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  Grundentgelt: {money(line.calloutPay.rates.baseHourlyCents)}/Std. · Zuschlag:{" "}
                  {(line.calloutPay.rates.premiumBasisPoints / 100).toLocaleString("de-DE")}% von{" "}
                  {money(line.calloutPay.rates.premiumHourlyCents)}/Std.
                </Text>
              ) : null}
              {(line.calloutPay.timePremiumCents ?? 0) > 0 ? (
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  Zeitzuschläge der Einsätze: {money(line.calloutPay.timePremiumCents!)}
                </Text>
              ) : null}
              {(line.calloutPay.timeCreditMinutes ?? 0) > 0 ? (
                <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
                  Geplante Zeitgutschrift:{" "}
                  {line.calloutPay.timeCreditMinutes!.toLocaleString("de-DE", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  Min. Zeitzuschläge werden ausgezahlt.
                  {(line.calloutPay.mandatoryRestMinutes ?? 0) > 0
                    ? ` Davon ${line.calloutPay.mandatoryRestMinutes!.toLocaleString("de-DE", { maximumFractionDigits: 2 })} Min. gesundheitlicher Ausgleich.`
                    : ""}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>
            {line.complete
              ? line.standbyPay
                ? "Die Auszahlung ist berechnet. Eine vorgesehene Zeitgutschrift wird getrennt ausgewiesen."
                : line.calloutPay
                  ? "Pauschale und Einsatzgrundentgelt bleiben steuerpflichtig. Zeitzuschläge werden getrennt geprüft. Die Rundung verändert die erfasste Arbeitszeit nicht."
                  : "Pauschale berechnet. Sie wird als steuerpflichtiger Betrag berücksichtigt und erhöht die Arbeitszeit nicht."
              : line.notes.join(" ")}
          </Text>
          {line.source ? (
            <Text style={{ ...TYPOGRAPHY.caption, color: palette.textMuted }}>{line.source}</Text>
          ) : null}
          {onOpenDuty ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Dienst öffnen: ${line.date.slice(8, 10)}.${line.date.slice(5, 7)}. · ${line.title}`}
              accessibilityHint="Öffnet diesen Dienst zum Prüfen und Ergänzen der Angaben."
              onPress={() => onOpenDuty(line)}
              style={({ pressed }) => ({
                minHeight: CONTROL_HEIGHT.regular,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: RADII.control,
                borderCurve: CORNER_CURVE,
                backgroundColor: pressed ? palette.surfaceMuted : palette.surfaceRaised,
              })}
            >
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ ...TYPOGRAPHY.button, color: palette.primary }}
              >
                Dienst öffnen
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </SurfaceCard>
  );
}
