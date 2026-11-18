import { Temporal } from "@js-temporal/polyfill";
import { View } from "react-native";
import { Text } from "@/ui/text";
import { ColorBadge } from "@/ui/design-system";
import { RADII } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY } from "@/theme/typography";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import type { ShiftEntry } from "@/domain/types";
import { CheckDutyOverview } from "./check-duty-overview";
import { useCheckReferenceDetail } from "./check-detail-layout";
import { checkPeriodLabel } from "./check-period-label";

export function tariffCheckCalendar(evidence: TariffComplianceEvidence) {
  const recorded = [...new Set(evidence.recordedDates ?? [])].sort();
  const sunday = evidence.ruleId === "TARIFF_FREE_SUNDAY";
  let dates: string[];
  try {
    const from = Temporal.PlainDate.from(evidence.period.from),
      until = Temporal.PlainDate.from(evidence.period.until);
    if (!recorded.length || recorded.length !== evidence.count) return null;
    if (recorded.some((date) => date < from.toString() || date > until.toString())) return null;
    if (sunday) {
      if (
        recorded.length !== 2 ||
        recorded.some((date) => Temporal.PlainDate.from(date).dayOfWeek !== 7)
      )
        return null;
      dates = recorded;
    } else {
      const count = until.since(from).days + 1;
      if (from.dayOfWeek !== 1 || ![7, 14].includes(count)) return null;
      dates = Array.from({ length: count }, (_, offset) => from.add({ days: offset }).toString());
    }
  } catch {
    return null;
  }
  return { recorded, sunday, dates };
}

export function TariffCheckPeriod({
  evidence,
  shifts = [],
  timeZone,
  calendar = tariffCheckCalendar(evidence),
}: {
  readonly evidence: TariffComplianceEvidence;
  readonly shifts?: readonly ShiftEntry[];
  readonly timeZone?: string;
  readonly calendar?: ReturnType<typeof tariffCheckCalendar>;
}) {
  const reference = useCheckReferenceDetail();
  if (!calendar) return <CheckDutyOverview shifts={shifts} timeZone={timeZone} />;
  const { recorded, sunday, dates } = calendar;
  if (reference) {
    const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const weekRows = Array.from({ length: Math.ceil(dates.length / 7) }, (_, index) =>
      dates.slice(index * 7, index * 7 + 7),
    );
    return (
      <View testID="tariff-period" style={{ gap: 4 }}>
        {weekRows.map((row) => (
          <View key={row[0]} style={{ flexDirection: "row", gap: 4 }}>
            {row.map((date) => {
              const day = Temporal.PlainDate.from(date);
              const started = recorded.includes(date);
              const duties = started
                ? shifts
                    .filter((shift) => shift.date === date && shift.deletedAt === null)
                    .sort(
                      (a, b) =>
                        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
                        a.id.localeCompare(b.id),
                    )
                : [];
              return (
                <View
                  key={date}
                  testID={`tariff-period-${date}`}
                  accessible
                  accessibilityLabel={
                    checkPeriodLabel(date, date) +
                    (started ? ", Dienstbeginn erfasst" : ", kein Dienstbeginn erfasst") +
                    duties.map(({ title }) => `, ${title}`).join("")
                  }
                  style={{
                    flex: 1,
                    minWidth: 0,
                    alignItems: "center",
                    paddingVertical: 7,
                    borderRadius: RADII.small,
                    backgroundColor: started ? reference.tariffSoft : reference.background,
                  }}
                >
                  <Text style={{ ...CHECK_REFERENCE_TYPOGRAPHY.weekday, color: reference.tariff }}>
                    {weekdays[day.dayOfWeek - 1]}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "center",
                      columnGap: 4,
                      rowGap: 2,
                    }}
                  >
                    {duties.map(({ id, color, symbol }) => (
                      <View key={id} testID={`check-duty-symbol-${date}-${id}`}>
                        <ColorBadge color={color} label={symbol} size={sunday ? 18 : 14} />
                      </View>
                    ))}
                    <Text
                      style={{ ...CHECK_REFERENCE_TYPOGRAPHY.category, color: reference.tariff }}
                    >
                      {day.day}.
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  }
  return (
    <CheckDutyOverview
      shifts={shifts}
      dates={dates}
      compact={!sunday}
      timeZone={timeZone}
      testID="tariff-period"
    />
  );
}
