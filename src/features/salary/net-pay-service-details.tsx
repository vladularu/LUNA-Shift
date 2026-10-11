import { useState } from "react";
import { Text } from "@/ui/text";
import { View } from "react-native";
import type { SfnClassificationResult } from "@/domain/net-pay-sfn";
import type { ShiftEntry } from "@/domain/types";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { NetPayAmountRow } from "./net-pay-amount-row";
import { netPayEuro } from "./net-pay-format";
import { NetPayWorkflowText } from "./net-pay-workflow-controls";

const LABELS = {
  NIGHT: "Nacht",
  SUNDAY: "Sonntag",
  HOLIDAY: "Feiertag",
  SATURDAY: "Samstag",
  OTHER: "Weitere",
} as const;

export function NetPayServiceDetails({
  classification,
  shifts,
}: {
  readonly classification: Extract<SfnClassificationResult, { status: "available" }>;
  readonly shifts: readonly ShiftEntry[];
}) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState<string | null>(null);
  const byId = new Map(shifts.map((shift) => [shift.id, shift]));
  const rows = classification.shifts
    .filter((row) => row.paidPremiumCents > 0)
    .map((row) => ({ ...row, shift: byId.get(row.shiftId) }))
    .sort(
      (a, b) =>
        (a.shift?.date ?? "").localeCompare(b.shift?.date ?? "") ||
        (a.shift?.startTime ?? "").localeCompare(b.shift?.startTime ?? "") ||
        a.shiftId.localeCompare(b.shiftId),
    );
  return (
    <View testID="net-pay-service-details">
      {rows.length === 0 ? (
        <NetPayWorkflowText>Keine Zeitzuschläge in diesem Monat.</NetPayWorkflowText>
      ) : null}
      {rows.map((row) => {
        const open = expanded === row.shiftId;
        const title = row.shift
          ? new Intl.DateTimeFormat("de-DE", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
              timeZone: "UTC",
            }).format(new Date(`${row.shift.date}T12:00:00Z`))
          : "Dienst";
        return (
          <View
            key={row.shiftId}
            style={{
              borderTopWidth: 1,
              borderTopColor: palette.separator,
              paddingVertical: SPACING.sm,
            }}
          >
            <NetPayAmountRow
              label={title}
              value={netPayEuro(row.paidPremiumCents)}
              expanded={open}
              onPress={() => setExpanded(open ? null : row.shiftId)}
            />
            {row.shift ? (
              <NetPayWorkflowText>
                {row.shift.title} · {row.shift.startTime}–{row.shift.endTime}
              </NetPayWorkflowText>
            ) : null}
            {open ? (
              <View style={{ paddingTop: SPACING.sm, gap: SPACING.xs }}>
                {row.premiumBreakdown
                  .filter((line) => line.paidPremiumCents > 0)
                  .map((line, index) => (
                    <View
                      key={`${line.category}-${index}`}
                      style={{ paddingVertical: SPACING.xs, gap: SPACING.xxs }}
                    >
                      <NetPayAmountRow
                        label={LABELS[line.category]}
                        value={netPayEuro(line.paidPremiumCents)}
                      />
                      <Text
                        maxFontSizeMultiplier={TEXT_MAX_SCALE}
                        style={{
                          color: palette.textMuted,
                          ...TYPOGRAPHY.footnote,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        Steuerfrei {netPayEuro(line.taxFreeCents)} · steuerpflichtig{" "}
                        {netPayEuro(line.taxablePremiumCents)}
                      </Text>
                    </View>
                  ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
