import type { CalendarEntry } from "./types";
import type {
  CachedSharedCalendar,
  CalendarSharingVisibility,
  CloudSharedCalendar,
  LocalSharingBinding,
  SharedCalendarSnapshot,
  SharingPublication,
} from "./calendar-sharing";
export type SharingAuthUser = { id: string; displayName: string };
export interface SharingAuthPort {
  isConfigured: boolean;
  getSession(): Promise<SharingAuthUser | null>;
  subscribe(listener: (user: SharingAuthUser | null) => void): () => void;
  signInApple(): Promise<SharingAuthUser | null>;
  signInGoogle(): Promise<SharingAuthUser | null>;
  signOut(): Promise<void>;
}
export interface SharingCloudMember {
  readonly userId: string;
  readonly displayName: string;
  readonly status: "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED" | "LEFT";
  readonly requestedAt: string;
  readonly updatedAt: string;
}
export interface SharingCloudInvite {
  readonly inviteId: string;
  readonly calendarId: string;
  readonly token: string | null;
  readonly expiresAt: string;
}
export interface SharingCloudMembers {
  readonly members: readonly SharingCloudMember[];
  readonly invites: readonly {
    readonly id: string;
    readonly expiresAt: string;
    readonly consumedAt: string | null;
    readonly revokedAt: string | null;
  }[];
}
export type SharingRevocationStatus =
  "not_applicable" | "revoked" | "manual_required" | "unconfirmed";
export interface SharingCloudPort {
  saveProfile(
    expectedAccountId: string,
    displayName: string,
  ): Promise<{ readonly userId: string; readonly displayName: string }>;
  createCalendar(draft: {
    readonly expectedAccountId: string;
    readonly id: string;
    readonly deviceId: string;
    readonly deviceSecret: string;
    readonly name: string;
    readonly color: string;
    readonly visibility: CalendarSharingVisibility;
  }): Promise<CloudSharedCalendar>;
  publish(
    binding: LocalSharingBinding,
    publication: SharingPublication,
  ): Promise<{
    readonly calendarId: string;
    readonly revision: number;
    readonly publishedAt: string;
  }>;
  listCalendars(): Promise<readonly CloudSharedCalendar[]>;
  fetch(calendarId: string, afterRevision: number | null): Promise<SharedCalendarSnapshot>;
  createInvite(calendarId: string, mutationId: string): Promise<SharingCloudInvite>;
  claimInvite(
    expectedAccountId: string,
    token: string,
    displayName: string,
  ): Promise<{
    readonly calendarId: string;
    readonly calendarName: string;
    readonly status: string;
  }>;
  listMembers(calendarId: string): Promise<SharingCloudMembers>;
  setMember(
    calendarId: string,
    userId: string,
    action: "APPROVE" | "REJECT" | "REVOKE",
  ): Promise<SharingCloudMember>;
  revokeInvite(calendarId: string, inviteId: string): Promise<{ readonly revoked: true }>;
  leaveCalendar(expectedAccountId: string, calendarId: string): Promise<{ readonly left: true }>;
  deleteCalendar(calendarId: string): Promise<{ readonly deleted: true }>;
  deleteAccount(
    expectedAccountId: string,
    appleAuthorizationCode?: string | null,
  ): Promise<{ readonly deleted: true; readonly revocationStatus: SharingRevocationStatus }>;
}
/** Bound to a fresh local safe projection; never contains private notes or places. */
export interface SharingPublicationConfirmation {
  readonly generation: number;
  readonly visibility: CalendarSharingVisibility;
  readonly selectedAppointmentIds: readonly string[];
  readonly projection: string;
  readonly serverRevision: number;
}
export interface SharingLocalPort {
  initialize(): Promise<void>;
  setActiveAccount(accountId: string | null): Promise<void>;
  listBindings(accountId: string): Promise<readonly LocalSharingBinding[]>;
  stagePublication(
    binding: LocalSharingBinding,
    timeZone: string,
    makeId: () => string,
  ): Promise<SharingPublication | null>;
  stageConfirmedPublication(
    binding: LocalSharingBinding,
    timeZone: string,
    makeId: () => string,
    confirmation: SharingPublicationConfirmation,
  ): Promise<SharingPublication>;
  acknowledgePublication(publication: SharingPublication, revision: number): Promise<void>;
  resumePublication(accountId: string, calendarId: string): Promise<void>;
  clearConflict(accountId: string, calendarId: string, serverRevision: number): Promise<void>;
  listCaches(accountId: string): Promise<readonly CachedSharedCalendar[]>;
  cacheSnapshot(accountId: string, snapshot: SharedCalendarSnapshot): Promise<void>;
  removeCalendar(accountId: string, calendarId: string): Promise<void>;
  setVisible(accountId: string, calendarId: string, visible: boolean): Promise<void>;
  forgetAccount(accountId: string): Promise<void>;
  readEntries(): Promise<readonly CalendarEntry[]>;
  bindCalendar(
    accountId: string,
    calendar: CloudSharedCalendar,
    deviceSecret: string,
    selectedAppointmentIds: readonly string[],
  ): Promise<void>;
}
export type AppleDeletionPreparation =
  | { readonly status: "authorized"; readonly authorizationCode: string }
  | { readonly status: "cancelled" }
  | { readonly status: "manualRevocationRequired" };
