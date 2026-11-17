import { Temporal } from "@js-temporal/polyfill";

export function formatMonthRangeLabel(month: string): string {
  const value = Temporal.PlainYearMonth.from(month);
  return formatPeriodRangeLabel(
    value.toPlainDate({ day: 1 }),
    value.toPlainDate({ day: value.daysInMonth }),
  );
}

export function formatYearRangeLabel(year: number): string {
  return formatPeriodRangeLabel(
    Temporal.PlainDate.from({ year, month: 1, day: 1 }),
    Temporal.PlainDate.from({ year, month: 12, day: 31 }),
  );
}

function formatPeriodRangeLabel(firstDay: Temporal.PlainDate, lastDay: Temporal.PlainDate): string {
  const date = new Date(`${firstDay.toString()}T00:00:00Z`);
  const endDate = new Date(`${lastDay.toString()}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(/\.$/, "");
  const monthFormat = new Intl.DateTimeFormat("de-DE", {
    month: "short",
    timeZone: "UTC",
  });
  const startMonth = monthFormat.format(date).replace(/\.$/, "");
  const endMonth = monthFormat.format(endDate).replace(/\.$/, "");
  return `${weekday}. ${firstDay.day}. ${startMonth}. - ${lastDay.day}. ${endMonth}. ${lastDay.year}`;
}
