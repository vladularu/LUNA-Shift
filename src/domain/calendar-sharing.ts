export type CalendarSharingVisibility = "DETAILS" | "AVAILABILITY";
export interface SharedCalendarEntry {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly allDay: boolean;
  readonly title: string;
  readonly color: string;
  readonly symbol: string;
}
export interface CloudSharedCalendar {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly color: string;
  readonly visibility: CalendarSharingVisibility;
  readonly revision: number;
  readonly isOwner: boolean;
  readonly publishedAt: string | null;
  readonly deviceId?: string;
}
export interface SharedCalendarSnapshot {
  readonly calendar: CloudSharedCalendar;
  readonly revision: number;
  readonly unchanged: boolean;
  readonly reset: boolean;
  readonly entries: readonly SharedCalendarEntry[];
  readonly fetchedAt: string;
}
export interface LocalSharingBinding {
  readonly accountId: string;
  readonly calendarId: string;
  readonly deviceId: string;
  readonly deviceSecret: string;
  readonly name: string;
  readonly color: string;
  readonly visibility: CalendarSharingVisibility;
  readonly selectedAppointmentIds: readonly string[];
  readonly generation: number;
  readonly acknowledgedGeneration: number;
  readonly serverRevision: number;
  readonly enabled: boolean;
}
export interface SharingPublication {
  readonly accountId: string;
  readonly calendarId: string;
  readonly mutationId: string;
  readonly generation: number;
  readonly expectedRevision: number;
  readonly entries: readonly SharedCalendarEntry[];
}
export interface CachedSharedCalendar {
  readonly accountId: string;
  readonly calendar: CloudSharedCalendar;
  readonly entries: readonly SharedCalendarEntry[];
  readonly fetchedAt: string;
  readonly visible: boolean;
}
