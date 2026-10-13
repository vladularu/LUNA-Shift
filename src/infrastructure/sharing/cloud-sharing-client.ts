import type { SharingContentRights } from "../../domain/sharing-content";
import { Temporal } from "@js-temporal/polyfill";
import type {
  CalendarSharingVisibility,
  CloudSharedCalendar,
  LocalSharingBinding,
  SharedCalendarEntry,
  SharedCalendarSnapshot,
  SharingPublication,
} from "../../domain/calendar-sharing";

export interface SharingCloudTransport {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
}
export interface SharingCloudMember {
  readonly rights?: SharingContentRights;
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
    readonly rights?: SharingContentRights;
    readonly joinedCount?: number;
  }[];
}
export type SharingRevocationStatus =
  "not_applicable" | "revoked" | "manual_required" | "unconfirmed";
export interface SharingAccountDeletion {
  readonly deleted: true;
  readonly revocationStatus: SharingRevocationStatus;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const COLOR = /^#[a-f0-9]{6}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const SYMBOLS = [
  "calendar",
  "sunrise",
  "sun",
  "moon",
  "home",
  "book",
  "clock",
  "star",
  "unavailable",
];
const ERRORS = new Set([
  "SHARE_UNAUTHENTICATED",
  "SHARE_NOT_FOUND",
  "SHARE_INVALID_ARGUMENT",
  "SHARE_REVISION_CONFLICT",
  "SHARE_MUTATION_REUSED",
  "SHARE_DEVICE_MISMATCH",
  "SHARE_INVITE_INVALID",
  "SHARE_MEMBER_INVALID",
  "SHARE_OWNER_CANNOT_LEAVE",
  "SHARE_SESSION_INVALID",
  "SHARE_APPLE_IDENTITY_MISMATCH",
  "SHARE_INVALID_RESPONSE",
  "SHARE_NETWORK_FAILED",
  "SHARE_DELETE_FAILED",
  "SHARE_RATE_LIMIT",
  "SHARE_PROVIDER_REVOKE_REQUIRED",
  "SHARE_ACCOUNT_MISMATCH",
]);
export class SharingCloudError extends Error {
  constructor(readonly code: string) {
    super(ERRORS.has(code) ? code : "SHARE_NETWORK_FAILED");
    this.name = "SharingCloudError";
    this.code = this.message;
  }
}
const fail = (code = "SHARE_INVALID_RESPONSE"): never => {
  throw new SharingCloudError(code);
};
function object(
  value: unknown,
  keys: readonly string[],
  required: readonly string[] = keys,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some((key) => !keys.includes(key)) ||
    required.some((key) => !Object.hasOwn(r, key))
  )
    return fail();
  return r;
}
function text(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  )
    return fail();
  return value;
}
function id(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) return fail();
  return value.toLowerCase();
}
function revision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail();
  return value;
}
function instant(value: unknown) {
  const result = text(value, 40);
  if (!INSTANT.test(result)) return fail();
  try {
    Temporal.Instant.from(result);
  } catch {
    return fail();
  }
  return result;
}
function nullableInstant(value: unknown) {
  return value === null ? null : instant(value);
}
function color(value: unknown) {
  const result = text(value, 7);
  if (!COLOR.test(result)) return fail();
  return result;
}
function visibility(value: unknown): CalendarSharingVisibility {
  if (value !== "DETAILS" && value !== "AVAILABILITY") return fail();
  return value;
}
function boolean(value: unknown) {
  if (typeof value !== "boolean") return fail();
  return value;
}
function list<T>(value: unknown, limit: number, parse: (value: unknown) => T): readonly T[] {
  if (!Array.isArray(value) || value.length > limit) return fail();
  return Object.freeze(value.map(parse));
}
function unique<T>(values: readonly T[], getKey: (value: T) => string) {
  const keys = values.map(getKey);
  if (new Set(keys).size !== keys.length) return fail();
  return values;
}
function parseCalendar(value: unknown): CloudSharedCalendar {
  const r = object(
    value,
    [
      "id",
      "ownerId",
      "name",
      "color",
      "visibility",
      "revision",
      "isOwner",
      "publishedAt",
      "deviceId",
    ],
    ["id", "ownerId", "name", "color", "visibility", "revision", "isOwner", "publishedAt"],
  );
  const isOwner = boolean(r.isOwner);
  if (isOwner ? !Object.hasOwn(r, "deviceId") : Object.hasOwn(r, "deviceId")) return fail();
  return Object.freeze({
    id: id(r.id),
    ownerId: id(r.ownerId),
    name: text(r.name, 80),
    color: color(r.color),
    visibility: visibility(r.visibility),
    revision: revision(r.revision),
    isOwner,
    publishedAt: nullableInstant(r.publishedAt),
    ...(isOwner ? { deviceId: id(r.deviceId) } : {}),
  });
}
function parseEntry(value: unknown): SharedCalendarEntry {
  const r = object(value, [
    "id",
    "startsAt",
    "endsAt",
    "timeZone",
    "allDay",
    "title",
    "color",
    "symbol",
  ]);
  const startsAt = instant(r.startsAt),
    endsAt = instant(r.endsAt),
    timeZone = text(r.timeZone, 100);
  try {
    Temporal.Instant.from(startsAt).toZonedDateTimeISO(timeZone);
  } catch {
    return fail();
  }
  if (
    Temporal.Instant.compare(startsAt, endsAt) >= 0 ||
    Temporal.Instant.compare(endsAt, Temporal.Instant.from(startsAt).add({ hours: 48 })) > 0 ||
    !SYMBOLS.includes(text(r.symbol, 20))
  )
    return fail();
  return Object.freeze({
    id: id(r.id),
    startsAt,
    endsAt,
    timeZone,
    allDay: boolean(r.allDay),
    title: text(r.title, 128),
    color: color(r.color),
    symbol: r.symbol as string,
  });
}
function parseMember(value: unknown): SharingCloudMember {
  const r = object(value, ["userId", "displayName", "status", "requestedAt", "updatedAt"]);
  if (!["PENDING", "ACTIVE", "REJECTED", "REVOKED", "LEFT"].includes(String(r.status)))
    return fail();
  return Object.freeze({
    userId: id(r.userId),
    displayName: text(r.displayName, 80),
    status: r.status as SharingCloudMember["status"],
    requestedAt: instant(r.requestedAt),
    updatedAt: instant(r.updatedAt),
  });
}
function input<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new SharingCloudError("SHARE_INVALID_ARGUMENT");
  }
}
function transportError(error: unknown): SharingCloudError {
  if (error instanceof SharingCloudError) return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    ERRORS.has(error.message)
  )
    return new SharingCloudError(error.message);
  return new SharingCloudError("SHARE_NETWORK_FAILED");
}
function parseRights(value: unknown): SharingContentRights {
  const r = object(value, ["shifts", "appointments", "notes"]);
  return Object.freeze({
    shifts: boolean(r.shifts),
    appointments: boolean(r.appointments),
    notes: boolean(r.notes),
  });
}
function parseEntryV2(value: unknown): SharedCalendarEntry {
  const r = object(value, [
    "id",
    "startsAt",
    "endsAt",
    "timeZone",
    "allDay",
    "title",
    "color",
    "symbol",
    "kind",
    "note",
  ]);
  if (r.kind !== null && r.kind !== "SHIFT" && r.kind !== "APPOINTMENT") return fail();
  if (
    r.note !== null &&
    (typeof r.note !== "string" ||
      r.note.length > 4096 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(r.note))
  )
    return fail();
  const { kind, note, ...base } = r;
  return Object.freeze({
    ...parseEntry(base),
    kind: kind as SharedCalendarEntry["kind"],
    note: note as string | null,
  });
}
function parseMemberV2(value: unknown): SharingCloudMember {
  const r = object(value, [
    "userId",
    "displayName",
    "status",
    "requestedAt",
    "updatedAt",
    "rights",
  ]);
  const { rights, ...base } = r;
  return Object.freeze({
    ...parseMember(base),
    ...(rights === null ? {} : { rights: parseRights(rights) }),
  });
}
export function createCloudSharingClient(client: SharingCloudTransport) {
  let contentRights = false;
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let result: { data: unknown; error: unknown };
    try {
      result = await client.rpc(name, args);
    } catch (error) {
      throw transportError(error);
    }
    if (result.error) throw transportError(result.error);
    return parse(result.data);
  }
  function calendarId(value: string) {
    return input(() => id(value));
  }
  return {
    async supportsContentRights() {
      const result = await client.rpc("sharing_capabilities", {});
      if (
        result.error &&
        typeof result.error === "object" &&
        "code" in result.error &&
        ["PGRST202", "42883"].includes(String(result.error.code))
      ) {
        contentRights = false;
        return false;
      }
      if (result.error) throw transportError(result.error);
      const r = object(result.data, ["contentVersion"]);
      if (r.contentVersion !== 2) return fail();
      contentRights = true;
      return true;
    },
    async setMemberRights(value: string, userId: string, rights: SharingContentRights) {
      if (!contentRights) throw new SharingCloudError("SHARE_INVALID_ARGUMENT");
      const requested = input(() => id(userId));
      return rpc(
        "sharing_set_member_rights",
        {
          p_calendar_id: calendarId(value),
          p_user_id: requested,
          p_rights: input(() => parseRights(rights)),
        },
        (result) => {
          const member = parseMemberV2(result);
          if (member.userId !== requested) return fail();
          return member;
        },
      );
    },
    async saveProfile(expectedAccountId: string, displayName: string) {
      const actor = input(() => id(expectedAccountId));
      const name = input(() => text(displayName, 80));
      return rpc(
        "sharing_save_profile",
        { p_expected_actor_id: actor, p_display_name: name },
        (value) => {
          const r = object(value, ["userId", "displayName"]);
          const result = Object.freeze({
            userId: id(r.userId),
            displayName: text(r.displayName, 80),
          });
          if (result.userId !== actor) return fail();
          return result;
        },
      );
    },
    async createCalendar(draft: {
      readonly expectedAccountId: string;
      readonly id: string;
      readonly deviceId: string;
      readonly deviceSecret: string;
      readonly name: string;
      readonly color: string;
      readonly visibility: CalendarSharingVisibility;
    }) {
      const args = input(() => {
        if (!HEX.test(draft.deviceSecret)) return fail();
        return {
          p_expected_actor_id: id(draft.expectedAccountId),
          p_calendar_id: id(draft.id),
          p_device_id: id(draft.deviceId),
          p_device_secret: draft.deviceSecret,
          p_name: text(draft.name, 80),
          p_color: color(draft.color),
          p_visibility: visibility(draft.visibility),
        };
      });
      return rpc("sharing_create_calendar", args, (value) => {
        const c = parseCalendar(value);
        if (
          c.ownerId !== args.p_expected_actor_id ||
          c.id !== args.p_calendar_id ||
          c.deviceId !== args.p_device_id ||
          !c.isOwner ||
          c.name !== args.p_name.trim() ||
          c.color !== args.p_color ||
          c.visibility !== args.p_visibility
        )
          return fail();
        return c;
      });
    },
    async publish(binding: LocalSharingBinding, publication: SharingPublication) {
      const args = input(() => {
        if (
          binding.calendarId !== publication.calendarId ||
          binding.accountId !== publication.accountId ||
          !HEX.test(binding.deviceSecret) ||
          !binding.enabled
        )
          return fail();
        const entries = unique(
          list(publication.entries, 10000, binding.content ? parseEntryV2 : parseEntry),
          (e) => e.id,
        );
        if (
          binding.visibility === "AVAILABILITY" &&
          entries.some(
            (e) =>
              e.title !== "Nicht verfügbar" || e.color !== "#737373" || e.symbol !== "unavailable",
          )
        )
          return fail();
        return {
          p_calendar_id: id(binding.calendarId),
          p_device_id: id(binding.deviceId),
          p_device_secret: binding.deviceSecret,
          p_mutation_id: id(publication.mutationId),
          p_expected_revision: revision(publication.expectedRevision),
          p_entries: entries,
        };
      });
      return rpc(
        binding.content ? "sharing_publish_calendar_v2" : "sharing_publish_calendar",
        args,
        (value) => {
          const r = object(value, ["calendarId", "revision", "publishedAt"]);
          const result = Object.freeze({
            calendarId: id(r.calendarId),
            revision: revision(r.revision),
            publishedAt: instant(r.publishedAt),
          });
          if (
            result.calendarId !== args.p_calendar_id ||
            result.revision !== args.p_expected_revision + 1
          )
            return fail();
          return result;
        },
      );
    },
    async listCalendars() {
      return rpc("sharing_list_calendars", {}, (value) =>
        unique(list(value, 1000, parseCalendar), (c) => c.id),
      );
    },
    async fetch(value: string, afterRevision: number | null): Promise<SharedCalendarSnapshot> {
      const requested = calendarId(value),
        cursor = input(() => (afterRevision === null ? null : revision(afterRevision)));
      return rpc(
        contentRights ? "sharing_fetch_calendar_v2" : "sharing_fetch_calendar",
        { p_calendar_id: requested, p_after_revision: cursor },
        (value) => {
          const r = object(value, [
            "calendar",
            "revision",
            "unchanged",
            "reset",
            "entries",
            "fetchedAt",
          ]);
          const calendar = parseCalendar(r.calendar),
            current = revision(r.revision),
            unchanged = boolean(r.unchanged),
            reset = boolean(r.reset),
            entries = unique(
              list(r.entries, 10000, contentRights ? parseEntryV2 : parseEntry),
              (e) => e.id,
            );
          if (
            calendar.id !== requested ||
            calendar.revision !== current ||
            reset === unchanged ||
            (unchanged && (cursor !== current || entries.length !== 0)) ||
            (!unchanged && cursor === current)
          )
            return fail();
          if (
            calendar.visibility === "AVAILABILITY" &&
            entries.some(
              (e) =>
                e.title !== "Nicht verfügbar" ||
                e.color !== "#737373" ||
                e.symbol !== "unavailable",
            )
          )
            return fail();
          return Object.freeze({
            calendar: contentRights ? { ...calendar, contentVersion: 2 as const } : calendar,
            revision: current,
            unchanged,
            reset,
            entries,
            fetchedAt: instant(r.fetchedAt),
          });
        },
      );
    },
    async createInvite(
      value: string,
      mutationId: string,
      rights?: SharingContentRights,
    ): Promise<SharingCloudInvite> {
      const requested = calendarId(value),
        mutation = input(() => id(mutationId));
      return rpc(
        rights ? "sharing_create_invite_v2" : "sharing_create_invite",
        {
          p_calendar_id: requested,
          p_mutation_id: mutation,
          ...(rights ? { p_rights: input(() => parseRights(rights)) } : {}),
        },
        (value) => {
          const r = object(value, ["inviteId", "calendarId", "token", "expiresAt"]);
          if (r.token !== null && (typeof r.token !== "string" || !HEX.test(r.token)))
            return fail();
          const result = Object.freeze({
            inviteId: id(r.inviteId),
            calendarId: id(r.calendarId),
            token: r.token as string | null,
            expiresAt: instant(r.expiresAt),
          });
          if (result.calendarId !== requested) return fail();
          return result;
        },
      );
    },
    async claimInvite(expectedAccountId: string, token: string, displayName: string) {
      const actor = input(() => id(expectedAccountId));
      const name = input(() => {
        if (!HEX.test(token)) return fail();
        return text(displayName, 80);
      });
      return rpc(
        "sharing_claim_invite",
        { p_expected_actor_id: actor, p_token: token, p_display_name: name },
        (value) => {
          const r = object(value, ["calendarId", "calendarName", "status"]);
          if (r.status !== "PENDING" && r.status !== "ACTIVE") return fail();
          return Object.freeze({
            calendarId: id(r.calendarId),
            calendarName: text(r.calendarName, 80),
            status: r.status,
          });
        },
      );
    },
    async listMembers(value: string): Promise<SharingCloudMembers> {
      return rpc(
        contentRights ? "sharing_list_members_v2" : "sharing_list_members",
        { p_calendar_id: calendarId(value) },
        (value) => {
          const r = object(value, ["members", "invites"]);
          return Object.freeze({
            members: unique(
              list(r.members, 1000, contentRights ? parseMemberV2 : parseMember),
              (m) => m.userId,
            ),
            invites: unique(
              list(r.invites, 10000, (value) => {
                const i = object(value, [
                  "id",
                  "expiresAt",
                  "consumedAt",
                  "revokedAt",
                  ...(contentRights ? ["rights", "joinedCount"] : []),
                ]);
                return Object.freeze({
                  id: id(i.id),
                  expiresAt: instant(i.expiresAt),
                  consumedAt: nullableInstant(i.consumedAt),
                  revokedAt: nullableInstant(i.revokedAt),
                  ...(contentRights ? { joinedCount: revision(i.joinedCount) } : {}),
                  ...(contentRights && i.rights !== null ? { rights: parseRights(i.rights) } : {}),
                });
              }),
              (i) => i.id,
            ),
          });
        },
      );
    },
    async setMember(value: string, userId: string, action: "APPROVE" | "REJECT" | "REVOKE") {
      const requested = input(() => id(userId));
      input(() => {
        if (!["APPROVE", "REJECT", "REVOKE"].includes(action)) return fail();
      });
      return rpc(
        "sharing_set_member",
        { p_calendar_id: calendarId(value), p_user_id: requested, p_action: action },
        (value) => {
          const m = parseMember(value);
          if (
            m.userId !== requested ||
            m.status !== { APPROVE: "ACTIVE", REJECT: "REJECTED", REVOKE: "REVOKED" }[action]
          )
            return fail();
          return m;
        },
      );
    },
    async revokeInvite(value: string, inviteId: string) {
      return rpc(
        "sharing_revoke_invite",
        { p_calendar_id: calendarId(value), p_invite_id: input(() => id(inviteId)) },
        (value) => {
          const r = object(value, ["revoked"]);
          if (r.revoked !== true) return fail();
          return Object.freeze({ revoked: true as const });
        },
      );
    },
    async leaveCalendar(expectedAccountId: string, value: string) {
      const actor = input(() => id(expectedAccountId));
      return rpc(
        "sharing_leave_calendar",
        { p_expected_actor_id: actor, p_calendar_id: calendarId(value) },
        (value) => {
          const r = object(value, ["left"]);
          if (r.left !== true) return fail();
          return Object.freeze({ left: true as const });
        },
      );
    },
    async deleteCalendar(value: string) {
      return rpc("sharing_delete_calendar", { p_calendar_id: calendarId(value) }, (value) => {
        const r = object(value, ["deleted"]);
        if (r.deleted !== true) return fail();
        return Object.freeze({ deleted: true as const });
      });
    },
    async deleteAccount(
      expectedAccountId: string,
      appleAuthorizationCode?: string | null,
    ): Promise<SharingAccountDeletion> {
      const body = input(() => ({
        expectedAccountId: id(expectedAccountId),
        ...(appleAuthorizationCode
          ? { appleAuthorizationCode: text(appleAuthorizationCode, 4096) }
          : {}),
      }));
      let result: { data: unknown; error: unknown };
      try {
        result = await client.functions.invoke("sharing-delete-account", { body });
      } catch (error) {
        throw transportError(error);
      }
      if (result.error) throw transportError(result.error);
      const r = object(result.data, ["deleted", "revocationStatus"]);
      if (
        r.deleted !== true ||
        !["not_applicable", "revoked", "manual_required", "unconfirmed"].includes(
          String(r.revocationStatus),
        )
      )
        return fail();
      return Object.freeze({
        deleted: true,
        revocationStatus: r.revocationStatus as SharingRevocationStatus,
      });
    },
  };
}
export type CloudSharingClient = ReturnType<typeof createCloudSharingClient>;
