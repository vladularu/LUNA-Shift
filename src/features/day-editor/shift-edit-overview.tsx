import { StyleSheet, View } from "react-native";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { employmentProfileAt } from "@/domain/employment-history";
import { DUTY_LABELS } from "@/domain/special-duty";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { calculateShiftPremiumBreakdown } from "@/engine/pay";
import { getTariffRulePackage } from "@/engine/tariff";
import { formatEuro } from "@/features/analysis/salary-summary-state";
import type { RuleResolver } from "@/rules/rule-resolver";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { ResponsiveFieldRow } from "@/ui/form-controls";
import { Text } from "@/ui/text";

const nextDayFormatter = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" });

export function shiftOverviewPremium(
  shift: ShiftEntry,
  profile: UserProfile | null,
  resolver: RuleResolver,
) {
  if (!profile) return null;
  const datedProfile = employmentProfileAt(profile, shift.date);
  if (!datedProfile.tariff) return null;
  try {
    if (!getTariffRulePackage(shift.date, resolver)) return null;
    const { premiumLines, overtimePremiumAmount } = calculateShiftPremiumBreakdown(
      shift,
      datedProfile,
      resolver,
    );
    return premiumLines.reduce((total, line) => total + line.amount, overtimePremiumAmount);
  } catch {
    // A date, draft, or tariff-data error must not prevent opening the shift.
    return null;
  }
}

export function ShiftEditOverview({
  shift,
  durationMinutes,
}: {
  readonly shift: ShiftEntry;
  readonly durationMinutes: number | null;
}) {
  const palette = usePalette();
  const { profile, calculationProfile } = usePflegeShiftProfile();
  const { resolver } = useRuleCatalogRuntime();
  const premium = shiftOverviewPremium(shift, calculationProfile ?? profile, resolver);
  const { startTime, endTime, specialDuty } = shift;
  const showHours = !shift.allDay && !specialDuty && startTime !== null && endTime !== null;
  const timeLabel = showHours
    ? `${startTime} – ${endTime}`
    : specialDuty
      ? DUTY_LABELS[specialDuty.kind]
      : "Ganztägig";
  const nextDay = new Date(`${shift.date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endLabel =
    showHours && endTime < startTime ? `Ende am ${nextDayFormatter.format(nextDay)} · ` : "";
  const duration =
    durationMinutes === null
      ? "–"
      : `${Math.floor(durationMinutes / 60)} h ${durationMinutes % 60} min`;

  return (
    <View style={styles.overview} testID="shift-edit-overview">
      <Text
        style={[TYPOGRAPHY.highlightValue, styles.value, { color: palette.text }]}
        accessibilityRole="header"
      >
        {timeLabel}
      </Text>
      {showHours ? (
        <Text style={[TYPOGRAPHY.small, styles.centered, { color: palette.textMuted }]}>
          {endLabel}
          {shift.breakMinutes} Min. Pause
        </Text>
      ) : null}
      <ResponsiveFieldRow style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={[TYPOGRAPHY.screenTitle, styles.value, { color: palette.text }]}>
            {duration}
          </Text>
          <Text style={[TYPOGRAPHY.small, styles.centered, { color: palette.textMuted }]}>
            {specialDuty ? "Dauer" : "Arbeitszeit"}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text
            style={[TYPOGRAPHY.screenTitle, styles.value, { color: palette.text }]}
            accessibilityLabel={premium === null ? "Nicht verfügbar" : undefined}
          >
            {formatEuro(premium)}
          </Text>
          <Text style={[TYPOGRAPHY.small, styles.centered, { color: palette.textMuted }]}>
            Zuschlag gesamt
          </Text>
        </View>
      </ResponsiveFieldRow>
    </View>
  );
}

const styles = StyleSheet.create({
  overview: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.lg, gap: SPACING.xs },
  metrics: { marginTop: SPACING.md, gap: SPACING.md },
  metric: { alignItems: "center", gap: SPACING.xs },
  centered: { textAlign: "center" },
  value: { textAlign: "center", fontVariant: ["tabular-nums"] },
});
