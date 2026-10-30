import { Temporal } from "@js-temporal/polyfill";
import { clockMinute, dutyInstant } from "@/domain/special-duty";
import type { SfnPremiumPayment, SfnShift, SfnTimeRange } from "@/domain/net-pay-sfn";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import type { RuleResolver } from "@/rules/rule-resolver";
import type { SpecialDutyPayLine } from "@/domain/special-duty-pay";
import { getPublicHolidays } from "./holidays";

export function specialDutyPayrollTraces(
  lines: readonly SpecialDutyPayLine[],
): readonly SfnShift[] {
  return lines.flatMap((line) =>
    line.standbyPay?.payrollTrace
      ? [line.standbyPay.payrollTrace]
      : (line.calloutPay?.payrollTraces ?? []),
  );
}

export function dutyPayrollRange(shift: ShiftEntry, from: number, until: number): SfnTimeRange {
  const timestamp = (minute: number) =>
    dutyInstant(shift.date, minute, shift.specialDuty!.timeZone).toString({
      smallestUnit: "minute",
      timeZoneName: "never",
    });
  return { start: timestamp(from), end: timestamp(until) };
}

/** A duration-only break is usable only if moving it cannot change any paid SFN cap. */
export function standbyPayrollTrace(
  shift: ShiftEntry,
  payments: readonly SfnPremiumPayment[],
  profile: UserProfile,
  resolver: RuleResolver,
): SfnShift {
  const duty = shift.specialDuty!;
  const full = dutyPayrollRange(
    shift,
    clockMinute(shift.startTime!),
    duty.endDay * 1440 + clockMinute(shift.endTime!),
  );
  const instant = (value: string) => Temporal.Instant.from(value);
  const start = instant(full.start),
    end = instant(full.end);
  if (
    duty.breakStart == null &&
    shift.breakMinutes > 0 &&
    payments.some((p) => p.kind !== "OTHER" && p.amountCents > 0)
  ) {
    const holidays = new Set(
      getPublicHolidays(
        Number(shift.date.slice(0, 4)),
        profile.federalState,
        resolver,
        profile.holidayRegion,
      ).map((h) => h.date),
    );
    const points = new Set<number>([Number(start.epochMilliseconds)]);
    for (let day = 0; day <= duty.endDay; day++)
      for (const hour of [0, 4, 6, 14, 20, 24]) {
        const at = Number(
          dutyInstant(shift.date, day * 1440 + hour * 60, duty.timeZone).epochMilliseconds,
        );
        if (at > start.epochMilliseconds && at < end.epochMilliseconds) points.add(at);
      }
    for (const payment of payments)
      for (const period of payment.periods) {
        for (const value of [period.start, period.end]) {
          const at = Number(instant(value).epochMilliseconds);
          if (at >= start.epochMilliseconds && at < end.epochMilliseconds) points.add(at);
        }
      }
    const dayRate = (date: Temporal.PlainDate, minute: number) =>
      (date.month === 12 &&
        (date.day === 25 || date.day === 26 || (date.day === 24 && minute >= 840))) ||
      (date.month === 5 && date.day === 1)
        ? 150
        : holidays.has(date.toString()) || (date.month === 12 && date.day === 31 && minute >= 840)
          ? 125
          : date.dayOfWeek === 7
            ? 50
            : 0;
    const signatures = new Set(
      [...points].map((at) => {
        const local = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(duty.timeZone);
        const date = local.toPlainDate(),
          minute = local.hour * 60 + local.minute;
        const priorNight = date.toString() > shift.date;
        const night = minute < 360 || minute >= 1200 ? (minute < 240 && priorNight ? 40 : 25) : 0;
        const day = Math.max(
          dayRate(date, minute),
          minute < 240 && priorNight ? dayRate(date.subtract({ days: 1 }), 1439) : 0,
        );
        return payments
          .filter((p) => p.amountCents > 0)
          .map((p) =>
            [
              p.kind,
              p.periods.some(
                (r) =>
                  instant(r.start).epochMilliseconds <= at && instant(r.end).epochMilliseconds > at,
              ),
              p.kind === "NIGHT" ? night : p.kind === "DAY" ? day : 0,
            ].join(":"),
          )
          .join("|");
      }),
    );
    if (signatures.size !== 1)
      throw new Error(
        "Für die steuerliche Zuschlagszuordnung fehlt die genaue Lage der Bereitschaftspause.",
      );
  }
  // This is a calculation-only equivalent interval, never a claimed recorded break position.
  const pause =
    shift.breakMinutes > 0
      ? [
          {
            start: (duty.breakStart == null
              ? end.subtract({ minutes: shift.breakMinutes })
              : dutyInstant(shift.date, duty.breakStart, duty.timeZone).toInstant()
            )
              .toZonedDateTimeISO(duty.timeZone)
              .toString({ smallestUnit: "minute", timeZoneName: "never" }),
            end:
              duty.breakStart == null
                ? full.end
                : dutyInstant(shift.date, duty.breakStart, duty.timeZone)
                    .add({ minutes: shift.breakMinutes })
                    .toString({ smallestUnit: "minute", timeZoneName: "never" }),
          },
        ]
      : [];
  return { id: shift.id, ...full, unpaidBreaks: pause, payments };
}
