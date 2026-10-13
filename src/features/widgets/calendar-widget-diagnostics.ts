export interface CalendarWidgetDiagnostics {
  readonly nativeAvailable: boolean;
  readonly groupAvailable: boolean;
  readonly entryCount: number;
  readonly currentState: "ready" | "setup" | "expired" | null;
  readonly errorClass?: string;
  readonly dataFormat?: "calendar";
  readonly weekDayCount?: number;
  readonly monthDayCount?: number;
  readonly themeMode?: "light" | "dark" | "system" | null;
  readonly hasPhoto?: boolean;
}

export const NO_CALENDAR_WIDGET: CalendarWidgetDiagnostics = {
  nativeAvailable: false,
  groupAvailable: false,
  entryCount: 0,
  currentState: null,
};

export function widgetTimelineDiagnostics(
  entries: readonly {
    readonly date: Date;
    readonly props: {
      readonly state?: string;
      readonly weekDays?: unknown;
      readonly monthDays?: unknown;
      readonly themeMode?: unknown;
      readonly backgroundFileName?: unknown;
    };
  }[],
  now: Date,
): Pick<
  CalendarWidgetDiagnostics,
  | "entryCount"
  | "currentState"
  | "dataFormat"
  | "weekDayCount"
  | "monthDayCount"
  | "themeMode"
  | "hasPhoto"
> {
  const current = entries
    .filter((entry) => Number.isFinite(entry.date.getTime()) && entry.date <= now)
    .sort((left, right) => right.date.getTime() - left.date.getTime())[0];
  const state = current?.props.state;
  const weeks = current?.props.weekDays,
    month = current?.props.monthDays,
    mode = current?.props.themeMode;
  return {
    entryCount: entries.length,
    currentState: state === "ready" || state === "setup" || state === "expired" ? state : null,
    ...(Array.isArray(weeks) && Array.isArray(month)
      ? {
          dataFormat: "calendar" as const,
          weekDayCount: weeks.length,
          monthDayCount: month.length,
          themeMode: mode === "light" || mode === "dark" || mode === "system" ? mode : null,
          hasPhoto:
            typeof current?.props.backgroundFileName === "string" &&
            current.props.backgroundFileName.length > 0,
        }
      : {}),
  };
}

export function widgetDiagnosticErrorClass(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : "UnknownError";
}
