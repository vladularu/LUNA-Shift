/** Contents explicitly selected by the owner for an invitation or one person. */
export interface SharingContentRights {
  readonly shifts: boolean;
  readonly appointments: boolean;
  readonly notes: boolean;
}
export interface SharingSourceContent {
  /** A restored source must not inherit remote note/appointment consent. */
  readonly consentReset?: true;
  readonly version: 2;
  readonly shifts: boolean;
  readonly allAppointments: boolean;
  readonly notes: boolean;
}
export const DEFAULT_SHARING_RIGHTS: SharingContentRights = Object.freeze({
  shifts: true,
  appointments: false,
  notes: false,
});
export const LEGACY_SHARING_RIGHTS: SharingContentRights = Object.freeze({
  shifts: true,
  appointments: true,
  notes: false,
});
export function sharingContentSignature(content?: SharingSourceContent): string {
  return JSON.stringify(content ?? null);
}
