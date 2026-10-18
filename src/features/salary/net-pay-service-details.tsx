import { useMemo, useState } from "react";
import { Text } from "@/ui/text";
import { Pressable, View } from "react-native";
import type { MonthlyPayEstimate, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, EmptyState, SurfaceCard } from "@/ui/design-system";
import { SelectionSheet } from "@/ui/selection-sheet";
import { formatMinutes } from "@/engine/working-time";
import { buildPremiumBreakdown } from "@/features/analysis/premium-breakdown";
import { netPayEuro } from "./net-pay-format";
import { SalaryAmountRow } from "./salary-ui";
import {
  salaryServiceRows,
  salaryServiceDate,
  salaryShiftTime,
  type SalaryClassification,
} from "./salary-service-presentation";
import { SALARY_PREMIUM_CATEGORIES } from "./net-pay-premium-details";

export function NetPayServiceDetails({
  classification,
  shifts,
  pay,
}: {
  readonly classification: SalaryClassification | null;
  readonly shifts: readonly ShiftEntry[];
  readonly pay?: MonthlyPayEstimate;
}) {
  const palette = usePalette();
  const [filter, setFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(
    () => salaryServiceRows(pay, classification, shifts, filter),
    [pay, classification, shifts, filter],
  );
  const allRows = useMemo(
    () => salaryServiceRows(pay, classification, shifts),
    [pay, classification, shifts],
  );
  const selected = allRows.find((row) => row.id === selectedId) ?? null;
  const categories = pay
    ? buildPremiumBreakdown(pay.shiftBreakdowns, shifts, null).categories.filter(
        (row) => row.amount > 0,
      )
    : [];
  const interval = salaryShiftTime(selected?.shift);
  return (
    <View testID="net-pay-service-details" style={{ gap: SPACING.md }}>
      {categories.length > 1 ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Zuschlagsart"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm }}
        >
          {[{ key: null, label: "Alle" }, ...categories].map((item) => (
            <Pressable
              key={item.key ?? "all"}
              accessibilityRole="radio"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: filter === item.key }}
              onPress={() => setFilter(item.key)}
              style={({ pressed }) => ({
                minHeight: SELECTION_METRICS.optionHeight,
                justifyContent: "center",
                paddingHorizontal: SPACING.md,
                paddingVertical: SPACING.sm,
                borderRadius: SELECTION_METRICS.optionRadius,
                borderCurve: CORNER_CURVE,
                borderWidth: 1,
                borderColor: filter === item.key ? palette.selectionActiveBorder : palette.border,
                backgroundColor: filter === item.key ? palette.selectionTrack : palette.surface,
                opacity: pressed ? SELECTION_METRICS.pressedOpacity : 1,
              })}
            >
              <Text
                style={{
                  ...TYPOGRAPHY.compact,
                  fontWeight:
                    filter === item.key
                      ? TYPOGRAPHY.bodyStrong.fontWeight
                      : TYPOGRAPHY.compact.fontWeight,
                  color: filter === item.key ? palette.text : palette.textMuted,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SurfaceCard>
        {!rows.length ? (
          <EmptyState
            title="Keine Zeitzuschläge"
            message="In diesem Monat wurden keine Zeitzuschläge berechnet."
          />
        ) : (
          rows.map((row, index) => {
            const time = salaryShiftTime(row.shift);
            return (
              <View key={row.id}>
                {index ? <CardSeparator /> : null}
                <SalaryAmountRow
                  quiet
                  label={row.date ? salaryServiceDate(row.date, true) : "Dienst"}
                  value={netPayEuro(row.amountCents)}
                  subtitle={`${row.shift?.title ?? "Dienst"} · ${time.interval}${time.nextDay ? " · Folgetag" : ""}`}
                  onPress={() => setSelectedId(row.id)}
                />
              </View>
            );
          })
        )}
      </SurfaceCard>
      <SelectionSheet
        visible={selected !== null}
        title={
          selected
            ? `${selected.shift?.title ?? "Dienst"} · ${selected.date ? salaryServiceDate(selected.date) : ""}`
            : "Dienst"
        }
        closeInHeader
        cancelLabel="Schließen"
        onClose={() => setSelectedId(null)}
        contentKey={selected?.id}
      >
        {() =>
          selected ? (
            <View style={{ padding: SPACING.lg, gap: SPACING.lg }}>
              <Text style={{ ...TYPOGRAPHY.body, color: palette.textMuted }}>
                {interval.interval}
                {interval.nextDay && interval.endDate
                  ? ` · endet am ${salaryServiceDate(interval.endDate)}${interval.endDate.slice(0, 4) !== selected.date.slice(0, 4) ? interval.endDate.slice(0, 4) : ""}`
                  : ""}
              </Text>
              {selected.shift?.startTime ? (
                <View style={{ gap: SPACING.xxs }}>
                  <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                    Beginn: {salaryServiceDate(selected.date, true)} · {selected.shift.startTime}
                  </Text>
                  <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                    Ende: {interval.endDate ? salaryServiceDate(interval.endDate, true) : "–"} ·{" "}
                    {selected.shift.endTime}
                  </Text>
                </View>
              ) : null}
              <CardSeparator inset={0} />
              <View>
                {selected.tax
                  ? selected.tax.premiumBreakdown
                      .filter((line) => line.paidPremiumCents > 0)
                      .map((line) => (
                        <View key={line.category}>
                          <SalaryAmountRow
                            quiet
                            label={
                              SALARY_PREMIUM_CATEGORIES.find(
                                (category) => category.category === line.category,
                              )?.label ?? line.category
                            }
                            value={netPayEuro(line.paidPremiumCents)}
                            subtitle={`Steuerfrei ${netPayEuro(line.taxFreeCents)} · Steuerpflichtig ${netPayEuro(line.taxablePremiumCents)}`}
                          />
                        </View>
                      ))
                  : selected.premiumLines.map((line, index) => (
                      <SalaryAmountRow
                        quiet
                        key={`${line.key}-${index}`}
                        label={line.label}
                        value={netPayEuro(Math.round(line.amount * 100))}
                      />
                    ))}
              </View>
              <CardSeparator inset={0} />
              <SalaryAmountRow
                label="Gesamt"
                value={netPayEuro(selected.amountCents)}
                quiet
                emphasizeValue
              />
              {selected.tax ? (
                <>
                  <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                    Steuerfrei {netPayEuro(selected.tax.taxFreeCents)} · Steuerpflichtig{" "}
                    {netPayEuro(selected.tax.taxablePremiumCents)}
                  </Text>
                  <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                    Sozialversicherungsfrei {netPayEuro(selected.tax.socialInsuranceFreeCents)} ·
                    Beitragspflichtig {netPayEuro(selected.tax.socialInsuranceLiablePremiumCents)}
                  </Text>
                </>
              ) : (
                <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                  Die steuerliche Aufteilung ist noch nicht verfügbar. Richte dafür deine
                  Netto-Angaben ein.
                </Text>
              )}
              {selected.premiumLines.length ? (
                <View style={{ gap: SPACING.sm }}>
                  <Text
                    accessibilityRole="header"
                    style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}
                  >
                    Berechnung dieses Dienstes
                  </Text>
                  {selected.premiumLines.map((line, index) => (
                    <Text
                      key={`${line.key}-${index}`}
                      style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}
                    >
                      {line.label}: {formatMinutes(line.minutes)} h ·{" "}
                      {line.ruleId === "tvl-saturday-fixed"
                        ? `Fester Zuschlag ${netPayEuro(Math.round(line.hourlyRate * 100))}/h`
                        : `${line.percentage} % · Stundenbasis ${netPayEuro(Math.round(line.hourlyRate * 100))}/h`}
                    </Text>
                  ))}
                </View>
              ) : null}
              <Text style={{ ...TYPOGRAPHY.footnote, color: palette.textMuted }}>
                Die Aufteilung nutzt geplante Zeiten. Für Steuern und Sozialversicherung gelten
                unterschiedliche Grenzen.
              </Text>
            </View>
          ) : null
        }
      </SelectionSheet>
    </View>
  );
}
