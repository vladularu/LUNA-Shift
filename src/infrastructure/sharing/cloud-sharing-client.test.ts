import { describe, expect, it, vi } from "vitest";
import {
  createCloudSharingClient,
  SharingCloudError,
  type SharingCloudTransport,
} from "./cloud-sharing-client";
import type { LocalSharingBinding, SharingPublication } from "../../domain/calendar-sharing";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MUTATION = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const NOW = "2026-10-12T12:00:00+00:00";
const SECRET = "a".repeat(64);
const calendar = {
  id: ID,
  ownerId: USER,
  name: "Mein Dienstplan",
  color: "#D19A22",
  visibility: "DETAILS",
  revision: 1,
  isOwner: true,
  publishedAt: NOW,
  deviceId: DEVICE,
};
const entry = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  startsAt: "2026-10-02T21:00:00+02:00",
  endsAt: "2026-10-03T07:30:00+02:00",
  timeZone: "Europe/Berlin",
  allDay: false,
  title: "Nacht",
  color: "#D19A22",
  symbol: "moon",
};
const binding: LocalSharingBinding = {
  accountId: USER,
  calendarId: ID,
  deviceId: DEVICE,
  deviceSecret: SECRET,
  name: "Mein Dienstplan",
  color: "#D19A22",
  visibility: "DETAILS",
  selectedAppointmentIds: [],
  generation: 1,
  acknowledgedGeneration: 0,
  serverRevision: 0,
  enabled: true,
};
const publication: SharingPublication = {
  accountId: USER,
  calendarId: ID,
  mutationId: MUTATION,
  generation: 1,
  expectedRevision: 0,
  entries: [entry],
};
function fixture(data: unknown = calendar, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const invoke = vi.fn().mockResolvedValue({ data, error });
  const transport = { rpc, functions: { invoke } } as SharingCloudTransport;
  return { rpc, invoke, api: createCloudSharingClient(transport) };
}
const invalid = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toMatchObject({ code: "SHARE_INVALID_RESPONSE" });
};

describe("typed sharing RPC adapter", () => {
  it("uses exact device-secret args and validates matching owner creation", async () => {
    const f = fixture();
    await expect(
      f.api.createCalendar({
        expectedAccountId: USER,
        id: ID,
        deviceId: DEVICE,
        deviceSecret: SECRET,
        name: "Mein Dienstplan",
        color: "#D19A22",
        visibility: "DETAILS",
      }),
    ).resolves.toEqual(calendar);
    expect(f.rpc).toHaveBeenCalledWith("sharing_create_calendar", {
      p_expected_actor_id: USER,
      p_calendar_id: ID,
      p_device_id: DEVICE,
      p_device_secret: SECRET,
      p_name: "Mein Dienstplan",
      p_color: "#D19A22",
      p_visibility: "DETAILS",
    });
  });
  it("publishes only eight safe entry fields and rejects identity mismatch before transport", async () => {
    const f = fixture({ calendarId: ID, revision: 1, publishedAt: NOW });
    await f.api.publish(binding, publication);
    expect(f.rpc).toHaveBeenCalledWith("sharing_publish_calendar", {
      p_calendar_id: ID,
      p_device_id: DEVICE,
      p_device_secret: SECRET,
      p_mutation_id: MUTATION,
      p_expected_revision: 0,
      p_entries: [entry],
    });
    await expect(
      f.api.publish(binding, { ...publication, accountId: DEVICE }),
    ).rejects.toMatchObject({ code: "SHARE_INVALID_ARGUMENT" });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects private payload fields without uploading them", async () => {
    const f = fixture();
    await expect(
      f.api.publish(binding, {
        ...publication,
        entries: [{ ...entry, note: "private" }],
      } as unknown as SharingPublication),
    ).rejects.toMatchObject({ code: "SHARE_INVALID_ARGUMENT" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("validates complete snapshot, matched calendar, revision and unchanged/reset invariants", async () => {
    const good = {
      calendar,
      revision: 1,
      unchanged: false,
      reset: true,
      entries: [entry],
      fetchedAt: NOW,
    };
    await expect(fixture(good).api.fetch(ID, 0)).resolves.toEqual(good);
    for (const value of [
      { ...good, calendar: { ...calendar, id: DEVICE } },
      { ...good, revision: 2 },
      { ...good, unchanged: true },
      { ...good, entries: [{ ...entry, note: "private" }] },
      { ...good, entries: [entry, entry] },
      { ...good, fetchedAt: "not-time" },
    ])
      await invalid(fixture(value).api.fetch(ID, 0));
    await invalid(
      fixture({ ...good, unchanged: true, reset: false, entries: [] }).api.fetch(ID, 0),
    );
    await expect(
      fixture({ ...good, unchanged: true, reset: false, entries: [] }).api.fetch(ID, 1),
    ).resolves.toMatchObject({ unchanged: true });
  });
  it("rejects huge lists, invalid DTO keys, enums, IDs and unsafe revisions", async () => {
    for (const value of [
      [{ ...calendar, revision: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...calendar, visibility: "PUBLIC" }],
      [{ ...calendar, id: "local" }],
      [{ ...calendar, note: "secret" }],
      [{ ...calendar, isOwner: false, deviceId: DEVICE }],
      [{ ...calendar, isOwner: true, deviceId: undefined }],
    ])
      await invalid(fixture(value).api.listCalendars());
    await invalid(fixture(Array(1001).fill({ ...calendar, isOwner: false })).api.listCalendars());
  });
  it("accepts viewer metadata without publishing device and sanitizes known errors only", async () => {
    const { deviceId: _deviceId, ...viewer } = calendar;
    await expect(
      fixture([{ ...viewer, isOwner: false }]).api.listCalendars(),
    ).resolves.toHaveLength(1);
    await expect(
      fixture(null, { message: "SHARE_REVISION_CONFLICT", details: "private" }).api.listCalendars(),
    ).rejects.toMatchObject({
      code: "SHARE_REVISION_CONFLICT",
      message: "SHARE_REVISION_CONFLICT",
    });
    try {
      await fixture(null, {
        message: "Authorization Bearer private-token",
        code: "secret",
      }).api.listCalendars();
    } catch (error) {
      expect(error).toBeInstanceOf(SharingCloudError);
      expect(String(error)).not.toContain("private-token");
      expect(error).toMatchObject({ code: "SHARE_NETWORK_FAILED" });
    }
  });
  it("validates invites/members and keeps raw token only in explicit create/claim arguments", async () => {
    const invite = { inviteId: MUTATION, calendarId: ID, token: SECRET, expiresAt: NOW };
    await expect(fixture(invite).api.createInvite(ID, MUTATION)).resolves.toEqual(invite);
    await invalid(fixture({ ...invite, calendarId: DEVICE }).api.createInvite(ID, MUTATION));
    await invalid(fixture({ ...invite, token: "bad" }).api.createInvite(ID, MUTATION));
    const claimed = { calendarId: ID, calendarName: "Plan", status: "PENDING" };
    const f = fixture(claimed);
    await f.api.claimInvite(USER, SECRET, "Leserin");
    expect(f.rpc).toHaveBeenCalledWith("sharing_claim_invite", {
      p_expected_actor_id: USER,
      p_token: SECRET,
      p_display_name: "Leserin",
    });
    await invalid(
      fixture({ ...claimed, status: "OWNER" }).api.claimInvite(USER, SECRET, "Leserin"),
    );
    const member = {
      userId: USER,
      displayName: "Leserin",
      status: "ACTIVE",
      requestedAt: NOW,
      updatedAt: NOW,
    };
    await expect(fixture(member).api.setMember(ID, USER, "APPROVE")).resolves.toEqual(member);
    await invalid(fixture({ ...member, userId: DEVICE }).api.setMember(ID, USER, "APPROVE"));
  });
  it("calls all management RPCs with strict IDs and validates boolean acknowledgements", async () => {
    const member = {
      userId: USER,
      displayName: "Leserin",
      status: "PENDING",
      requestedAt: NOW,
      updatedAt: NOW,
    };
    await expect(
      fixture({ members: [member], invites: [] }).api.listMembers(ID),
    ).resolves.toMatchObject({ members: [member] });
    await expect(fixture({ revoked: true }).api.revokeInvite(ID, MUTATION)).resolves.toEqual({
      revoked: true,
    });
    await expect(fixture({ left: true }).api.leaveCalendar(USER, ID)).resolves.toEqual({
      left: true,
    });
    await expect(fixture({ deleted: true }).api.deleteCalendar(ID)).resolves.toEqual({
      deleted: true,
    });
    await invalid(fixture({ deleted: false }).api.deleteCalendar(ID));
  });
  it("uses authenticated Edge deletion for every provider and returns manual-revoke status", async () => {
    const f = fixture({ deleted: true, revocationStatus: "manual_required" });
    await expect(f.api.deleteAccount(USER)).resolves.toEqual({
      deleted: true,
      revocationStatus: "manual_required",
    });
    expect(f.invoke).toHaveBeenCalledWith("sharing-delete-account", {
      body: { expectedAccountId: USER },
    });
    expect(f.rpc).not.toHaveBeenCalled();
    const g = fixture({ deleted: true, revocationStatus: "revoked" });
    await g.api.deleteAccount(USER, "fresh-code");
    expect(g.invoke).toHaveBeenCalledWith("sharing-delete-account", {
      body: { expectedAccountId: USER, appleAuthorizationCode: "fresh-code" },
    });
  });
});

it("rejects hostile entry DTOs and preserves no partial validated snapshot", async () => {
  const base = {
    calendar,
    revision: 1,
    unchanged: false,
    reset: true,
    entries: [entry],
    fetchedAt: NOW,
  };
  for (const bad of [
    { ...entry, timeZone: "Bad/Zone" },
    { ...entry, startsAt: "2026-10-02" },
    { ...entry, endsAt: entry.startsAt },
    { ...entry, color: "transparent" },
    { ...entry, symbol: "medical-kit" },
    { ...entry, title: "private\ntext" },
    { ...entry, allDay: 1 },
    { ...entry, id: "private-local-id" },
  ])
    await invalid(fixture({ ...base, entries: [entry, bad] }).api.fetch(ID, 0));
});
it("validates profile acknowledgement and availability redaction", async () => {
  await expect(
    fixture({ userId: USER, displayName: "Leserin" }).api.saveProfile(USER, "Leserin"),
  ).resolves.toEqual({ userId: USER, displayName: "Leserin" });
  await invalid(
    fixture({ userId: USER, displayName: "Leserin", email: "private" }).api.saveProfile(
      USER,
      "Leserin",
    ),
  );
  await invalid(
    fixture({
      calendar: { ...calendar, visibility: "AVAILABILITY" },
      revision: 1,
      unchanged: false,
      reset: true,
      entries: [entry],
      fetchedAt: NOW,
    }).api.fetch(ID, 0),
  );
});

it("captures confirmed expected account ID and rejects malformed IDs before Edge call", async () => {
  const f = fixture({ deleted: true, revocationStatus: "not_applicable" });
  await f.api.deleteAccount(USER);
  expect(f.invoke).toHaveBeenCalledWith("sharing-delete-account", {
    body: { expectedAccountId: USER },
  });
  await expect(f.api.deleteAccount("local-id")).rejects.toMatchObject({
    code: "SHARE_INVALID_ARGUMENT",
  });
  expect(f.invoke).toHaveBeenCalledTimes(1);
});
it.each(["SHARE_RATE_LIMIT", "SHARE_PROVIDER_REVOKE_REQUIRED", "SHARE_ACCOUNT_MISMATCH"])(
  "preserves only known sanitized server code %s",
  async (code) => {
    await expect(
      fixture(null, { message: code, details: "private-token" }).api.listCalendars(),
    ).rejects.toMatchObject({ code, message: code });
  },
);

it("profile save asserts captured account and rejects mismatched acknowledgement", async () => {
  const f = fixture({ userId: USER, displayName: "Leserin" });
  await f.api.saveProfile(USER, "Leserin");
  expect(f.rpc).toHaveBeenCalledWith("sharing_save_profile", {
    p_expected_actor_id: USER,
    p_display_name: "Leserin",
  });
  await invalid(
    fixture({ userId: DEVICE, displayName: "Leserin" }).api.saveProfile(USER, "Leserin"),
  );
});
it("new calendar creation pins actor independently of generated calendar ID", async () => {
  await invalid(
    fixture({ ...calendar, ownerId: DEVICE }).api.createCalendar({
      expectedAccountId: USER,
      id: ID,
      deviceId: DEVICE,
      deviceSecret: SECRET,
      name: calendar.name,
      color: calendar.color,
      visibility: "DETAILS",
    }),
  );
});
it("invalid captured actor aborts profile/create/claim before any RPC", async () => {
  const f = fixture();
  await expect(f.api.saveProfile("local", "Leserin")).rejects.toMatchObject({
    code: "SHARE_INVALID_ARGUMENT",
  });
  await expect(f.api.claimInvite("local", SECRET, "Leserin")).rejects.toMatchObject({
    code: "SHARE_INVALID_ARGUMENT",
  });
  await expect(
    f.api.createCalendar({
      expectedAccountId: "local",
      id: ID,
      deviceId: DEVICE,
      deviceSecret: SECRET,
      name: calendar.name,
      color: calendar.color,
      visibility: "DETAILS",
    }),
  ).rejects.toMatchObject({ code: "SHARE_INVALID_ARGUMENT" });
  expect(f.rpc).not.toHaveBeenCalled();
});

it("calendar leave asserts captured actor and cannot silently affect a changed account", async () => {
  const f = fixture({ left: true });
  await f.api.leaveCalendar(USER, ID);
  expect(f.rpc).toHaveBeenCalledWith("sharing_leave_calendar", {
    p_expected_actor_id: USER,
    p_calendar_id: ID,
  });
  await expect(f.api.leaveCalendar("local", ID)).rejects.toMatchObject({
    code: "SHARE_INVALID_ARGUMENT",
  });
  expect(f.rpc).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "rejects published intervals over48h before upload (allDay=%s)",
  async (allDay) => {
    const f = fixture({ calendarId: ID, revision: 1, publishedAt: NOW });
    const tooLong = { ...entry, allDay, endsAt: "2026-10-04T21:00:00.000001+02:00" };
    await expect(
      f.api.publish(binding, { ...publication, entries: [tooLong] }),
    ).rejects.toMatchObject({ code: "SHARE_INVALID_ARGUMENT" });
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "rejects fetched intervals over48h before exposing DTO (allDay=%s)",
  async (allDay) => {
    const tooLong = { ...entry, allDay, endsAt: "2026-10-04T21:00:00.000001+02:00" };
    await invalid(
      fixture({
        calendar,
        revision: 1,
        unchanged: false,
        reset: true,
        entries: [tooLong],
        fetchedAt: NOW,
      }).api.fetch(ID, 0),
    );
  },
);
it("accepts exact48 elapsed hours and25hour DST availability day", async () => {
  for (const bounded of [
    { ...entry, endsAt: "2026-10-04T21:00:00+02:00" },
    {
      ...entry,
      allDay: true,
      startsAt: "2026-10-25T00:00:00+02:00",
      endsAt: "2026-10-26T00:00:00+01:00",
    },
  ]) {
    await expect(
      fixture({
        calendar,
        revision: 1,
        unchanged: false,
        reset: true,
        entries: [bounded],
        fetchedAt: NOW,
      }).api.fetch(ID, 0),
    ).resolves.toMatchObject({ entries: [bounded] });
  }
});
