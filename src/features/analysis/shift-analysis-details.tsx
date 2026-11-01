import { Text } from "@/ui/text";
import { View, useWindowDimensions } from "react-native";
import { SHIFT_TYPE_LABELS } from "@/domain/types";
import type { SpecialDutyTimeCredit } from "@/domain/special-duty-pay";
import { formatMinutes } from "@/engine/working-time";
import type { MonthlyShiftTypeAnalysis } from "./analysis-metrics";
import { AnalysisListCard } from "./analysis-list-card";
import { SHIFT_TYPE_COLORS, usePalette } from "@/theme/palette";
import { DEFAULT_SHIFT_SYMBOLS } from "@/theme/shift-symbols";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { ColorBadge, EmptyState } from "@/ui/design-system";
import { timeCreditLabel } from "./special-duty-time-presentation";

export function ShiftAnalysisDetails({
  analysis,
  creditsAvailable = true,
  caption,
  onPress,
  timeCredits = [],
}: {
  readonly analysis: MonthlyShiftTypeAnalysis;
  readonly creditsAvailable?: boolean;
  readonly caption?: string;
  readonly onPress?: () => void;
  readonly timeCredits?: readonly SpecialDutyTimeCredit[];
}) {
  const p = usePalette();
  const { fontScale, width } = useWindowDimensions();
  const stacked = fontScale >= 1.3 || width < 360;
  const creditById = new Map(timeCredits.map((line) => [line.shiftId, line]));
  const groups =
    analysis.groups ??
    analysis.items.map((item) => ({
      ...item,
      key: item.type,
      title: SHIFT_TYPE_LABELS[item.type],
      color: SHIFT_TYPE_COLORS[item.type],
      symbol: DEFAULT_SHIFT_SYMBOLS[item.type],
      types: [item.type],
      entries: [],
    }));
  const rows = [
    ...groups.map((group) => {
      const labels = [
        ...new Set(
          group.entries.flatMap((entry) => {
            const line = creditById.get(entry.id);
            return line ? [timeCreditLabel(line)] : [];
          }),
        ),
      ];
      return {
        ...group,
        total: false,
        hours:
          !creditsAvailable && group.types.some((type) => type === "VACATION" || type === "SICK")
            ? "Nicht verfügbar"
            : formatMinutes(group.minutes) + " h",
        subtitle:
          labels.length === 1
            ? labels[0]
            : labels.length
              ? "Unterschiedlicher Ausgleich"
              : undefined,
      };
    }),
    {
      key: "TOTAL",
      title: "Gesamt",
      count: analysis.totalCount,
      hours: formatMinutes(analysis.totalMinutes) + " h",
      color: "",
      symbol: "",
      entries: [],
      subtitle: undefined,
      total: true,
    },
  ];
  return (
    <AnalysisListCard
      title="Schichten"
      onPress={onPress}
      caption={
        caption ??
        (creditsAvailable
          ? undefined
          : "Ohne Feiertagsdaten fehlen die Zeitgutschriften für Urlaub und Krankheit.")
      }
    >
      {analysis.totalCount === 0 ? (
        <EmptyState
          title="Noch keine Dienste"
          message="Trage Dienste ein, um den Zeitraum auszuwerten."
        />
      ) : (
        <>
          {!stacked ? (
            <View style={{ flexDirection: "row", gap: SPACING.sm, paddingVertical: SPACING.md }}>
              <Text style={{ flex: 1, color: p.textMuted, ...TYPOGRAPHY.caption }}>Dienstart</Text>
              <Text
                style={{ width: 40, textAlign: "right", color: p.textMuted, ...TYPOGRAPHY.caption }}
              >
                Anzahl
              </Text>
              <Text
                style={{ width: 84, textAlign: "right", color: p.textMuted, ...TYPOGRAPHY.caption }}
              >
                Stunden
              </Text>
            </View>
          ) : null}
          {rows.map((row, index) => {
            return (
              <View
                key={row.key}
                accessible
                accessibilityLabel={`${row.title}, Anzahl ${row.count}, Stunden ${row.hours}${row.subtitle ? ", " + row.subtitle : ""}`}
                testID={`shift-detail-${row.key}`}
                style={{
                  minHeight: 56,
                  paddingVertical: SPACING.md,
                  gap: SPACING.sm,
                  flexDirection: stacked ? "column" : "row",
                  alignItems: stacked ? "stretch" : "center",
                  borderTopWidth: !stacked || index > 0 ? 1 : 0,
                  borderTopColor: p.separator,
                }}
              >
                <View
                  style={{
                    flex: stacked ? undefined : 1,
                    minWidth: 0,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: SPACING.sm,
                  }}
                >
                  {row.color ? <ColorBadge color={row.color} label={row.symbol} size={20} /> : null}
                  <View style={{ flex: 1, minWidth: 0, gap: SPACING.xxs }}>
                    <Text
                      style={{
                        color: p.dark || row.total ? p.text : p.textMuted,
                        ...(row.total ? TYPOGRAPHY.bodyStrong : TYPOGRAPHY.body),
                      }}
                    >
                      {row.title}
                    </Text>
                    {row.subtitle ? (
                      <Text style={{ color: p.textMuted, ...TYPOGRAPHY.caption }}>
                        {row.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={{ flexDirection: fontScale >= 2 ? "column" : "row", gap: SPACING.sm }}>
                  {[
                    { label: "Anzahl", value: String(row.count), width: 40 },
                    { label: "Stunden", value: row.hours, width: 84 },
                  ].map((metric) => (
                    <View
                      key={metric.label}
                      style={{
                        width: stacked ? undefined : metric.width,
                        flex: stacked && fontScale < 2 ? 1 : undefined,
                        gap: SPACING.xs,
                      }}
                    >
                      {stacked ? (
                        <Text style={{ color: p.textMuted, ...TYPOGRAPHY.caption }}>
                          {metric.label}
                        </Text>
                      ) : null}
                      <Text
                        style={{
                          color: p.text,
                          textAlign: stacked ? "left" : "right",
                          ...(row.total ? TYPOGRAPHY.bodyStrong : TYPOGRAPHY.body),
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {metric.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </>
      )}
    </AnalysisListCard>
  );
}
