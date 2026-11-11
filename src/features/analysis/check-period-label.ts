import { Temporal } from "@js-temporal/polyfill";

const months = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function checkPeriodLabel(from: string, until: string): string {
  try {
    const first = Temporal.PlainDate.from(from);
    const last = Temporal.PlainDate.from(until);
    if (Temporal.PlainDate.compare(first, last) > 0) return "Zeitraum nicht verfügbar";
    // iOS Hermes may omit Intl's resolved calendar. Calendar-only labels must
    // not depend on Temporal.toLocaleString or convert through a time zone.
    const full = (date: Temporal.PlainDate) =>
      `${date.day}. ${months[date.month - 1]} ${date.year}`;
    if (first.equals(last)) return full(first);
    if (first.year === last.year && first.month === last.month)
      return `${first.day}.–${last.day}. ${months[last.month - 1]} ${last.year}`;
    return `${full(first)} – ${full(last)}`;
  } catch {
    return "Zeitraum nicht verfügbar";
  }
}
