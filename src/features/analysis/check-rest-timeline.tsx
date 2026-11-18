import { View } from "react-native";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { checkPeriodLabel } from "./check-period-label";
import type { RestTimeline } from "./compliance-timeline";
import { useCheckReferenceDetail } from "./check-detail-layout";

export function formatCheckRestDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

export function CheckRestTimeline({
  rest,
  planning = false,
  nightPhase,
  testID = "check-rest-timeline",
}: {
  readonly rest: RestTimeline;
  readonly planning?: boolean;
  readonly nightPhase?: { readonly period: string; readonly time?: string };
  readonly testID?: string;
}) {
  const palette = usePalette();
  const reference = useCheckReferenceDetail();
  const duration = formatCheckRestDuration(rest.minutes);
  const entries = [
    ...(nightPhase
      ? [
          {
            key: "nights",
            title: "Beginn der Nachtdienste",
            date: nightPhase.period,
            time: nightPhase.time,
            id: undefined,
            day: undefined,
            spokenTime: undefined,
          },
        ]
      : []),
    {
      key: "end",
      id: rest.previous.id,
      title: rest.previous.title + " endet",
      date: checkPeriodLabel(rest.endDate, rest.endDate),
      day: rest.previous.date,
      time: rest.previous.endTime,
      spokenTime: `${rest.previous.startTime} bis ${rest.previous.endTime}`,
    },
    {
      key: "rest",
      title: planning ? "Erfasste Erholung" : "Erfasste Ruhezeit",
      time: duration,
    },
    {
      key: "start",
      id: rest.next.id,
      title: rest.next.title + " beginnt",
      date: checkPeriodLabel(rest.startDate, rest.startDate),
      day: rest.next.date,
      time: rest.next.startTime,
      spokenTime: `${rest.next.startTime} bis ${rest.next.endTime}`,
    },
  ];

  return (
    <View testID={testID}>
      <Text
        accessibilityRole="header"
        style={
          reference
            ? { ...CHECK_REFERENCE_TYPOGRAPHY.section, color: reference.text, marginBottom: 7 }
            : { ...TYPOGRAPHY.bodyStrong, color: palette.text }
        }
      >
        So liegen deine Dienste
      </Text>
      {entries.map((entry, index) => {
        const gap = entry.key === "rest";
        const accent = reference
          ? planning
            ? reference.neutral
            : reference.legal
          : gap && !planning
            ? palette.legalCheckBorder
            : palette.textMuted;
        const track = reference?.track ?? palette.border;
        const rowType = reference ? CHECK_REFERENCE_TYPOGRAPHY.timeline : TYPOGRAPHY.bodyStrong;
        const textColor = gap ? accent : (reference?.text ?? palette.text);
        return (
          <View key={entry.key} style={{ flexDirection: "row", gap: SPACING.sm }}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ width: reference ? 17 : 12, alignItems: "center" }}
            >
              <View
                style={{
                  width: 1,
                  flex: reference ? undefined : 1,
                  height: reference ? 14 : undefined,
                  backgroundColor: index === 0 ? "transparent" : track,
                }}
              />
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: RADII.pill,
                  backgroundColor: reference && !gap ? reference.dot : accent,
                }}
              />
              <View
                style={{
                  width: 1,
                  flex: 1,
                  backgroundColor: index === entries.length - 1 ? "transparent" : track,
                }}
              />
            </View>
            <View testID={entry.day ? `${testID}-${entry.day}` : undefined} style={{ flex: 1 }}>
              <View
                testID={
                  entry.id ? `check-shift-${entry.id}` : `${testID}-${gap ? "gap" : entry.key}`
                }
                accessible
                accessibilityLabel={[
                  entry.title,
                  entry.date,
                  entry.time,
                  entry.spokenTime && `Dienstzeit ${entry.spokenTime}`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                style={{
                  paddingVertical: reference ? 9 : SPACING.sm,
                  gap: reference ? 2 : SPACING.xxs,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    columnGap: SPACING.sm,
                  }}
                >
                  <Text
                    style={{
                      ...rowType,
                      color: textColor,
                      ...(reference && gap ? { fontWeight: "700" as const } : {}),
                    }}
                  >
                    {entry.title}
                  </Text>
                  <Text
                    style={{
                      ...rowType,
                      color: textColor,
                      ...(reference && gap ? { fontWeight: "700" as const } : {}),
                    }}
                  >
                    {entry.time}
                  </Text>
                </View>
                {entry.date ? (
                  <Text
                    style={
                      reference
                        ? { ...CHECK_REFERENCE_TYPOGRAPHY.caption, color: reference.secondary }
                        : { ...TYPOGRAPHY.small, color: palette.textMuted }
                    }
                  >
                    {entry.date}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
