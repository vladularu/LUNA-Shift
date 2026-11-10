import { Temporal } from "@js-temporal/polyfill";
import type { TariffComplianceEvidence } from "@/domain/tariff-compliance";
import type { ShiftEntry } from "@/domain/types";
import { CheckDutyOverview } from "./check-duty-overview";

export function TariffCheckPeriod({
  evidence,
  shifts = [],
  timeZone,
}: {
  readonly evidence: TariffComplianceEvidence;
  readonly shifts?: readonly ShiftEntry[];
  readonly timeZone?: string;
}) {
  const sunday = evidence.ruleId === "TARIFF_FREE_SUNDAY";
  const fallback = <CheckDutyOverview shifts={shifts} timeZone={timeZone} />;
  let dates: string[];
  try {
    const from = Temporal.PlainDate.from(evidence.period.from),
      until = Temporal.PlainDate.from(evidence.period.until);
    const recorded = [...new Set(evidence.recordedDates ?? [])].sort();
    if (!recorded.length || recorded.length !== evidence.count) return fallback;
    if (recorded.some((date) => date < from.toString() || date > until.toString())) return fallback;
    if (sunday) {
      if (
        recorded.length !== 2 ||
        recorded.some((date) => Temporal.PlainDate.from(date).dayOfWeek !== 7)
      )
        return fallback;
      dates = recorded;
    } else {
      const count = until.since(from).days + 1;
      if (from.dayOfWeek !== 1 || ![7, 14].includes(count)) return fallback;
      dates = Array.from({ length: count }, (_, offset) => from.add({ days: offset }).toString());
    }
  } catch {
    return fallback;
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
