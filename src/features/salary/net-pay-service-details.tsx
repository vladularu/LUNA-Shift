import { useMemo, useState, type PropsWithChildren } from "react";
import { Text } from "@/ui/text";
import { Pressable, View } from "react-native";
import type { MonthlyPayEstimate, ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { CORNER_CURVE, SELECTION_METRICS, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, EmptyState, SurfaceCard } from "@/ui/design-system";
import { SelectionSheet } from "@/ui/selection-sheet";
import { formatMinutes } from "@/engine/working-time";
import { premiumCategory } from "@/engine/net-pay-premium-trace";
import { buildPremiumBreakdown } from "@/features/analysis/premium-breakdown";
import { netPayEuro } from "./net-pay-format";
import { SalaryAmountRow, SalaryPremiumCard } from "./salary-ui";
import {
  salaryServiceRows,
  salaryServiceDate,
  salaryShiftTime,
  type SalaryClassification,
} from "./salary-service-presentation";
import { SALARY_PREMIUM_CATEGORIES } from "./net-pay-premium-details";
import { earnedServiceRows, SPECIAL_DUTY_FILTER } from "./earned-service-pay";
import { SpecialDutyPayCard } from "./special-duty-pay-card";

export function NetPayServiceDetails({
  classification,
  shifts,
  pay,
  includeSpecialDutyPay = false,
  children,
}: PropsWithChildren<{
  readonly classification: SalaryClassification | null;
  readonly shifts: readonly ShiftEntry[];
  readonly pay?: MonthlyPayEstimate;
  readonly includeSpecialDutyPay?: boolean;
}>) {
  const palette = usePalette();
  const [filter, setFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const allRows = useMemo<ReturnType<typeof earnedServiceRows>>(
    () =>
      includeSpecialDutyPay
        ? earnedServiceRows(pay, classification, shifts, null)
        : salaryServiceRows(pay, classification, shifts),
    [pay, classification, shifts, includeSpecialDutyPay],
  );
  const selected = allRows.find((row) => row.id === selectedId) ?? null;
  const specialRows = allRows.filter((row) => row.specialDuty);
  const hasSpecialPremiums = pay?.specialDutyBreakdowns?.some(
    (line) => line.standbyPay?.payrollTrace || line.calloutPay?.payrollTraces?.length,
  );
  const premiumCategories =
    hasSpecialPremiums && (classification || includeSpecialDutyPay)
      ? SALARY_PREMIUM_CATEGORIES.map(({ category, label }) => ({
          key: `sfn:${category}`,
          label,
          amount: includeSpecialDutyPay
            ? earnedServiceRows(pay, classification, shifts, `sfn:${category}`).reduce(
                (sum, row) => sum + (row.amountCents ?? 0),
                0,
              )
            : classification!.shifts.reduce(
                (sum, shift) =>
                  sum +
                  shift.premiumBreakdown
                    .filter((p) => p.category === category)
                    .reduce((n, p) => n + p.paidPremiumCents, 0),
                0,
              ),
        })).filter((row) => row.amount > 0)
      : pay
        ? buildPremiumBreakdown(pay.shiftBreakdowns, shifts, null).categories.filter(
            (row) => row.amount > 0,
          )
        : [];
  const categories = specialRows.length
    ? [...premiumCategories, { key: SPECIAL_DUTY_FILTER, label: "Bereitschaften", amount: 0 }]
    : premiumCategories;
  const activeFilter = categories.some((category) => category.key === filter) ? filter : null;
  const rows = useMemo(
    () =>
      includeSpecialDutyPay
        ? earnedServiceRows(pay, classification, shifts, activeFilter)
        : salaryServiceRows(pay, classification, shifts, activeFilter),
    [pay, classification, shifts, activeFilter, includeSpecialDutyPay],
  );
  const totalCents =
    specialRows.length || activeFilter !== null
      ? rows.some((row) => row.amountCents === null)
        ? null
        : rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
      : (classification?.paidPremiumCents ?? Math.round((pay?.timePremiumAmount ?? 0) * 100));
  const taxCategory = activeFilter?.startsWith("sfn:")
    ? activeFilter.slice(4)
    : activeFilter === null
      ? null
      : premiumCategory(activeFilter);
  const taxLines = (classification?.shifts ?? [])
    .flatMap((shift) => shift.premiumBreakdown)
    .filter((line) => line.category === taxCategory);
  // A raw tariff key may share an SFN category with other keys (e.g. preholiday).
  // Show its tax split only when the classified cash identifies that selection exactly.
  const taxFreeCents =
    classification === null
      ? null
      : activeFilter === null
        ? classification.taxFreeCents
        : activeFilter === SPECIAL_DUTY_FILTER
          ? specialRows.reduce((sum, row) => sum + (row.tax?.taxFreeCents ?? 0), 0)
          : taxLines.reduce((sum, line) => sum + line.paidPremiumCents, 0) === totalCents
            ? taxLines.reduce((sum, line) => sum + line.taxFreeCents, 0)
            : null;
  const interval = salaryShiftTime(selected?.shift);
  return (
    <>
      <SalaryPremiumCard
        totalCents={totalCents}
        taxFreeCents={taxFreeCents}
        title={
          specialRows.length && activeFilter === null
            ? "Zuschläge erarbeitet"
            : activeFilter === SPECIAL_DUTY_FILTER
              ? "Bereitschaftsvergütung"
              : "Zeitzuschläge"
        }
      />
      {children}
      <View testID="net-pay-service-details" style={{ gap: SPACING.md }}>
        {categories.length > 1 || specialRows.length ? (
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
                accessibilityState={{ checked: activeFilter === item.key }}
                onPress={() => setFilter(item.key)}
                style={({ pressed }) => ({
                  minHeight: SELECTION_METRICS.optionHeight,
                  justifyContent: "center",
                  paddingHorizontal: SPACING.md,
                  paddingVertical: SPACING.sm,
                  borderRadius: SELECTION_METRICS.optionRadius,
                  borderCurve: CORNER_CURVE,
                  borderWidth: 1,
                  borderColor:
                    activeFilter === item.key ? palette.selectionActiveBorder : palette.border,
                  backgroundColor:
                    activeFilter === item.key ? palette.selectionTrack : palette.surface,
                  opacity: pressed ? SELECTION_METRICS.pressedOpacity : 1,
                })}
              >
                <Text
                  style={{
                    ...TYPOGRAPHY.compact,
                    fontWeight:
                      activeFilter === item.key
                        ? TYPOGRAPHY.bodyStrong.fontWeight
                        : TYPOGRAPHY.compact.fontWeight,
                    color: activeFilter === item.key ? palette.text : palette.textMuted,
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
                    value={row.amountCents === null ? "Noch offen" : netPayEuro(row.amountCents)}
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
            selected?.specialDuty ? (
              <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
                <SpecialDutyPayCard lines={[selected.specialDuty]} />
                <SalaryAmountRow
                  label="Gesamt"
                  value={
                    selected.amountCents === null ? "Noch offen" : netPayEuro(selected.amountCents)
                  }
                  emphasizeValue
                />
                {classification && selected.amountCents !== null ? (
                  <>
                    <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                      Steuerfrei {netPayEuro(selected.tax?.taxFreeCents ?? 0)} · Steuerpflichtig{" "}
                      {netPayEuro(selected.amountCents - (selected.tax?.taxFreeCents ?? 0))}
                    </Text>
                    <Text style={{ ...TYPOGRAPHY.small, color: palette.textMuted }}>
                      Sozialversicherungsfrei{" "}
                      {netPayEuro(selected.tax?.socialInsuranceFreeCents ?? 0)} · Beitragspflichtig{" "}
                      {netPayEuro(
                        selected.amountCents - (selected.tax?.socialInsuranceFreeCents ?? 0),
                      )}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : selected ? (
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
                  value={
                    selected.amountCents === null ? "Noch offen" : netPayEuro(selected.amountCents)
                  }
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
    </>
  );
}
