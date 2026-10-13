/** Prop-only UI boundary. The application layer owns auth, RPCs, sync and OS sharing. */
export type SharingVisibility = "DETAILS" | "AVAILABILITY";
export type SharingMemberAction = "APPROVE" | "REJECT" | "REVOKE";
export interface SharingMemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly status: "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED" | "LEFT";
}
export interface SharingInviteView {
  readonly id: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
}
export interface SharingCalendarView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly visibility: SharingVisibility;
  readonly isOwner: boolean;
  readonly visible: boolean;
  /** Local explicit consent; a restored binding clears this selection. */
  readonly selectedAppointmentIds?: readonly string[];
  readonly publishedAt: string | null;
  readonly syncState: "current" | "pending" | "offline" | "expired" | "otherDevice";
  readonly members: readonly SharingMemberView[];
  readonly invites: readonly SharingInviteView[];
}
export interface SharingPreview {
  readonly entryCount: number;
  readonly entries: readonly { readonly title: string; readonly when: string }[];
}
export interface SharingPublicationPreview extends SharingPreview {
  /** Opaque, account-scoped, single-use confirmation for this exact local snapshot. */
  readonly confirmationId: string;
}
export interface SharingController {
  readonly status: "loading" | "unavailable" | "signedOut" | "signedIn";
  readonly account: { readonly displayName: string } | null;
  readonly busy: boolean;
  /** Boolean deliberately prevents raw backend errors reaching the UI. */
  readonly error: boolean;
  readonly calendars: readonly SharingCalendarView[];
  readonly availableAppointments: readonly {
    readonly id: string;
    readonly title: string;
    readonly date: string;
  }[];
  readonly claimResult: {
    readonly calendarName: string;
    readonly status: "PENDING" | "ACTIVE";
  } | null;
  readonly appleAvailable: boolean;
  readonly accountDeletionAvailable: boolean;
  preview(
    visibility: SharingVisibility,
    selectedAppointmentIds?: readonly string[],
  ): SharingPreview;
  signIn(provider: "apple" | "google"): Promise<void>;
  refresh(): Promise<void>;
  createCalendar(draft: {
    readonly name: string;
    readonly color: string;
    readonly visibility: SharingVisibility;
    readonly confirmed: true;
    readonly selectedAppointmentIds?: readonly string[];
  }): Promise<void>;
  /** Reads current local rows without network publication or enabling a paused binding. */
  preparePublicationPreview(calendarId: string): Promise<SharingPublicationPreview>;
  publishCalendar(calendarId: string, confirmationId: string): Promise<void>;
  setVisible(calendarId: string, visible: boolean): Promise<void>;
  /** Creates one-use seven-day invitation then opens OS Share, only on explicit press. */
  invite(calendarId: string): Promise<void>;
  setMember(calendarId: string, userId: string, action: SharingMemberAction): Promise<void>;
  revokeInvite(calendarId: string, inviteId: string): Promise<void>;
  deleteCalendar(calendarId: string): Promise<void>;
  leaveCalendar(calendarId: string): Promise<void>;
  claimInvite(token: string, displayName: string): Promise<void>;
  signOut(): Promise<void>;
  /** Cloud deletion only. Local shifts, settings and salary data remain on this device. */
  deleteAccount(): Promise<void>;
}
