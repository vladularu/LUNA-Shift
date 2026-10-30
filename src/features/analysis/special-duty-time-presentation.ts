import { formatMinutes, formatPreciseMinutes, formatSignedMinutes } from "@/engine/working-time";
import type { SpecialDutyTimeCredit } from "@/domain/special-duty-pay";

type TimeSummary = {
  readonly actualMinutes: number;
  readonly timeAccountMinutes?: number | null;
  readonly specialDutyTimeCredits?: readonly SpecialDutyTimeCredit[];
};

export function pendingTimeAccountDuties(summary: TimeSummary) {
  return summary.specialDutyTimeCredits?.filter((line) => line.creditedMinutes === null) ?? [];
}

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
  const pending = pendingTimeAccountDuties(summary);
  const reason =
    pending.length === 1
      ? `${pending[0].date.slice(8, 10)}.${pending[0].date.slice(5, 7)}.: ${pending[0].notes[0] ?? "Ergänze die Angaben zur Bereitschaft."}`
      : pending.length > 1
        ? `${pending.length} Bereitschaften: Angaben zur Zeitgutschrift fehlen.`
        : "Für das Zeitkonto fehlen noch Bereitschaftsangaben.";
  return `Erfasst: ${formatPreciseMinutes(summary.actualMinutes)} h. ${
    summary.timeAccountMinutes === null ? reason : "Zeitgutschrift laut vereinbartem Ausgleich."
  }`;
}
