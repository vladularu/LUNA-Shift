import type { CalendarEntry, ShiftEntry } from "@/domain/types";
import { describe, expect, it, vi } from "vitest";
import { createCalendarSharingRuntime } from "./calendar-sharing-runtime";
import type { CalendarSharingRuntimeOptions, SharingLocalPort } from "./calendar-sharing-runtime";
import type {
  CachedSharedCalendar,
  CloudSharedCalendar,
  LocalSharingBinding,
  SharingPublication,
} from "@/domain/calendar-sharing";
import type { CloudSharingClient } from "@/infrastructure/sharing/cloud-sharing-client";
import { SharingCloudError } from "@/infrastructure/sharing/cloud-sharing-client";
import type { SharingAuthPort, SharingAuthUser } from "@/infrastructure/auth/sharing-auth-core";

const account = { id: "account", displayName: "Alex" };
const calendar: CloudSharedCalendar = {
  id: "calendar",
  ownerId: "other",
  name: "Sams Plan",
  color: "#527D92",
  visibility: "DETAILS",
  revision: 1,
  isOwner: false,
  publishedAt: "2026-10-12T12:00:00Z",
};
const owner: CloudSharedCalendar = {
  ...calendar,
  ownerId: account.id,
  isOwner: true,
  deviceId: "device",
};
const binding: LocalSharingBinding = {
  accountId: account.id,
  calendarId: calendar.id,
  deviceId: "device",
  deviceSecret: "a".repeat(64),
  name: owner.name,
  color: owner.color,
  visibility: "DETAILS",
  selectedAppointmentIds: [],
  generation: 2,
  acknowledgedGeneration: 1,
  serverRevision: 1,
  enabled: true,
};
const publication: SharingPublication = {
  accountId: account.id,
  calendarId: calendar.id,
  mutationId: "mutation",
  generation: 2,
  expectedRevision: 1,
  entries: [],
};
function fixture({
  user = account,
  remote = [calendar],
  bindings = [],
  initialCaches = [],
}: {
  user?: SharingAuthUser | null;
  remote?: readonly CloudSharedCalendar[];
  bindings?: readonly LocalSharingBinding[];
  initialCaches?: readonly CachedSharedCalendar[];
} = {}) {
  let now = Date.parse("2026-10-12T12:00:00Z");
  let actorListener: (user: SharingAuthUser | null) => void = () => {};
  let caches = [...initialCaches];
  let localBindings = [...bindings];
  let staged: SharingPublication | null = null;
  const local: SharingLocalPort = {
    configureContent: vi.fn(async (id, target, content) => {
      localBindings = localBindings.map((item) =>
        item.accountId === id && item.calendarId === target
          ? { ...item, content, generation: item.generation + 1 }
          : item,
      );
      staged = null;
    }),
    initialize: vi.fn(async () => {}),
    setActiveAccount: vi.fn(async (id) => {
      if (!id) caches = [];
    }),
    listBindings: vi.fn(async (id) => localBindings.filter((item) => item.accountId === id)),
    stagePublication: vi.fn(async (item) => {
      if (item.generation <= item.acknowledgedGeneration) return null;
      if (!staged)
        staged = {
          ...publication,
          accountId: item.accountId,
          calendarId: item.calendarId,
          expectedRevision: item.serverRevision,
          generation: item.generation,
        };
      return staged;
    }),
    stageConfirmedPublication: vi.fn(async (item, _timeZone, _makeId, confirmation) => {
      localBindings = localBindings.map((b) =>
        b.calendarId === item.calendarId
          ? { ...b, enabled: true, generation: b.generation + 1 }
          : b,
      );
      return {
        ...publication,
        accountId: item.accountId,
        calendarId: item.calendarId,
        generation: item.generation + 1,
        expectedRevision: confirmation.serverRevision,
      };
    }),
    acknowledgePublication: vi.fn(async (pending, revision) => {
      staged = null;
      localBindings = localBindings.map((item) => ({
        ...item,
        acknowledgedGeneration: pending.generation,
        serverRevision: revision,
      }));
    }),
    resumePublication: vi.fn(async (_id, target) => {
      localBindings = localBindings.map((item) =>
        item.calendarId === target
          ? { ...item, enabled: true, generation: item.generation + 1 }
          : item,
      );
    }),
    clearConflict: vi.fn(async (_id, target, revision) => {
      staged = null;
      localBindings = localBindings.map((item) =>
        item.calendarId === target ? { ...item, enabled: false, serverRevision: revision } : item,
      );
    }),
    listCaches: vi.fn(async (id) => caches.filter((item) => item.accountId === id)),
    cacheSnapshot: vi.fn(async (id, snapshot) => {
      const previous = caches.find((item) => item.calendar.id === snapshot.calendar.id);
      caches = caches.filter((item) => item.calendar.id !== snapshot.calendar.id);
      caches.push({
        accountId: id,
        calendar: snapshot.calendar,
        fetchedAt: snapshot.fetchedAt,
        visible: previous?.visible ?? true,
        localColor: previous?.localColor,
        entries: snapshot.unchanged ? (previous?.entries ?? []) : snapshot.entries,
      });
    }),
    removeCalendar: vi.fn(async (_id, target) => {
      caches = caches.filter((item) => item.calendar.id !== target);
      localBindings = localBindings.filter((item) => item.calendarId !== target);
    }),
    setColor: vi.fn(async (id, target, value) => {
      caches = caches.map((item) =>
        item.accountId === id && item.calendar.id === target
          ? { ...item, localColor: value }
          : item,
      );
    }),
    setVisible: vi.fn(async (_id, target, value) => {
      caches = caches.map((item) =>
        item.calendar.id === target ? { ...item, visible: value } : item,
      );
    }),
    forgetAccount: vi.fn(async () => {
      caches = [];
      localBindings = [];
    }),
    readEntries: vi.fn(async () => []),
    bindCalendar: vi.fn(async (id, created, secret, selected) => {
      localBindings.push({
        ...binding,
        accountId: id,
        calendarId: created.id,
        deviceId: created.deviceId!,
        deviceSecret: secret,
        selectedAppointmentIds: selected,
      });
    }),
  };
  const cloud: CloudSharingClient = {
    supportsContentRights: vi.fn(async () => false),
    setMemberRights: vi.fn(),
    saveProfile: vi.fn(async (_expectedAccountId, displayName) => ({
      userId: account.id,
      displayName,
    })),
    listCalendars: vi.fn(async () => remote),
    fetch: vi.fn(async (id) => {
      const item = remote.find((item) => item.id === id)!;
      return {
        calendar: item,
        revision: item.revision,
        unchanged: false,
        reset: true,
        entries: [],
        fetchedAt: new Date(now).toISOString(),
      };
    }),
    publish: vi.fn(async (_binding, pending) => ({
      calendarId: pending.calendarId,
      revision: pending.expectedRevision + 1,
      publishedAt: new Date(now).toISOString(),
    })),
    createCalendar: vi.fn(async (draft) => {
      const created = {
        ...owner,
        id: draft.id,
        deviceId: draft.deviceId,
        name: draft.name,
        color: draft.color,
        visibility: draft.visibility,
      };
      remote = [...remote, created];
      return created;
    }),
    createInvite: vi.fn(async () => ({
      inviteId: "invite",
      calendarId: calendar.id,
      token: "b".repeat(64),
      expiresAt: "2026-10-19T12:00:00Z",
    })),
    claimInvite: vi.fn(async () => ({
      calendarId: calendar.id,
      calendarName: calendar.name,
      status: "PENDING" as const,
    })),
    listMembers: vi.fn(async () => ({
      members: [],
      invites: [
        { id: "invite", expiresAt: "2026-10-19T12:00:00Z", consumedAt: null, revokedAt: null },
      ],
    })),
    setMember: vi.fn(async () => ({
      userId: "member",
      displayName: "Sam",
      status: "ACTIVE" as const,
      requestedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    })),
    revokeInvite: vi.fn(async () => ({ revoked: true as const })),
    leaveCalendar: vi.fn(async () => ({ left: true as const })),
    deleteCalendar: vi.fn(async () => ({ deleted: true as const })),
    deleteAccount: vi.fn(async () => ({
      deleted: true as const,
      revocationStatus: "not_applicable" as const,
    })),
  };
  const auth: SharingAuthPort = {
    isConfigured: true,
    getSession: vi.fn(async () => user),
    subscribe: vi.fn((listener) => {
      actorListener = listener;
      return () => {};
    }),
    signInApple: vi.fn(async () => account),
    signInGoogle: vi.fn(async () => account),
    updateName: vi.fn(),
    signOut: vi.fn(async () => {
      actorListener(null);
    }),
  };
  const options: CalendarSharingRuntimeOptions = {
    auth,
    cloud,
    local,
    getInput: () => ({ timeZone: "Europe/Berlin", testLabActive: false }),
    now: () => now,
    makeId: () => "11111111-1111-4111-8111-111111111111",
    makeSecret: () => "c".repeat(64),
    appleAvailable: true,
    shareUrl: vi.fn(async () => {}),
    inviteUrl: (token) => `lunashift-internal://sharing-invite?token=${token}`,
    isAppleUser: vi.fn(async () => false),
    prepareAppleDeletion: vi.fn(async () => ({ status: "cancelled" as const })),
    confirmManualAppleDeletion: vi.fn(async () => false),
    notifyDeletion: vi.fn(),
    forgetAuthProfile: vi.fn(async () => {}),
  };
  return {
    options,
    auth,
    cloud,
    local,
    setNow: (value: number) => {
      now = value;
    },
    changeAccount: (next: SharingAuthUser | null) => actorListener(next),
    caches: () => caches,
  };
}

describe("sharing runtime", () => {
  it("does not inherit former note or appointment consent after manually resuming a restored source", async () => {
    const f = fixture({
      remote: [owner],
      bindings: [{ ...binding, requiresContentConsent: true }],
    });
    f.cloud.supportsContentRights = vi.fn(async () => true);
    f.cloud.listMembers = vi.fn(async () => ({
      members: [
        {
          userId: "member",
          displayName: "Sam",
          status: "ACTIVE" as const,
          requestedAt: "2026-10-12T12:00:00Z",
          updatedAt: "2026-10-12T12:00:00Z",
          rights: { shifts: true, appointments: true, notes: true },
        },
      ],
      invites: [],
    }));
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.local.configureContent).toHaveBeenCalledWith(account.id, calendar.id, {
      version: 2,
      consentReset: true,
      shifts: true,
      allAppointments: false,
      notes: false,
    });
  });
  it("immediately removes persisted invitation secrets from the controller on account switch", async () => {
    const f = fixture();
    const invitation = {
      id: "invite",
      calendarId: calendar.id,
      url: "https://luna.example/sharing-invite?token=" + "b".repeat(64),
      expiresAt: "2099-10-14T00:00:00Z",
    };
    f.local.listInvitations = vi.fn(async (id) => (id === account.id ? [invitation] : []));
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.getController().issuedInvitations).toEqual([invitation]);
    f.changeAccount({ id: "second-account", displayName: "Sam" });
    expect(runtime.getController().issuedInvitations).toEqual([]);
    await runtime.backgroundRefresh();
    expect(runtime.getController().issuedInvitations).toEqual([]);
  });
  it("allows reducing a person's rights from another owner device without publishing local data", async () => {
    const f = fixture({ remote: [owner] });
    f.cloud.supportsContentRights = vi.fn(async () => true);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const rights = { shifts: true, appointments: false, notes: false };
    await runtime.getController().setMemberRights!(calendar.id, "member", rights);
    expect(f.cloud.setMemberRights).toHaveBeenCalledWith(calendar.id, "member", rights);
    expect(f.cloud.publish).not.toHaveBeenCalled();
    expect(f.local.configureContent).not.toHaveBeenCalled();
  });
  it("upgrades an enabled source to typed content without opting into notes or all appointments", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    f.cloud.supportsContentRights = vi.fn(async () => true);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.getController().contentRightsAvailable).toBe(true);
    expect(f.local.configureContent).toHaveBeenCalledWith(account.id, calendar.id, {
      version: 2,
      shifts: true,
      allAppointments: false,
      notes: false,
    });
    expect(f.cloud.publish).toHaveBeenCalled();
  });
  it("passes explicit invitation rights to the server and enables only selected source contents", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    f.cloud.supportsContentRights = vi.fn(async () => true);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const rights = { shifts: false, appointments: true, notes: true };
    await runtime.getController().createInvitation(calendar.id, rights);
    expect(f.cloud.createInvite).toHaveBeenCalledWith(calendar.id, expect.any(String), rights);
    expect(f.local.configureContent).toHaveBeenCalledWith(account.id, calendar.id, {
      version: 2,
      shifts: true,
      allAppointments: true,
      notes: true,
    });
  });
  it("requests a complete v2 snapshot when upgrading an existing v1 reader cache", async () => {
    const f = fixture({
      initialCaches: [
        {
          accountId: account.id,
          calendar,
          entries: [],
          fetchedAt: "2026-10-12T12:00:00Z",
          visible: true,
        },
      ],
    });
    f.cloud.supportsContentRights = vi.fn(async () => true);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.cloud.fetch).toHaveBeenCalledWith(calendar.id, null);
  });
  it("does not resume a restored source just because the server supports content rights", async () => {
    const f = fixture({ remote: [owner], bindings: [{ ...binding, enabled: false }] });
    f.cloud.supportsContentRights = vi.fn(async () => true);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.local.configureContent).not.toHaveBeenCalled();
    expect(f.cloud.publish).not.toHaveBeenCalled();
  });
  it("stays unavailable without cloud setup and never reads or uploads local data", async () => {
    const f = fixture();
    f.auth.isConfigured = false;
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.getController().status).toBe("unavailable");
    expect(f.local.initialize).not.toHaveBeenCalled();
    expect(f.cloud.listCalendars).not.toHaveBeenCalled();
  });
  it("restores only the account's reader cache and keeps it isolated from publication", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.visibleCalendars()).toHaveLength(1);
    expect(f.local.stagePublication).not.toHaveBeenCalled();
    expect(runtime.getController().status).toBe("signedIn");
  });
  it("keeps an atomic publication for retry after network failure and acknowledges only after success", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    vi.mocked(f.cloud.publish).mockRejectedValueOnce(new SharingCloudError("SHARE_NETWORK_FAILED"));
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.local.acknowledgePublication).not.toHaveBeenCalled();
    await runtime.backgroundRefresh();
    expect(vi.mocked(f.cloud.publish).mock.calls[0][1].mutationId).toBe(
      vi.mocked(f.cloud.publish).mock.calls[1][1].mutationId,
    );
    expect(f.local.acknowledgePublication).toHaveBeenCalledTimes(1);
  });
  it("removes revoked calendars when the server membership list omits them", async () => {
    const cached: CachedSharedCalendar = {
      accountId: account.id,
      calendar,
      entries: [],
      visible: true,
      fetchedAt: "2026-10-12T12:00:00Z",
    };
    const f = fixture({ initialCaches: [cached] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    vi.mocked(f.cloud.listCalendars).mockResolvedValue([]);
    await runtime.backgroundRefresh();
    expect(f.local.removeCalendar).toHaveBeenCalledWith(account.id, calendar.id);
    expect(runtime.visibleCalendars()).toEqual([]);
  });
  it("removes a forbidden cache on SHARE_NOT_FOUND instead of treating it as an offline failure", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    vi.mocked(f.cloud.fetch).mockRejectedValue(new SharingCloudError("SHARE_NOT_FOUND"));
    await runtime.backgroundRefresh();
    expect(runtime.visibleCalendars()).toEqual([]);
    expect(f.local.removeCalendar).toHaveBeenCalledWith(account.id, calendar.id);
  });
  it("retains cached reader data during network failures for at most twenty-four hours", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    vi.mocked(f.cloud.listCalendars).mockRejectedValue(
      new SharingCloudError("SHARE_NETWORK_FAILED"),
    );
    f.setNow(Date.parse("2026-10-13T11:59:00Z"));
    await runtime.backgroundRefresh();
    expect(runtime.visibleCalendars()).toHaveLength(1);
    expect(runtime.getController().calendars[0].syncState).toBe("offline");
    f.setNow(Date.parse("2026-10-13T12:01:00Z"));
    await runtime.backgroundRefresh();
    expect(runtime.visibleCalendars()).toEqual([]);
    expect(runtime.getController().calendars[0].syncState).toBe("expired");
  });
  it("pauses conflicting publication and resumes only on explicit user publication", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    vi.mocked(f.cloud.publish).mockRejectedValueOnce(
      new SharingCloudError("SHARE_REVISION_CONFLICT"),
    );
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.local.clearConflict).toHaveBeenCalled();
    expect(f.local.resumePublication).not.toHaveBeenCalled();
    await runtime.backgroundRefresh();
    expect(f.cloud.publish).toHaveBeenCalledTimes(1);
    const preview = await runtime.getController().preparePublicationPreview(owner.id);
    await runtime.getController().publishCalendar(owner.id, preview.confirmationId);
    expect(f.local.stageConfirmedPublication).toHaveBeenCalled();
    expect(f.local.resumePublication).not.toHaveBeenCalled();
    expect(f.cloud.publish).toHaveBeenCalledTimes(2);
  });
  it("carries appointment consent into manual previews and removes it when a restore pauses the binding", async () => {
    const f = fixture({
      remote: [owner],
      bindings: [{ ...binding, enabled: false, selectedAppointmentIds: ["appointment"] }],
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.getController().calendars[0].selectedAppointmentIds).toEqual(["appointment"]);
    vi.mocked(f.local.listBindings).mockResolvedValue([
      { ...binding, enabled: false, selectedAppointmentIds: [] },
    ]);
    await runtime.backgroundRefresh();
    expect(runtime.getController().calendars[0].selectedAppointmentIds).toEqual([]);
    expect(f.cloud.publish).not.toHaveBeenCalled();
    expect(f.local.resumePublication).not.toHaveBeenCalled();
  });
  it("prepares from fresh local rows without uploading and binds the confirmation to their generation and consent", async () => {
    const f = fixture({
      remote: [owner],
      bindings: [{ ...binding, enabled: false, selectedAppointmentIds: ["appointment"] }],
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const reads = vi.mocked(f.local.readEntries).mock.calls.length;
    vi.mocked(f.local.readEntries).mockResolvedValue([
      {
        kind: "SHIFT",
        id: "private-shift",
        date: "2026-10-24",
        templateId: null,
        title: "Private title",
        type: "NIGHT",
        allDay: false,
        startTime: "21:00",
        endTime: "07:30",
        breakMinutes: 60,
        color: "#123456",
        symbol: "moon",
        note: "Private note",
        location: null,
        overtimeMinutes: 0,
        holidayPremiumMode: "WITH_TIME_OFF",
        revision: 1,
        createdAt: "2026-10-12T12:00:00Z",
        updatedAt: "2026-10-12T12:00:00Z",
        deletedAt: null,
      },
    ]);
    const preview = await runtime.getController().preparePublicationPreview(owner.id);
    expect(preview.entryCount).toBe(1);
    expect(preview.entries).toEqual([
      { title: "Private title", when: "24.10. · 21:00–07:30 · Folgetag" },
    ]);
    expect(JSON.stringify(preview)).not.toMatch(/Private note|private-shift/);
    expect(f.local.readEntries).toHaveBeenCalledTimes(reads + 1);
    expect(f.cloud.publish).not.toHaveBeenCalled();
    expect(f.local.resumePublication).not.toHaveBeenCalled();
    await runtime.getController().publishCalendar(owner.id, preview.confirmationId);
    expect(f.local.stageConfirmedPublication).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 2, enabled: false }),
      "Europe/Berlin",
      f.options.makeId,
      expect.objectContaining({
        generation: 2,
        visibility: "DETAILS",
        selectedAppointmentIds: ["appointment"],
        projection: expect.stringContaining("Private title"),
      }),
    );
    expect(f.cloud.publish).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed generation before any resume, stage or cloud publication", async () => {
    const f = fixture({ remote: [owner], bindings: [{ ...binding, enabled: false }] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const preview = await runtime.getController().preparePublicationPreview(owner.id);
    vi.mocked(f.local.listBindings).mockResolvedValue([
      { ...binding, enabled: false, generation: 3 },
    ]);
    await expect(
      runtime.getController().publishCalendar(owner.id, preview.confirmationId),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(f.local.stageConfirmedPublication).not.toHaveBeenCalled();
    expect(f.local.resumePublication).not.toHaveBeenCalled();
    expect(f.cloud.publish).not.toHaveBeenCalled();
  });
  it("rejects changed appointment consent even if the binding generation was unchanged", async () => {
    const f = fixture({
      remote: [owner],
      bindings: [{ ...binding, enabled: false, selectedAppointmentIds: ["old"] }],
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const preview = await runtime.getController().preparePublicationPreview(owner.id);
    vi.mocked(f.local.listBindings).mockResolvedValue([
      { ...binding, enabled: false, selectedAppointmentIds: ["new"] },
    ]);
    await expect(
      runtime.getController().publishCalendar(owner.id, preview.confirmationId),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(f.local.stageConfirmedPublication).not.toHaveBeenCalled();
    expect(f.cloud.publish).not.toHaveBeenCalled();
  });
  it("rejects a preview from a previous account session even after the same account signs in again", async () => {
    const f = fixture({ remote: [owner], bindings: [{ ...binding, enabled: false }] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const preview = await runtime.getController().preparePublicationPreview(owner.id);
    await runtime.getController().signOut();
    await runtime.getController().signIn("google");
    await expect(
      runtime.getController().publishCalendar(owner.id, preview.confirmationId),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(f.local.stageConfirmedPublication).not.toHaveBeenCalled();
    expect(f.cloud.publish).not.toHaveBeenCalled();
  });
  it("leaves publication paused when the atomic final stage finds a changed consent or snapshot", async () => {
    const f = fixture({ remote: [owner], bindings: [{ ...binding, enabled: false }] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const preview = await runtime.getController().preparePublicationPreview(owner.id);
    vi.mocked(f.local.stageConfirmedPublication).mockRejectedValue(
      new Error("SHARE_PREVIEW_STALE"),
    );
    await expect(
      runtime.getController().publishCalendar(owner.id, preview.confirmationId),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(f.local.resumePublication).not.toHaveBeenCalled();
    expect(f.cloud.publish).not.toHaveBeenCalled();
    expect((await f.local.listBindings(account.id))[0].enabled).toBe(false);
    await expect(
      runtime.getController().publishCalendar(owner.id, preview.confirmationId),
    ).rejects.toThrow("SHARE_PREVIEW_STALE");
    expect(f.local.stageConfirmedPublication).toHaveBeenCalledTimes(1);
  });
  it("never publishes a restored calendar bound to another device", async () => {
    const f = fixture({ remote: [{ ...owner, deviceId: "other-device" }], bindings: [binding] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.cloud.publish).not.toHaveBeenCalled();
    expect(runtime.getController().calendars[0].syncState).toBe("otherDevice");
  });
  it("blocks test-lab publication even when a binding exists", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    f.options.getInput = () => ({ timeZone: "Europe/Berlin", testLabActive: true });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.local.stagePublication).not.toHaveBeenCalled();
    expect(f.cloud.publish).not.toHaveBeenCalled();
  });
  it("does not acknowledge an in-flight publication or expose stale data after account change", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    let release!: () => void;
    vi.mocked(f.cloud.publish).mockImplementationOnce(async (_b, p) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { calendarId: p.calendarId, revision: 2, publishedAt: "2026-10-12T12:00:00Z" };
    });
    const runtime = createCalendarSharingRuntime(f.options);
    const starting = runtime.start();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    f.changeAccount(null);
    expect(runtime.visibleCalendars()).toEqual([]);
    release();
    await starting;
    await runtime.backgroundRefresh();
    expect(f.local.acknowledgePublication).not.toHaveBeenCalled();
    expect(runtime.getController().status).toBe("signedOut");
  });
  it("uses reset snapshots as replacements and preserves data on an unchanged cursor", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    vi.mocked(f.cloud.fetch).mockResolvedValue({
      calendar,
      revision: 1,
      unchanged: true,
      reset: false,
      entries: [],
      fetchedAt: "2026-10-12T12:01:00Z",
    });
    await runtime.backgroundRefresh();
    expect(f.local.cacheSnapshot).toHaveBeenLastCalledWith(
      account.id,
      expect.objectContaining({ unchanged: true }),
    );
    vi.mocked(f.cloud.fetch).mockResolvedValue({
      calendar: { ...calendar, revision: 2 },
      revision: 2,
      unchanged: false,
      reset: true,
      entries: [],
      fetchedAt: "2026-10-12T12:02:00Z",
    });
    await runtime.backgroundRefresh();
    expect(runtime.visibleCalendars()[0].entries).toEqual([]);
  });
  it("requires explicit confirmed creation and passes a per-device random secret only to the backend and encrypted binding", async () => {
    const f = fixture({ remote: [] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await expect(
      runtime.getController().createCalendar({
        name: "Mein Plan",
        color: "#527D92",
        visibility: "DETAILS",
        confirmed: false as true,
      }),
    ).rejects.toThrow();
    expect(f.cloud.createCalendar).not.toHaveBeenCalled();
    await runtime.getController().createCalendar({
      name: "Mein Plan",
      color: "#527D92",
      visibility: "DETAILS",
      confirmed: true,
    });
    expect(f.cloud.createCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ deviceSecret: "c".repeat(64) }),
    );
    expect(f.local.bindCalendar).toHaveBeenCalled();
  });
  it("creates and shares an invitation only for an explicit owner action", async () => {
    const f = fixture({ remote: [owner] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.cloud.createInvite).not.toHaveBeenCalled();
    await runtime.getController().invite(owner.id);
    expect(f.options.shareUrl).toHaveBeenCalledWith(
      `lunashift-internal://sharing-invite?token=${"b".repeat(64)}`,
    );
  });
  it("preserves the account and all data when Apple deletion authentication is cancelled", async () => {
    const f = fixture();
    vi.mocked(f.options.isAppleUser).mockResolvedValue(true);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().deleteAccount();
    expect(f.cloud.deleteAccount).not.toHaveBeenCalled();
    expect(f.local.forgetAccount).not.toHaveBeenCalled();
  });
  it("requires separate manual-revocation confirmation and forwards an authorized code only transiently", async () => {
    const f = fixture();
    vi.mocked(f.options.isAppleUser).mockResolvedValue(true);
    vi.mocked(f.options.prepareAppleDeletion).mockResolvedValue({
      status: "manualRevocationRequired",
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().deleteAccount();
    expect(f.cloud.deleteAccount).not.toHaveBeenCalled();
    vi.mocked(f.options.prepareAppleDeletion).mockResolvedValue({
      status: "authorized",
      authorizationCode: "transient",
    });
    await runtime.getController().deleteAccount();
    expect(f.cloud.deleteAccount).toHaveBeenCalledWith(account.id, "transient");
    expect(f.local.forgetAccount).toHaveBeenCalledWith(account.id);
    expect(f.options.forgetAuthProfile).toHaveBeenCalledWith(account.id);
    expect(runtime.getController().status).toBe("signedOut");
  });
  it("never deletes another account after a switch while Apple identity lookup is pending", async () => {
    const f = fixture();
    let release!: (value: boolean) => void;
    vi.mocked(f.options.isAppleUser).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const deleting = runtime.getController().deleteAccount();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    f.changeAccount({ id: "second-account", displayName: "Sam" });
    release(false);
    await expect(deleting).rejects.toThrow("SHARE_ACCOUNT_CHANGED");
    await runtime.backgroundRefresh();
    expect(f.cloud.deleteAccount).not.toHaveBeenCalled();
  });
  it("clears exposed caches and requires authentication after authoritative online session denial", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    vi.mocked(f.cloud.listCalendars).mockRejectedValueOnce(
      new SharingCloudError("SHARE_SESSION_INVALID"),
    );
    await runtime.backgroundRefresh();
    expect(runtime.visibleCalendars()).toEqual([]);
    expect(runtime.getController().status).toBe("signedOut");
    expect(f.local.setActiveAccount).toHaveBeenLastCalledWith(null);
    expect(f.local.forgetAccount).not.toHaveBeenCalled();
  });
  it("does not sign out a fresh account during an old session-denial cleanup", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    let release!: () => void;
    vi.mocked(f.local.setActiveAccount).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    vi.mocked(f.cloud.listCalendars).mockRejectedValueOnce(
      new SharingCloudError("SHARE_SESSION_INVALID"),
    );
    const refresh = runtime.backgroundRefresh();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    f.changeAccount({ id: "second-account", displayName: "Sam" });
    release();
    await refresh;
    await runtime.backgroundRefresh();
    expect(f.auth.signOut).toHaveBeenCalledTimes(1);
    expect(runtime.getController().account?.displayName).toBe("Sam");
  });
  it("starts durable logout immediately despite a hanging publication", async () => {
    const f = fixture({ remote: [owner], bindings: [binding] });
    let release!: () => void;
    vi.mocked(f.cloud.publish).mockImplementationOnce(async (_binding, pending) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { calendarId: pending.calendarId, revision: 2, publishedAt: "2026-10-12T12:00:00Z" };
    });
    const runtime = createCalendarSharingRuntime(f.options);
    const starting = runtime.start();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    const logout = runtime.getController().signOut();
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      expect(f.auth.signOut).toHaveBeenCalledTimes(1);
      expect(f.local.setActiveAccount).toHaveBeenLastCalledWith(null);
    } finally {
      release();
      await starting;
      await logout;
    }
    expect(f.local.acknowledgePublication).not.toHaveBeenCalled();
    expect(runtime.getController().status).toBe("signedOut");
  });
  it("expires visible foreign data immediately even when the activation network request hangs", async () => {
    const f = fixture({
      remote: [calendar, { ...owner, id: "owner-calendar" }],
      bindings: [{ ...binding, calendarId: "owner-calendar" }],
    });
    let release!: () => void;
    vi.mocked(f.cloud.publish).mockImplementationOnce(async (_binding, pending) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { calendarId: pending.calendarId, revision: 2, publishedAt: "2026-10-12T12:00:00Z" };
    });
    const runtime = createCalendarSharingRuntime(f.options);
    let visible = -1;
    runtime.subscribe(() => {
      visible = runtime.getSnapshot().visibleCalendars.length;
    });
    const starting = runtime.start();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(visible).toBe(1);
    f.setNow(Date.parse("2026-10-13T12:01:00Z"));
    const refreshing = runtime.backgroundRefresh();
    try {
      expect(visible).toBe(0);
    } finally {
      release();
      await starting;
      await refreshing;
    }
  });
  it("starts optional sign-in only on the explicit provider action and handles cancellation", async () => {
    const f = fixture({ user: null });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.auth.signInGoogle).not.toHaveBeenCalled();
    await runtime.getController().signIn("google");
    expect(runtime.getController().status).toBe("signedIn");
    expect(f.auth.signInGoogle).toHaveBeenCalledTimes(1);
    await runtime.getController().signOut();
    vi.mocked(f.auth.signInApple).mockResolvedValueOnce(null);
    await runtime.getController().signIn("apple");
    expect(runtime.getController().status).toBe("signedOut");
  });
  it("fails closed if optional local sharing migration cannot be prepared", async () => {
    const f = fixture();
    vi.mocked(f.local.initialize).mockRejectedValue(new Error("private database failure"));
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.getController().status).toBe("unavailable");
    expect(f.cloud.listCalendars).not.toHaveBeenCalled();
  });
  it("does not start a duplicate sign-in while the first provider request is pending", async () => {
    const f = fixture({ user: null });
    let done!: (user: SharingAuthUser | null) => void;
    vi.mocked(f.auth.signInGoogle).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const signing = runtime.getController().signIn("google");
    await expect(runtime.getController().signIn("apple")).rejects.toThrow("SHARE_BUSY");
    done(null);
    await signing;
    expect(f.auth.signInApple).not.toHaveBeenCalled();
  });
  it("updates a received calendar marker locally, immediately and without a cloud write", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().setColor(calendar.id, "#AA4455");
    expect(runtime.getController().calendars.find((c) => c.id === calendar.id)?.color).toBe(
      "#AA4455",
    );
    expect(runtime.visibleCalendars()[0].localColor).toBe("#AA4455");
    expect(runtime.visibleCalendars()[0].calendar.color).toBe(calendar.color);
    expect(f.local.setColor).toHaveBeenCalledWith(account.id, calendar.id, "#AA4455");
    await expect(runtime.getController().setColor(calendar.id, "invalid")).rejects.toThrow(
      "SHARE_INVALID_ARGUMENT",
    );
    await expect(runtime.getController().setColor("missing", "#AA4455")).rejects.toThrow(
      "SHARE_NOT_FOUND",
    );
  });
  it("hides and restores only the selected foreign calendar", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().setVisible(calendar.id, false);
    expect(runtime.visibleCalendars()).toEqual([]);
    await runtime.getController().setVisible(calendar.id, true);
    expect(runtime.visibleCalendars()).toHaveLength(1);
  });
  it("requires owner rights even when an external caller invokes management actions", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await expect(runtime.getController().invite(calendar.id)).rejects.toThrow("SHARE_NOT_FOUND");
    await expect(
      runtime.getController().setMember(calendar.id, "member", "APPROVE"),
    ).rejects.toThrow("SHARE_NOT_FOUND");
    await expect(runtime.getController().deleteCalendar(calendar.id)).rejects.toThrow(
      "SHARE_NOT_FOUND",
    );
    expect(f.cloud.createInvite).not.toHaveBeenCalled();
    expect(f.cloud.setMember).not.toHaveBeenCalled();
  });
  it("approves and revokes a reader while refreshing the actual membership view", async () => {
    const f = fixture({ remote: [owner] });
    const list = {
      userId: "member",
      displayName: "Sam",
      status: "PENDING" as "PENDING" | "ACTIVE" | "REVOKED",
      requestedAt: "2026-10-12T12:00:00Z",
      updatedAt: "2026-10-12T12:00:00Z",
    };
    vi.mocked(f.cloud.listMembers).mockImplementation(async () => ({
      members: [list],
      invites: [],
    }));
    vi.mocked(f.cloud.setMember).mockImplementation(async (_calendar, _user, action) => {
      list.status = action === "APPROVE" ? "ACTIVE" : "REVOKED";
      return list;
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(runtime.getController().calendars[0].members[0].status).toBe("PENDING");
    await runtime.getController().setMember(owner.id, "member", "APPROVE");
    expect(runtime.getController().calendars[0].members[0].status).toBe("ACTIVE");
    await runtime.getController().setMember(owner.id, "member", "REVOKE");
    expect(runtime.getController().calendars[0].members[0].status).toBe("REVOKED");
  });
  it("revokes an unused invitation and removes the cloud calendar without changing local entries", async () => {
    const f = fixture({ remote: [owner] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().revokeInvite(owner.id, "invite");
    expect(f.cloud.revokeInvite).toHaveBeenCalledWith(owner.id, "invite");
    await runtime.getController().deleteCalendar(owner.id);
    expect(runtime.getController().calendars).toEqual([]);
    expect(f.local.forgetAccount).not.toHaveBeenCalled();
    expect(await f.local.readEntries()).toEqual([]);
  });
  it("leaves a foreign calendar under the captured actor and blocks owners from leaving their own", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().leaveCalendar(calendar.id);
    expect(f.cloud.leaveCalendar).toHaveBeenCalledWith(account.id, calendar.id);
    expect(runtime.visibleCalendars()).toEqual([]);
    const g = fixture({ remote: [owner] });
    const ownRuntime = createCalendarSharingRuntime(g.options);
    await ownRuntime.start();
    await expect(ownRuntime.getController().leaveCalendar(owner.id)).rejects.toThrow(
      "SHARE_OWNER_CANNOT_LEAVE",
    );
    expect(g.cloud.leaveCalendar).not.toHaveBeenCalled();
  });
  it("claims an invitation under the captured account and waits for owner approval", async () => {
    const f = fixture({ remote: [] });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    expect(f.cloud.claimInvite).not.toHaveBeenCalled();
    await runtime.getController().claimInvite("b".repeat(64), "Alex");
    expect(f.cloud.claimInvite).toHaveBeenCalledWith(account.id, "b".repeat(64), "Alex");
    expect(runtime.getController().claimResult?.status).toBe("PENDING");
    expect(runtime.visibleCalendars()).toEqual([]);
  });
  it("replaces a lost raw invitation token safely instead of sharing an unusable URL", async () => {
    const f = fixture({ remote: [owner] });
    vi.mocked(f.cloud.createInvite).mockResolvedValueOnce({
      inviteId: "lost",
      calendarId: owner.id,
      token: null,
      expiresAt: "2026-10-19T12:00:00Z",
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().invite(owner.id);
    expect(f.cloud.revokeInvite).toHaveBeenCalledWith(owner.id, "lost");
    expect(f.cloud.createInvite).toHaveBeenCalledTimes(2);
    expect(f.options.shareUrl).toHaveBeenCalledTimes(1);
  });
  it("projects safe overnight/all-day previews and only explicitly selected appointments", async () => {
    const shift: ShiftEntry = {
      kind: "SHIFT",
      id: "local-shift",
      date: "2026-10-24",
      templateId: "local-template",
      title: "Private Station",
      type: "NIGHT",
      allDay: false,
      startTime: "21:00",
      endTime: "07:30",
      breakMinutes: 60,
      color: "#123456",
      symbol: "moon",
      note: "Private note",
      location: null,
      overtimeMinutes: 0,
      holidayPremiumMode: "WITH_TIME_OFF",
      revision: 1,
      createdAt: "2026-10-01",
      updatedAt: "2026-10-01",
      deletedAt: null,
    };
    const appointment = {
      ...shift,
      kind: "APPOINTMENT",
      id: "appointment",
      title: "Private appointment",
      recurrence: null,
    } as unknown as CalendarEntry;
    const f = fixture({ remote: [] });
    vi.mocked(f.local.readEntries).mockResolvedValue([
      shift,
      { ...shift, id: "absence", type: "SICK", allDay: true },
      appointment,
    ]);
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const preview = runtime.getController().preview("DETAILS", ["appointment"]);
    expect(preview.entryCount).toBe(3);
    expect(preview.entries[0].when).toContain("Folgetag");
    expect(preview.entries[1].when).toContain("Ganztägig");
    expect(preview.entries[2].title).toBe("Termin");
    expect(JSON.stringify(preview)).not.toMatch(/Private appointment|local-template|note/);
    expect(
      runtime
        .getController()
        .preview("AVAILABILITY")
        .entries.every((entry) => entry.title === "Nicht verfügbar"),
    ).toBe(true);
    runtime.updateInput({ timeZone: "Europe/Berlin", testLabActive: false });
    runtime.setAppleAvailable(false);
    expect(runtime.getController().appleAvailable).toBe(false);
    await expect(
      runtime.getController().createCalendar({
        name: "My plan",
        color: "#527D92",
        visibility: "DETAILS",
        confirmed: true,
        selectedAppointmentIds: ["missing"],
      }),
    ).rejects.toThrow("SHARE_INVALID_ARGUMENT");
    expect(f.cloud.createCalendar).not.toHaveBeenCalled();
  });
  it("keeps cloud deletion successful even if Apple revocation requires manual removal", async () => {
    const f = fixture();
    vi.mocked(f.options.isAppleUser).mockResolvedValue(true);
    vi.mocked(f.options.prepareAppleDeletion).mockResolvedValue({
      status: "manualRevocationRequired",
    });
    vi.mocked(f.options.confirmManualAppleDeletion).mockResolvedValue(true);
    vi.mocked(f.cloud.deleteAccount).mockResolvedValue({
      deleted: true,
      revocationStatus: "manual_required",
    });
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    await runtime.getController().deleteAccount();
    expect(f.cloud.deleteAccount).toHaveBeenCalledWith(account.id, null);
    expect(f.options.notifyDeletion).toHaveBeenCalledWith("manual_required");
    expect(runtime.getController().status).toBe("signedOut");
    expect(runtime.getController().busy).toBe(false);
  });
  it("clears an invalid online session discovered during a per-calendar fetch", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    vi.mocked(f.cloud.fetch).mockRejectedValueOnce(new SharingCloudError("SHARE_UNAUTHENTICATED"));
    await runtime.backgroundRefresh();
    expect(runtime.getController().status).toBe("signedOut");
    expect(runtime.visibleCalendars()).toEqual([]);
  });
  it("does not poll again after the provider has stopped the worker", async () => {
    const f = fixture();
    const runtime = createCalendarSharingRuntime(f.options);
    await runtime.start();
    const calls = vi.mocked(f.cloud.listCalendars).mock.calls.length;
    runtime.stop();
    await runtime.backgroundRefresh();
    expect(f.cloud.listCalendars).toHaveBeenCalledTimes(calls);
  });
});

it("reconciles another change arriving while a refresh is in flight", async () => {
  const f = fixture();
  const runtime = createCalendarSharingRuntime(f.options);
  await runtime.start();
  let release!: () => void;
  vi.mocked(f.cloud.listCalendars).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return [calendar];
  });
  const before = vi.mocked(f.cloud.listCalendars).mock.calls.length;
  const first = runtime.backgroundRefresh();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const followup = runtime.backgroundRefresh();
  release();
  await Promise.all([first, followup]);
  expect(f.cloud.listCalendars).toHaveBeenCalledTimes(before + 2);
  runtime.stop();
});
it("prepares one invitation without OS sharing and refuses a revoked invitation for every delivery channel", async () => {
  const f = fixture({ remote: [owner] });
  const runtime = createCalendarSharingRuntime(f.options);
  await runtime.start();
  const invite = await runtime.getController().createInvitation(owner.id);
  expect(f.options.shareUrl).not.toHaveBeenCalled();
  expect(invite.url).toContain("b".repeat(64));
  vi.mocked(f.cloud.listMembers).mockResolvedValue({
    members: [],
    invites: [
      {
        id: invite.id,
        expiresAt: invite.expiresAt,
        consumedAt: null,
        revokedAt: "2026-10-12T12:00:00Z",
      },
    ],
  });
  await expect(runtime.getController().shareInvitation(invite)).rejects.toThrow(
    "SHARE_INVITE_INVALID",
  );
  for (const channel of ["messages", "whatsapp", "telegram", "email", "system", "copy"] as const) {
    await expect(runtime.getController().shareInvitation(invite, channel)).rejects.toThrow(
      "SHARE_INVITE_INVALID",
    );
  }
  expect(f.options.shareUrl).not.toHaveBeenCalled();
  runtime.stop();
});
it("forwards the chosen delivery channel only after validating the current invitation", async () => {
  const f = fixture({ remote: [owner] });
  const runtime = createCalendarSharingRuntime(f.options);
  await runtime.start();
  const invite = await runtime.getController().createInvitation(owner.id);
  expect(f.options.shareUrl).not.toHaveBeenCalled();
  await runtime.getController().shareInvitation(invite, "telegram");
  expect(f.options.shareUrl).toHaveBeenCalledWith(invite.url, "telegram");
  runtime.stop();
});
it("copies a valid invitation directly only when the native copy port exists", async () => {
  const f = fixture({ remote: [owner] });
  const copyUrl = vi.fn().mockResolvedValue(undefined);
  const runtime = createCalendarSharingRuntime({ ...f.options, copyUrl });
  await runtime.start();
  const invite = await runtime.getController().createInvitation(owner.id);
  expect(runtime.getController().directCopyAvailable).toBe(true);
  await runtime.getController().shareInvitation(invite, "copy");
  expect(copyUrl).toHaveBeenCalledWith(invite.url);
  expect(f.options.shareUrl).not.toHaveBeenCalled();
  runtime.stop();
});
