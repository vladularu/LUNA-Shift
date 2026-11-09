/** Reviewed product guidance, separate from signed statutory rule packages. */
export const PLANNING_NIGHT_POLICY = {
  version: "2026-11-07",
  firstNightHint: 4,
  minimumSeriesForRecovery: 2,
  minimumRecoveryMinutes: 1440,
  preferredRecoveryMinutes: 2880,
  nightStart: "23:00",
  nightEnd: "06:00",
  nightThresholdMinutes: 120,
  sources: [
    {
      title: "BGW: Nacht- und Schichtarbeit",
      url: "https://www.bgw-online.de/bgw-online-de/themen/sicher-mit-system/gesundheit-managen/schichtarbeit/schichtarbeit-verlaesslich-planen-und-beschaeftigte-einbinden-24194",
    },
    {
      title: "BAuA: Gestaltung von Nacht- und Schichtarbeit",
      url: "https://www.baua.de/DE/Themen/Arbeitsgestaltung/Arbeitszeit/Nacht-und-Schichtarbeit",
    },
    {
      title: "Garde et al. (2020): Empfehlungen zur Nachtarbeit",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7737811/",
    },
  ],
} as const;

export interface PlanningNightSequence {
  readonly policyVersion: typeof PLANNING_NIGHT_POLICY.version;
  readonly firstNight: string;
  readonly lastNight: string;
  readonly countIsMinimum: boolean;
  readonly recoveryStatus: "under24" | "under48" | "atLeast48" | "open" | "unknown";
  readonly restMinutes: number | null;
  readonly lastShiftId: string;
  readonly nextShiftId: string | null;
}

export function planningDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
}

export function planningNightExplanation(count: number, sequence: PlanningNightSequence): string {
  const series = `${sequence.countIsMinimum ? "Mindestens " : ""}${count} Nächte in Folge.`;
  const rest = sequence.restMinutes === null ? null : planningDuration(sequence.restMinutes);
  switch (sequence.recoveryStatus) {
    case "under24":
      return `${series} Laut deinen Einträgen liegen danach ${rest} ohne Arbeitseinsatz. Prüfe, ob mindestens 24 Stunden, möglichst 48 Stunden, zur Erholung möglich sind.`;
    case "under48":
      return `${series} Laut deinen Einträgen liegen danach ${rest} ohne Arbeitseinsatz. 24 Stunden sind erreicht; möglichst 48 Stunden werden empfohlen.`;
    case "atLeast48":
      return `${series} Laut deinen Einträgen liegen danach ${rest} ohne Arbeitseinsatz. Prüfe, ob sich die Nachtserie verkürzen lässt.`;
    case "open":
      return `${series} Prüfe, ob sich die Nachtserie verkürzen lässt. Die anschließende Erholungszeit ist noch offen.`;
    case "unknown":
      return `${series} Prüfe, ob sich die Nachtserie verkürzen lässt. Die anschließende Erholungszeit ist mit den vorhandenen Angaben nicht beurteilbar.`;
  }
}
