import { formatMinutes, formatPreciseMinutes, formatSignedMinutes } from "@/engine/working-time";

type TimeSummary = { readonly actualMinutes: number; readonly timeAccountMinutes?: number | null };

export function timeAccountActual(summary: TimeSummary): string {
  return summary.timeAccountMinutes === null
    ? "Noch offen"
    : summary.timeAccountMinutes === undefined
      ? formatMinutes(summary.actualMinutes)
      : formatPreciseMinutes(summary.timeAccountMinutes);
}

export function timeAccountBalance(
  summary: TimeSummary & { readonly balanceMinutes: number },
): string {
  return summary.timeAccountMinutes === null
    ? "Noch offen"
    : summary.timeAccountMinutes === undefined
      ? formatSignedMinutes(summary.balanceMinutes)
      : `${summary.balanceMinutes >= 0 ? "+" : ""}${formatPreciseMinutes(summary.balanceMinutes)}`;
}

export function timeAccountCaption(summary: TimeSummary): string | undefined {
  if (summary.timeAccountMinutes === undefined) return undefined;
  return `Erfasst: ${formatPreciseMinutes(summary.actualMinutes)} h. ${
    summary.timeAccountMinutes === null
      ? "Für das Zeitkonto fehlen noch Angaben."
      : "Ist zeigt die geplante Gutschrift fürs Zeitkonto."
  }`;
}
