import { sharingContentSignature, type SharingContentRights } from "@/domain/sharing-content";
import type {
  SharingAuthPort,
  SharingAuthUser,
  SharingCloudPort,
  SharingCloudMembers,
  SharingRevocationStatus,
  SharingLocalPort,
  AppleDeletionPreparation,
  SharingPublicationConfirmation,
} from "@/domain/calendar-sharing-ports";

import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEntry } from "@/domain/types";
import type {
  CachedSharedCalendar,
  CalendarSharingVisibility,
  LocalSharingBinding,
  SharedCalendarEntry,
  SharingPublication,
} from "@/domain/calendar-sharing";

import type {
  SharingController,
  SharingCalendarView,
  SharingPreview,
  SharingDeliveryChannel,
  SharingInvitation,
} from "@/domain/sharing-ui-contract";
import { projectSharingEntries } from "@/engine/sharing-projection";
import { sharingProjectionSignature } from "@/engine/sharing-publication-confirmation";

export const SHARED_CALENDAR_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export interface CalendarSharingRuntimeOptions {
  auth: SharingAuthPort;
  cloud: SharingCloudPort | null;
  local: SharingLocalPort;
  getInput(): { readonly timeZone: string; readonly testLabActive: boolean };
  now(): number;
  makeId(): string;
  makeSecret(): string;
  appleAvailable: boolean;
  shareUrl(url: string, channel?: SharingDeliveryChannel): Promise<void>;
  copyUrl?(url: string): Promise<void>;
  inviteUrl(token: string): string;
  isAppleUser(): Promise<boolean>;
  prepareAppleDeletion(): Promise<AppleDeletionPreparation>;
  confirmManualAppleDeletion(): Promise<boolean>;
  notifyDeletion(status: SharingRevocationStatus): void;
  forgetAuthProfile(userId: string): Promise<void>;
}
export interface CalendarSharingRuntimeSnapshot {
  readonly controller: SharingController;
  readonly visibleCalendars: readonly CachedSharedCalendar[];
}
class AccountChanged extends Error {}
function accountChanged(): never {
  throw new AccountChanged("SHARE_ACCOUNT_CHANGED");
}
function cacheUsable(cache: CachedSharedCalendar, now: number): boolean {
  const stamp = Date.parse(cache.fetchedAt);
  const age = now - stamp;
  return Number.isFinite(stamp) && age >= -5 * 60 * 1000 && age < SHARED_CALENDAR_CACHE_MAX_AGE_MS;
}
function sessionDenied(error: unknown): boolean {
  return ["SHARE_UNAUTHENTICATED", "SHARE_SESSION_INVALID"].includes(errorCode(error) ?? "");
}
function errorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^SHARE_[A-Z_]+$/.test(error.code)
  )
    return error.code;
  return error instanceof Error && /^SHARE_[A-Z_]+$/.test(error.message) ? error.message : null;
}
function previewWhen(startsAt: string, endsAt: string, timeZone: string, allDay: boolean): string {
  const from = Temporal.Instant.from(startsAt).toZonedDateTimeISO(timeZone);
  const to = Temporal.Instant.from(endsAt).toZonedDateTimeISO(timeZone);
  const date = `${String(from.day).padStart(2, "0")}.${String(from.month).padStart(2, "0")}.`;
  if (allDay) return `${date} · Ganztägig`;
  const clock = (value: typeof from) =>
    `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  return `${date} · ${clock(from)}–${clock(to)}${from.toPlainDate().equals(to.toPlainDate()) ? "" : " · Folgetag"}`;
}

function safePreview(entries: readonly SharedCalendarEntry[]): SharingPreview {
  return {
    entryCount: entries.length,
    entries: entries.slice(0, 6).map((entry) => ({
      title: entry.title,
      when: previewWhen(entry.startsAt, entry.endsAt, entry.timeZone, entry.allDay),
    })),
  };
}
function samePublicationConsent(a: LocalSharingBinding, b: LocalSharingBinding): boolean {
  return (
    a.generation === b.generation &&
    a.visibility === b.visibility &&
    sharingContentSignature(a.content) === sharingContentSignature(b.content) &&
    JSON.stringify([...a.selectedAppointmentIds].sort()) ===
      JSON.stringify([...b.selectedAppointmentIds].sort())
  );
}

/** Serial worker: no React/native dependency; every continuation remains account scoped. */
export function createCalendarSharingRuntime(options: CalendarSharingRuntimeOptions) {
  let inputOverride: ReturnType<CalendarSharingRuntimeOptions["getInput"]> | null = null;
  let appleAvailable = options.appleAvailable;
  let cachedSnapshot: CalendarSharingRuntimeSnapshot | null = null;
  const readInput = () => inputOverride ?? options.getInput();
  let stopped = false;
  let epoch = 0;
  let authRevision = 0;
  let user: SharingAuthUser | null = null;
  let status: SharingController["status"] = "loading";
  let busyTicket: number | null = null;
  let failed = false;
  let offline = false;
  let contentRightsAvailable = false;
  let issuedInvitations: readonly SharingInvitation[] = [];
  let caches: readonly CachedSharedCalendar[] = [];
  let bindings: readonly LocalSharingBinding[] = [];
  let source: readonly CalendarEntry[] = [];
  let claimResult: SharingController["claimResult"] = null;
  const prepared = new Map<
    string,
    {
      readonly ticket: number;
      readonly accountId: string;
      readonly calendarId: string;
      readonly binding: LocalSharingBinding;
      readonly timeZone: string;
      readonly confirmation: Omit<SharingPublicationConfirmation, "serverRevision">;
    }
  >();
  let members = new Map<string, SharingCloudMembers>();
  let tail: Promise<unknown> = Promise.resolve();
  let activation: Promise<void> = Promise.resolve();
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  let unsubscribe = () => {};
  const listeners = new Set<() => void>();
  const emit = () => {
    cachedSnapshot = null;
    if (!stopped) for (const listener of listeners) listener();
  };
  const valid = (ticket: number, accountId?: string) =>
    !stopped && ticket === epoch && (!accountId || user?.id === accountId);
  const check = (ticket: number, accountId?: string) => {
    if (!valid(ticket, accountId)) accountChanged();
  };
  function queue<T>(job: () => Promise<T>): Promise<T> {
    const task = tail.then(job);
    tail = task.catch(() => {});
    return task;
  }
  function cloud(): SharingCloudPort {
    if (!options.cloud || !options.auth.isConfigured) throw new Error("SHARE_UNAVAILABLE");
    return options.cloud;
  }
  function actor(): { ticket: number; accountId: string } {
    if (!user || status !== "signedIn") throw new Error("SHARE_UNAUTHENTICATED");
    return { ticket: epoch, accountId: user.id };
  }
  async function localState(ticket: number, accountId: string) {
    check(ticket, accountId);
    const nextCaches = await options.local.listCaches(accountId);
    check(ticket, accountId);
    const nextBindings = await options.local.listBindings(accountId);
    check(ticket, accountId);
    const nextSource = await options.local.readEntries();
    check(ticket, accountId);
    const nextInvitations = (await options.local.listInvitations?.(accountId)) ?? [];
    check(ticket, accountId);
    issuedInvitations = nextInvitations;
    caches = nextCaches;
    bindings = nextBindings;
    source = nextSource;
    emit();
  }
  async function remove(ticket: number, accountId: string, calendarId: string) {
    check(ticket, accountId);
    await options.local.removeCalendar(accountId, calendarId);
    check(ticket, accountId);
    caches = caches.filter((item) => item.calendar.id !== calendarId);
    bindings = bindings.filter((item) => item.calendarId !== calendarId);
    members.delete(calendarId);
  }
  async function pauseConflict(ticket: number, accountId: string, binding: LocalSharingBinding) {
    let revision = binding.serverRevision;
    try {
      const snapshot = await cloud().fetch(binding.calendarId, null);
      check(ticket, accountId);
      revision = snapshot.revision;
      await options.local.cacheSnapshot(accountId, snapshot);
      check(ticket, accountId);
    } catch (error) {
      if (error instanceof AccountChanged || sessionDenied(error)) throw error;
      if (errorCode(error) === "SHARE_NOT_FOUND") {
        await remove(ticket, accountId, binding.calendarId);
        return;
      }
    }
    check(ticket, accountId);
    await options.local.clearConflict(accountId, binding.calendarId, revision);
    check(ticket, accountId);
    await localState(ticket, accountId);
  }
  async function publishBinding(ticket: number, accountId: string, binding: LocalSharingBinding) {
    check(ticket, accountId);
    if (!binding.enabled || binding.accountId !== accountId) return;
    if (readInput().testLabActive) throw new Error("SHARE_TEST_LAB_ACTIVE");
    const pending = await options.local.stagePublication(
      binding,
      readInput().timeZone,
      options.makeId,
    );
    check(ticket, accountId);
    if (!pending) return;
    await sendPublication(ticket, accountId, binding, pending);
  }
  async function sendPublication(
    ticket: number,
    accountId: string,
    binding: LocalSharingBinding,
    pending: SharingPublication,
  ) {
    check(ticket, accountId);
    try {
      const result = await cloud().publish(binding, pending);
      check(ticket, accountId);
      await options.local.acknowledgePublication(pending, result.revision);
      check(ticket, accountId);
      const snapshot = await cloud().fetch(binding.calendarId, null);
      check(ticket, accountId);
      await options.local.cacheSnapshot(accountId, snapshot);
      check(ticket, accountId);
    } catch (error) {
      if (
        errorCode(error) === "SHARE_REVISION_CONFLICT" ||
        errorCode(error) === "SHARE_DEVICE_MISMATCH"
      )
        await pauseConflict(ticket, accountId, binding);
      else if (errorCode(error) === "SHARE_NOT_FOUND")
        await remove(ticket, accountId, binding.calendarId);
      throw error;
    }
  }
  async function ensureSourceContent(
    ticket: number,
    accountId: string,
    calendarId: string,
    rights?: SharingContentRights,
  ) {
    if (!contentRightsAvailable || !options.local.configureContent || readInput().testLabActive)
      return;
    const binding = (await options.local.listBindings(accountId)).find(
      (item) => item.calendarId === calendarId,
    );
    check(ticket, accountId);
    const calendar = caches.find((item) => item.calendar.id === calendarId)?.calendar;
    if (!binding || !binding.enabled || (calendar && calendar.deviceId !== binding.deviceId)) {
      // Rights remain owner-manageable on another device. The publishing device
      // adopts explicit grants on its next sync; restored bindings stay paused.
      return;
    }
    const list = members.get(calendarId);
    const grants = [
      ...(list?.members
        .filter((item) => ["PENDING", "ACTIVE"].includes(item.status))
        .map((item) => item.rights) ?? []),
      ...(list?.invites
        .filter(
          (item) =>
            !item.consumedAt && !item.revokedAt && Date.parse(item.expiresAt) > options.now(),
        )
        .map((item) => item.rights) ?? []),
      rights,
    ].filter((item): item is SharingContentRights => !!item);
    const content = {
      ...(binding.requiresContentConsent ? { consentReset: true as const } : {}),
      version: 2 as const,
      shifts: binding.content?.shifts ?? true,
      allAppointments: binding.content?.allAppointments ?? false,
      notes: binding.requiresContentConsent
        ? (!!binding.content?.notes && grants.some((item) => item.notes)) || !!rights?.notes
        : grants.some((item) => item.notes),
    };
    content.shifts ||= binding.requiresContentConsent
      ? !!rights?.shifts
      : grants.some((item) => item.shifts);
    content.allAppointments ||= binding.requiresContentConsent
      ? !!rights?.appointments
      : grants.some((item) => item.appointments);
    if (sharingContentSignature(binding.content) === sharingContentSignature(content)) return;
    await options.local.configureContent(accountId, calendarId, content);
    check(ticket, accountId);
    prepared.clear();
  }
  async function refreshNow(ticket: number, accountId: string): Promise<void> {
    check(ticket, accountId);
    await localState(ticket, accountId);
    const supported = (await cloud().supportsContentRights?.()) ?? false;
    check(ticket, accountId);
    contentRightsAvailable = supported && !!options.local.configureContent;
    const previous = caches;
    const remote = await cloud().listCalendars();
    check(ticket, accountId);
    const remoteIds = new Set(remote.map((calendar) => calendar.id));
    for (const cached of previous)
      if (!remoteIds.has(cached.calendar.id)) await remove(ticket, accountId, cached.calendar.id);
    for (const binding of bindings)
      if (!remoteIds.has(binding.calendarId)) await remove(ticket, accountId, binding.calendarId);
    let networkFailure = false;
    for (const calendar of remote) {
      check(ticket, accountId);
      const cached = caches.find((item) => item.calendar.id === calendar.id);
      try {
        const snapshot = await cloud().fetch(
          calendar.id,
          contentRightsAvailable && cached?.calendar.contentVersion !== 2
            ? null
            : (cached?.calendar.revision ?? null),
        );
        check(ticket, accountId);
        await options.local.cacheSnapshot(accountId, snapshot);
        check(ticket, accountId);
        if (calendar.isOwner) {
          const list = await cloud().listMembers(calendar.id);
          check(ticket, accountId);
          members.set(calendar.id, list);
        }
      } catch (error) {
        if (error instanceof AccountChanged || sessionDenied(error)) throw error;
        if (errorCode(error) === "SHARE_NOT_FOUND") await remove(ticket, accountId, calendar.id);
        else networkFailure = true;
      }
    }
    for (const calendar of remote)
      if (calendar.isOwner) await ensureSourceContent(ticket, accountId, calendar.id);
    await localState(ticket, accountId);
    for (const binding of bindings) {
      const remoteCalendar = remote.find((item) => item.id === binding.calendarId);
      if (
        !remoteCalendar?.isOwner ||
        remoteCalendar.deviceId !== binding.deviceId ||
        !binding.enabled
      )
        continue;
      try {
        await publishBinding(ticket, accountId, binding);
      } catch (error) {
        if (error instanceof AccountChanged || sessionDenied(error)) throw error;
        failed = true;
        networkFailure ||= errorCode(error) === "SHARE_NETWORK_FAILED";
      }
    }
    check(ticket, accountId);
    offline = networkFailure;
    await localState(ticket, accountId);
  }
  async function invalidateSession(ticket: number) {
    if (!valid(ticket)) return;
    const cleanupTicket = ++epoch;
    prepared.clear();
    busyTicket = cleanupTicket;
    user = null;
    status = "signedOut";
    caches = [];
    issuedInvitations = [];
    bindings = [];
    source = [];
    members = new Map();
    claimResult = null;
    failed = true;
    emit();
    // Authoritative session denial also clears durable credentials immediately.
    const authClearing = options.auth.signOut();
    const localClearing = options.local.setActiveAccount(null);
    try {
      await Promise.all([authClearing, localClearing]);
    } finally {
      if (busyTicket === cleanupTicket) busyTicket = null;
      emit();
    }
  }
  async function refreshSafely(ticket: number, accountId: string) {
    try {
      failed = false;
      await refreshNow(ticket, accountId);
    } catch (error) {
      if (sessionDenied(error)) {
        await invalidateSession(ticket);
        return;
      }
      if (valid(ticket, accountId)) {
        offline = true;
        failed = true;
        await localState(ticket, accountId);
      }
      if (error instanceof AccountChanged) return;
    }
    if (valid(ticket, accountId)) emit();
  }
  function switchUser(next: SharingAuthUser | null): Promise<void> {
    if (stopped) return Promise.resolve();
    if (status !== "loading" && next?.id === user?.id) {
      user = next;
      emit();
      return activation;
    }
    const ticket = ++epoch;
    prepared.clear();
    busyTicket = null;
    user = next;
    status = next ? "signedIn" : "signedOut";
    caches = [];
    issuedInvitations = [];
    bindings = [];
    source = [];
    members = new Map();
    claimResult = null;
    failed = false;
    offline = false;
    emit();
    activation = queue(async () => {
      if (!valid(ticket)) return;
      await options.local.setActiveAccount(next?.id ?? null);
      check(ticket);
      if (next) await refreshSafely(ticket, next.id);
    }).catch((error) => {
      if (valid(ticket) && !(error instanceof AccountChanged)) {
        failed = true;
        emit();
      }
    });
    return activation;
  }
  async function run<T>(operation: (ticket: number, accountId: string) => Promise<T>): Promise<T> {
    const { ticket, accountId } = actor();
    if (busyTicket === epoch) throw new Error("SHARE_BUSY");
    busyTicket = epoch;
    failed = false;
    emit();
    try {
      await activation;
      return await queue(async () => {
        check(ticket, accountId);
        return operation(ticket, accountId);
      });
    } catch (error) {
      if (sessionDenied(error)) await invalidateSession(ticket);
      if (valid(ticket, accountId)) {
        failed = true;
        if (errorCode(error) === "SHARE_NETWORK_FAILED") offline = true;
      }
      throw error;
    } finally {
      if (busyTicket === ticket) busyTicket = null;
      if (valid(ticket, accountId)) emit();
    }
  }
  function requireCalendar(calendarId: string, ownerOnly = false) {
    const entry = caches.find((item) => item.calendar.id === calendarId);
    if (!entry || (ownerOnly && !entry.calendar.isOwner)) throw new Error("SHARE_NOT_FOUND");
    return entry.calendar;
  }
  const actions = {
    async signIn(provider: "apple" | "google") {
      const ticket = epoch;
      if (busyTicket === epoch) throw new Error("SHARE_BUSY");
      cloud();
      busyTicket = epoch;
      failed = false;
      emit();
      try {
        const result = await (provider === "apple"
          ? options.auth.signInApple()
          : options.auth.signInGoogle());
        if (result) await switchUser(result);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        if (busyTicket === ticket) busyTicket = null;
        emit();
      }
    },
    async refresh() {
      await run(async (ticket, accountId) => {
        await refreshNow(ticket, accountId);
      });
    },
    async createCalendar(draft: Parameters<SharingController["createCalendar"]>[0]) {
      return run(async (ticket, accountId) => {
        if (draft.confirmed !== true || readInput().testLabActive)
          throw new Error("SHARE_NOT_CONFIRMED");
        if (draft.rights && !contentRightsAvailable) throw new Error("SHARE_INVALID_ARGUMENT");
        const entries = await options.local.readEntries();
        check(ticket, accountId);
        const selected = draft.selectedAppointmentIds ?? [];
        if (
          new Set(selected).size !== selected.length ||
          selected.some(
            (id) =>
              !entries.some(
                (entry) =>
                  entry.id === id && entry.kind === "APPOINTMENT" && entry.deletedAt === null,
              ),
          )
        )
          throw new Error("SHARE_INVALID_ARGUMENT");
        const id = options.makeId(),
          deviceId = options.makeId(),
          deviceSecret = options.makeSecret();
        await cloud().saveProfile(accountId, user!.displayName);
        check(ticket, accountId);
        const calendar = await cloud().createCalendar({
          expectedAccountId: accountId,
          id,
          deviceId,
          deviceSecret,
          name: draft.name,
          color: draft.color,
          visibility: draft.visibility,
        });
        check(ticket, accountId);
        await options.local.bindCalendar(accountId, calendar, deviceSecret, selected);
        check(ticket, accountId);
        if (draft.rights) {
          if (!contentRightsAvailable || !options.local.configureContent)
            throw new Error("SHARE_INVALID_ARGUMENT");
          await options.local.configureContent(accountId, calendar.id, {
            version: 2,
            shifts: draft.rights.shifts,
            allAppointments: draft.rights.appointments,
            notes: draft.rights.notes,
          });
          check(ticket, accountId);
        }
        const binding = (await options.local.listBindings(accountId)).find(
          (item) => item.calendarId === calendar.id,
        );
        check(ticket, accountId);
        if (!binding) throw new Error("SHARE_INVALID_BINDING");
        await publishBinding(ticket, accountId, binding);
        await localState(ticket, accountId);
        return calendar.id;
      });
    },
    async preparePublicationPreview(calendarId: string) {
      return run(async (ticket, accountId) => {
        const calendar = requireCalendar(calendarId, true);
        if (readInput().testLabActive) throw new Error("SHARE_TEST_LAB_ACTIVE");
        const binding = (await options.local.listBindings(accountId)).find(
          (item) => item.calendarId === calendarId,
        );
        check(ticket, accountId);
        if (!binding || calendar.deviceId !== binding.deviceId)
          throw new Error("SHARE_DEVICE_MISMATCH");
        const entries = await options.local.readEntries();
        check(ticket, accountId);
        const current = (await options.local.listBindings(accountId)).find(
          (item) => item.calendarId === calendarId,
        );
        check(ticket, accountId);
        if (!current || !samePublicationConsent(binding, current))
          throw new Error("SHARE_PREVIEW_STALE");
        const timeZone = readInput().timeZone;
        const projection = projectSharingEntries(entries, {
          timeZone,
          visibility: binding.visibility,
          content: binding.content,
          selectedAppointmentIds: binding.selectedAppointmentIds,
          publicId: () => "11111111-1111-4111-8111-111111111111",
        });
        const confirmationId = options.makeId();
        prepared.clear();
        prepared.set(confirmationId, {
          ticket,
          accountId,
          calendarId,
          binding,
          timeZone,
          confirmation: {
            content: binding.content,
            generation: binding.generation,
            visibility: binding.visibility,
            selectedAppointmentIds: [...binding.selectedAppointmentIds],
            projection: sharingProjectionSignature(projection),
          },
        });
        return { ...safePreview(projection), confirmationId };
      });
    },
    async publishCalendar(calendarId: string, confirmationId: string) {
      await run(async (ticket, accountId) => {
        requireCalendar(calendarId, true);
        const approval = prepared.get(confirmationId);
        prepared.delete(confirmationId);
        if (
          !approval ||
          approval.ticket !== ticket ||
          approval.accountId !== accountId ||
          approval.calendarId !== calendarId ||
          approval.timeZone !== readInput().timeZone
        )
          throw new Error("SHARE_PREVIEW_STALE");
        if (readInput().testLabActive) throw new Error("SHARE_TEST_LAB_ACTIVE");
        const binding = (await options.local.listBindings(accountId)).find(
          (item) => item.calendarId === calendarId,
        );
        check(ticket, accountId);
        if (!binding || !samePublicationConsent(approval.binding, binding))
          throw new Error("SHARE_PREVIEW_STALE");
        const snapshot = await cloud().fetch(calendarId, null);
        check(ticket, accountId);
        if (snapshot.calendar.deviceId !== binding.deviceId)
          throw new Error("SHARE_DEVICE_MISMATCH");
        if (approval.timeZone !== readInput().timeZone) throw new Error("SHARE_PREVIEW_STALE");
        const pending = await options.local.stageConfirmedPublication(
          binding,
          approval.timeZone,
          options.makeId,
          {
            ...approval.confirmation,
            serverRevision: snapshot.revision,
          },
        );
        check(ticket, accountId);
        await sendPublication(
          ticket,
          accountId,
          {
            ...binding,
            enabled: true,
            generation: pending.generation,
            serverRevision: pending.expectedRevision,
          },
          pending,
        );
        await localState(ticket, accountId);
      });
    },
    async setVisible(calendarId: string, visible: boolean) {
      await run(async (ticket, accountId) => {
        requireCalendar(calendarId);
        await options.local.setVisible(accountId, calendarId, visible);
        await localState(ticket, accountId);
      });
    },
    async invite(calendarId: string) {
      const invitation = await actions.createInvitation(calendarId);
      await actions.shareInvitation(invitation);
    },
    async createInvitation(calendarId: string, rights?: SharingContentRights) {
      return run(async (ticket, accountId) => {
        requireCalendar(calendarId, true);
        if (rights && !contentRightsAvailable) throw new Error("SHARE_INVALID_ARGUMENT");
        await ensureSourceContent(ticket, accountId, calendarId, rights);
        const binding = (await options.local.listBindings(accountId)).find(
          (item) => item.calendarId === calendarId,
        );
        check(ticket, accountId);
        if (rights && binding) await publishBinding(ticket, accountId, binding);
        let invite = await cloud().createInvite(calendarId, options.makeId(), rights);
        check(ticket, accountId);
        if (!invite.token) {
          await cloud().revokeInvite(calendarId, invite.inviteId);
          check(ticket, accountId);
          invite = await cloud().createInvite(calendarId, options.makeId(), rights);
          check(ticket, accountId);
        }
        if (!invite.token) throw new Error("SHARE_INVITE_INVALID");
        const result = {
          calendarId,
          id: invite.inviteId,
          url: options.inviteUrl(invite.token),
          expiresAt: invite.expiresAt,
        };
        await options.local.rememberInvitation?.(accountId, result);
        check(ticket, accountId);
        await refreshNow(ticket, accountId);
        return result;
      });
    },
    async shareInvitation(
      invitation: Parameters<SharingController["shareInvitation"]>[0],
      channel?: SharingDeliveryChannel,
    ) {
      await run(async (ticket, accountId) => {
        requireCalendar(invitation.calendarId, true);
        const current = await cloud().listMembers(invitation.calendarId);
        check(ticket, accountId);
        const invite = current.invites.find((item) => item.id === invitation.id);
        if (
          !invite ||
          invite.consumedAt ||
          invite.revokedAt ||
          Date.parse(invite.expiresAt) <= options.now()
        )
          throw new Error("SHARE_INVITE_INVALID");
        if (channel === "copy" && options.copyUrl) await options.copyUrl(invitation.url);
        else if (channel) await options.shareUrl(invitation.url, channel);
        else await options.shareUrl(invitation.url);
        check(ticket, accountId);
      });
    },
    async setMemberRights(calendarId: string, userId: string, rights: SharingContentRights) {
      await run(async (ticket, accountId) => {
        requireCalendar(calendarId, true);
        if (!contentRightsAvailable || !cloud().setMemberRights)
          throw new Error("SHARE_INVALID_ARGUMENT");
        await ensureSourceContent(ticket, accountId, calendarId, rights);
        await cloud().setMemberRights!(calendarId, userId, rights);
        check(ticket, accountId);
        await refreshNow(ticket, accountId);
      });
    },
    async setMember(
      calendarId: string,
      userId: string,
      action: Parameters<SharingController["setMember"]>[2],
    ) {
      await run(async (ticket, accountId) => {
        requireCalendar(calendarId, true);
        await cloud().setMember(calendarId, userId, action);
        check(ticket, accountId);
        await refreshNow(ticket, accountId);
      });
    },
    async revokeInvite(calendarId: string, inviteId: string) {
      await run(async (ticket, accountId) => {
        requireCalendar(calendarId, true);
        await cloud().revokeInvite(calendarId, inviteId);
        check(ticket, accountId);
        await refreshNow(ticket, accountId);
      });
    },
    async deleteCalendar(calendarId: string) {
      await run(async (ticket, accountId) => {
        requireCalendar(calendarId, true);
        await cloud().deleteCalendar(calendarId);
        check(ticket, accountId);
        await remove(ticket, accountId, calendarId);
        await localState(ticket, accountId);
      });
    },
    async leaveCalendar(calendarId: string) {
      await run(async (ticket, accountId) => {
        if (requireCalendar(calendarId).isOwner) throw new Error("SHARE_OWNER_CANNOT_LEAVE");
        await cloud().leaveCalendar(accountId, calendarId);
        check(ticket, accountId);
        await remove(ticket, accountId, calendarId);
        await localState(ticket, accountId);
      });
    },
    async claimInvite(token: string, displayName: string) {
      await run(async (ticket, accountId) => {
        claimResult = null;
        emit();
        const result = await cloud().claimInvite(accountId, token, displayName);
        check(ticket, accountId);
        claimResult = {
          calendarName: result.calendarName,
          status: result.status as "PENDING" | "ACTIVE",
        };
        await refreshNow(ticket, accountId);
      });
    },
    async signOut() {
      const cleanupTicket = ++epoch;
      prepared.clear();
      busyTicket = cleanupTicket;
      user = null;
      status = "signedOut";
      caches = [];
      issuedInvitations = [];
      bindings = [];
      members = new Map();
      source = [];
      claimResult = null;
      emit();
      // Keychain and local revocation must start before a slow or hung network queue.
      const authClearing = options.auth.signOut();
      const localClearing = options.local.setActiveAccount(null);
      try {
        await Promise.all([authClearing, localClearing]);
        if (valid(cleanupTicket)) failed = false;
      } catch (error) {
        if (valid(cleanupTicket)) failed = true;
        throw error;
      } finally {
        if (busyTicket === cleanupTicket) busyTicket = null;
        emit();
      }
    },
    async deleteAccount() {
      await run(async (ticket, accountId) => {
        let code: string | null = null;
        const appleUser = await options.isAppleUser();
        check(ticket, accountId);
        if (appleUser) {
          check(ticket, accountId);
          const authorization = await options.prepareAppleDeletion();
          check(ticket, accountId);
          if (authorization.status === "cancelled") return;
          if (authorization.status === "manualRevocationRequired") {
            if (!(await options.confirmManualAppleDeletion())) return;
            check(ticket, accountId);
          } else code = authorization.authorizationCode;
        }
        const result = await cloud().deleteAccount(accountId, code);
        code = null;
        check(ticket, accountId);
        await options.local.forgetAccount(accountId);
        check(ticket, accountId);
        await options.forgetAuthProfile(accountId);
        check(ticket, accountId);
        const cleanupTicket = ++epoch;
        prepared.clear();
        busyTicket = cleanupTicket;
        user = null;
        status = "signedOut";
        caches = [];
        issuedInvitations = [];
        bindings = [];
        source = [];
        members = new Map();
        claimResult = null;
        emit();
        if (!valid(cleanupTicket)) return;
        try {
          await options.auth.signOut();
        } catch {
          /* The confirmed server deletion remains authoritative. */
        }
        if (busyTicket === cleanupTicket) busyTicket = null;
        options.notifyDeletion(result.revocationStatus);
        emit();
      });
    },
  };
  function visibleCalendars(): readonly CachedSharedCalendar[] {
    if (!user || status !== "signedIn") return [];
    return caches.filter(
      (item) =>
        !item.calendar.isOwner &&
        item.accountId === user!.id &&
        item.visible &&
        cacheUsable(item, options.now()),
    );
  }
  function getController(): SharingController {
    const calendarViews: SharingCalendarView[] = caches.map((item) => {
      const binding = bindings.find((value) => value.calendarId === item.calendar.id);
      const otherDevice =
        item.calendar.isOwner && (!binding || binding.deviceId !== item.calendar.deviceId);
      const syncState = !cacheUsable(item, options.now())
        ? "expired"
        : otherDevice
          ? "otherDevice"
          : offline
            ? "offline"
            : binding && (!binding.enabled || binding.generation > binding.acknowledgedGeneration)
              ? "pending"
              : "current";
      return {
        id: item.calendar.id,
        name: item.calendar.name,
        color: item.calendar.color,
        visibility: item.calendar.visibility,
        isOwner: item.calendar.isOwner,
        visible: item.visible,
        selectedAppointmentIds: item.calendar.isOwner
          ? (binding?.selectedAppointmentIds ?? [])
          : undefined,
        publicationPaused: !!binding && !binding.enabled && !otherDevice,
        publishedAt: item.calendar.publishedAt,
        syncState,
        members: members.get(item.calendar.id)?.members ?? [],
        invites: members.get(item.calendar.id)?.invites ?? [],
      };
    });
    return {
      status,
      account: user ? { displayName: user.displayName } : null,
      busy: busyTicket === epoch,
      error: failed,
      calendars: calendarViews,
      claimResult,
      appleAvailable,
      accountDeletionAvailable: !!options.cloud,
      directCopyAvailable: !!options.copyUrl,
      contentRightsAvailable: status === "signedIn" && contentRightsAvailable,
      issuedInvitations: status === "signedIn" ? issuedInvitations : [],
      availableAppointments: source
        .filter((entry) => entry.kind === "APPOINTMENT" && entry.deletedAt === null)
        .map((entry) => ({ id: entry.id, title: entry.title, date: entry.date })),
      preview(visibility: CalendarSharingVisibility, selectedAppointmentIds = []) {
        const entries = projectSharingEntries(source, {
          timeZone: readInput().timeZone,
          visibility,
          selectedAppointmentIds,
          publicId: () => "11111111-1111-4111-8111-111111111111",
        });
        return safePreview(entries);
      },
      ...actions,
    };
  }
  return {
    getController,
    updateInput(value: ReturnType<CalendarSharingRuntimeOptions["getInput"]>) {
      inputOverride = value;
    },
    setAppleAvailable(value: boolean) {
      appleAvailable = value;
      emit();
    },
    visibleCalendars,
    getSnapshot(): CalendarSharingRuntimeSnapshot {
      return (cachedSnapshot ??= {
        controller: getController(),
        visibleCalendars: visibleCalendars(),
      });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      if (!options.auth.isConfigured || !options.cloud) {
        status = "unavailable";
        emit();
        return;
      }
      try {
        await options.local.initialize();
      } catch {
        status = "unavailable";
        failed = true;
        emit();
        return;
      }
      if (stopped) return;
      unsubscribe = options.auth.subscribe((next) => {
        ++authRevision;
        void switchUser(next);
      });
      const revision = authRevision;
      try {
        const session = await options.auth.getSession();
        if (revision === authRevision && !stopped) await switchUser(session);
      } catch {
        if (!stopped) {
          status = "signedOut";
          failed = true;
          emit();
        }
      }
    },
    async backgroundRefresh() {
      if (cachedSnapshot?.visibleCalendars.some((cache) => !cacheUsable(cache, options.now())))
        emit();
      await activation;
      if (!user || stopped || !options.cloud) return;
      if (refreshing) {
        refreshAgain = true;
        return refreshing;
      }
      const { ticket, accountId } = actor();
      refreshing = queue(async () => {
        do {
          refreshAgain = false;
          await refreshSafely(ticket, accountId);
        } while (refreshAgain && valid(ticket, accountId));
      }).finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    stop() {
      stopped = true;
      ++epoch;
      prepared.clear();
      unsubscribe();
      listeners.clear();
    },
  };
}
export type CalendarSharingRuntime = ReturnType<typeof createCalendarSharingRuntime>;

export type { SharingLocalPort } from "@/domain/calendar-sharing-ports";
