import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("private cloud security contract runs in an isolated process", async (context) => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--test",
    fileURLToPath(new URL("./private-cloud-security.test.mjs", import.meta.url)),
  ]);
  context.diagnostic(stdout.trim());
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CALENDAR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MUTATION = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const DEVICE_SECRET = "a".repeat(64);
const SESSIONS = {
  [OWNER]: "00000000-0000-4000-8000-000000000001",
  [VIEWER]: "00000000-0000-4000-8000-000000000002",
  [OTHER]: "00000000-0000-4000-8000-000000000003",
};
const entry = (id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") => ({
  id,
  startsAt: "2026-10-02T21:00:00+02:00",
  endsAt: "2026-10-03T07:30:00+02:00",
  timeZone: "Europe/Berlin",
  allDay: false,
  title: "Nacht",
  color: "#D19A22",
  symbol: "moon",
});
let db;
const rpcNames = new Set([
  "sharing_capabilities_v3",
  "sharing_publish_calendar_v3",
  "sharing_fetch_calendar_v3",
  "sharing_capabilities",
  "sharing_publish_calendar_v2",
  "sharing_fetch_calendar_v2",
  "sharing_create_invite_v2",
  "sharing_list_members_v2",
  "sharing_set_member_rights",
  "sharing_save_profile",
  "sharing_create_calendar",
  "sharing_publish_calendar",
  "sharing_list_calendars",
  "sharing_fetch_calendar",
  "sharing_create_invite",
  "sharing_claim_invite",
  "sharing_list_members",
  "sharing_set_member",
  "sharing_revoke_invite",
  "sharing_leave_calendar",
  "sharing_delete_calendar",
  "sharing_delete_account",
]);
const actorBoundRpcNames = new Set([
  "sharing_save_profile",
  "sharing_create_calendar",
  "sharing_claim_invite",
  "sharing_leave_calendar",
  "sharing_delete_account",
]);
async function rpc(
  user,
  name,
  args = [],
  role = "authenticated",
  sessionId = SESSIONS[user],
  expectedActor = user,
) {
  assert.ok(rpcNames.has(name));
  assert.ok(["authenticated", "anon"].includes(role));
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: user, ...(sessionId === undefined ? {} : { session_id: sessionId }) }),
  ]);
  try {
    const values = actorBoundRpcNames.has(name) ? [expectedActor, ...args] : args;
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    const result = await db.query(`select public.${name}(${placeholders}) as value`, values);
    return result.rows[0].value;
  } finally {
    await db.exec("reset role");
  }
}
async function create(visibility = "DETAILS") {
  return rpc(OWNER, "sharing_create_calendar", [
    CALENDAR,
    DEVICE,
    DEVICE_SECRET,
    "Mein Dienstplan",
    "#D19A22",
    visibility,
  ]);
}
async function publish(
  entries = [entry()],
  revision = 0,
  mutation = MUTATION,
  device = DEVICE,
  user = OWNER,
  secret = DEVICE_SECRET,
) {
  return rpc(user, "sharing_publish_calendar", [
    CALENDAR,
    device,
    secret,
    mutation,
    revision,
    JSON.stringify(entries),
  ]);
}
async function invited() {
  await create();
  await publish();
  const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]);
  await rpc(VIEWER, "sharing_claim_invite", [invite.token, "Leserin"]);
  return invite;
}
const failure =
  (message, code = "22023") =>
  (error) =>
    error.message === message && error.code === code;

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
    create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, not_after timestamptz);
    create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, provider text not null);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
  `);
  const sql = await readFile("supabase/migrations/202610120001_calendar_sharing.sql", "utf8");
  await db.exec(sql);
  await db.exec(`
    create schema realtime;
    create table realtime.messages(topic text not null, extension text not null, payload jsonb not null, private boolean not null);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as
      $$ select current_setting('realtime.topic', true) $$;
    create function realtime.send(p_payload jsonb,p_event text,p_topic text,p_private boolean) returns void
      language sql as $$ insert into realtime.messages values(p_topic,'broadcast',p_payload,p_private) $$;
  `);
  await db.exec(await readFile("supabase/migrations/202610130001_sharing_realtime.sql", "utf8"));
  await db.exec(
    await readFile("supabase/migrations/202610130002_sharing_content_rights.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20261021134519_sharing_shift_duration.sql", "utf8"),
  );
});
beforeEach(async () => {
  await db.exec("reset role; truncate realtime.messages");
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [OWNER, VIEWER, OTHER]);
  for (const user of [OWNER, VIEWER, OTHER])
    await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [SESSIONS[user], user]);
});
after(async () => {
  if (db) await db.close();
});

const rights = (shifts = true, appointments = false, notes = false) => ({
  shifts,
  appointments,
  notes,
});
async function publishV2(
  entries,
  revision = 0,
  mutation = MUTATION,
  user = OWNER,
  secret = DEVICE_SECRET,
) {
  return rpc(user, "sharing_publish_calendar_v2", [
    CALENDAR,
    DEVICE,
    secret,
    mutation,
    revision,
    JSON.stringify(entries),
  ]);
}
async function joinV2(user = VIEWER, contents = rights()) {
  const invitation = await rpc(OWNER, "sharing_create_invite_v2", [
    CALENDAR,
    crypto.randomUUID(),
    JSON.stringify(contents),
  ]);
  const joined = await rpc(user, "sharing_claim_invite", [invitation.token, "Leserin"]);
  assert.equal(joined.status, "ACTIVE");
  return invitation;
}
const typedEntries = () => [
  { ...entry(), kind: "SHIFT", note: "Dienstnotiz\nZweite Zeile" },
  {
    ...entry("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef"),
    kind: "APPOINTMENT",
    title: "Arzttermin",
    symbol: "calendar",
    note: "Terminnotiz",
  },
];

const durationEntries = () =>
  typedEntries().map((entry) => ({ ...entry, breakMinutes: entry.kind === "SHIFT" ? 60 : null }));
const publishV3 = (
  entries = durationEntries(),
  revision = 0,
  mutation = MUTATION,
  user = OWNER,
  secret = DEVICE_SECRET,
) =>
  rpc(user, "sharing_publish_calendar_v3", [
    CALENDAR,
    DEVICE,
    secret,
    mutation,
    revision,
    JSON.stringify(entries),
  ]);

test("v3 automatically includes pauses within existing shift rights and retains legacy response shapes", async () => {
  await create();
  const published = await publishV3();
  assert.deepEqual(await publishV3(), published);
  await joinV2();
  assert.deepEqual(await rpc(OWNER, "sharing_capabilities"), { contentVersion: 2 });
  assert.deepEqual(await rpc(OWNER, "sharing_capabilities_v3"), {
    contentVersion: 2,
    durationVersion: 1,
  });
  const snapshot = await rpc(VIEWER, "sharing_fetch_calendar_v3", [CALENDAR, null]);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].breakMinutes, 60);
  assert.equal(snapshot.entries[0].note, null);
  for (const name of ["sharing_fetch_calendar", "sharing_fetch_calendar_v2"]) {
    const old = await rpc(VIEWER, name, [CALENDAR, null]);
    assert.equal("breakMinutes" in old.entries[0], false);
    assert.equal(Object.keys(old.entries[0]).length, name.endsWith("v2") ? 10 : 8);
  }
  const unchanged = await rpc(VIEWER, "sharing_fetch_calendar_v3", [CALENDAR, snapshot.revision]);
  assert.equal(unchanged.unchanged, true);
  assert.deepEqual(unchanged.entries, []);
  await rpc(OWNER, "sharing_set_member_rights", [
    CALENDAR,
    VIEWER,
    JSON.stringify(rights(false, true)),
  ]);
  const reduced = await rpc(VIEWER, "sharing_fetch_calendar_v3", [CALENDAR, snapshot.revision]);
  assert.equal(reduced.unchanged, false);
  assert.equal(reduced.entries.length, 1);
  assert.equal(reduced.entries[0].kind, "APPOINTMENT");
  assert.equal(reduced.entries[0].breakMinutes, null);
});

test("v3 enforces device ownership, membership, session and anonymous boundaries", async () => {
  await create();
  await assert.rejects(
    publishV3(undefined, 0, MUTATION, OTHER),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await assert.rejects(publishV3(undefined, 0, MUTATION, OWNER, "b".repeat(64)));
  await publishV3();
  await joinV2();
  await assert.rejects(
    rpc(OTHER, "sharing_fetch_calendar_v3", [CALENDAR, null]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "REVOKE"]);
  await assert.rejects(
    rpc(VIEWER, "sharing_fetch_calendar_v3", [CALENDAR, null]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await assert.rejects(rpc(OWNER, "sharing_capabilities_v3", [], "anon"));
  await assert.rejects(rpc(OWNER, "sharing_fetch_calendar_v3", [CALENDAR, null], "anon"));
  await db.query("delete from auth.sessions where user_id=$1", [OWNER]);
  await assert.rejects(rpc(OWNER, "sharing_capabilities_v3"));
  await assert.rejects(rpc(OWNER, "sharing_fetch_calendar_v3", [CALENDAR, null]));
});

test("v3 validates pauses and binds them into the mutation receipt", async () => {
  await create();
  for (const breakMinutes of [-1, 2881, 1.5, "60", true, {}, []])
    await assert.rejects(
      publishV3([{ ...durationEntries()[0], breakMinutes }]),
      failure("SHARE_INVALID_ARGUMENT"),
    );
  for (const patch of [{ allDay: true }, { kind: "APPOINTMENT" }, { unexpected: true }])
    await assert.rejects(
      publishV3([{ ...durationEntries()[0], ...patch }]),
      failure("SHARE_INVALID_ARGUMENT"),
    );
  await publishV3();
  await assert.rejects(
    publishV3([{ ...durationEntries()[0], breakMinutes: 30 }, durationEntries()[1]]),
    failure("SHARE_MUTATION_REUSED"),
  );
  await publishV3([{ ...durationEntries()[0], breakMinutes: 0 }], 1, crypto.randomUUID());
  assert.equal(
    (await rpc(OWNER, "sharing_fetch_calendar_v3", [CALENDAR, null])).entries[0].breakMinutes,
    0,
  );
  await publishV2(typedEntries(), 2, crypto.randomUUID());
  assert.equal(
    (await rpc(OWNER, "sharing_fetch_calendar_v3", [CALENDAR, null])).entries[0].breakMinutes,
    null,
  );
});

test("v3 preserves unknown legacy durations and never exposes pauses in availability shares", async () => {
  await create("AVAILABILITY");
  const neutral = {
    ...durationEntries()[0],
    title: "Nicht verfügbar",
    symbol: "unavailable",
    color: "#737373",
    note: null,
  };
  await assert.rejects(publishV3([neutral]), failure("SHARE_INVALID_ARGUMENT"));
  await publishV3([{ ...neutral, kind: null, breakMinutes: null }]);
  assert.equal(
    (await rpc(OWNER, "sharing_fetch_calendar_v3", [CALENDAR, null])).entries[0].breakMinutes,
    null,
  );
});
test("v2 invitation remains active for 48 hours with multiple joins, and stop blocks further claims", async () => {
  await create();
  await publishV2(typedEntries());
  const invitation = await joinV2();
  const hours = (Date.parse(invitation.expiresAt) - Date.now()) / 3600000;
  assert.ok(hours > 47.9 && hours <= 48);
  await rpc(OTHER, "sharing_claim_invite", [invitation.token, "Andere Leserin"]);
  await rpc(VIEWER, "sharing_claim_invite", [invitation.token, "Leserin"]);
  const link = (await rpc(OWNER, "sharing_list_members_v2", [CALENDAR])).invites[0];
  assert.equal(link.joinedCount, 2);
  assert.equal(link.consumedAt, null);
  await rpc(OWNER, "sharing_revoke_invite", [CALENDAR, invitation.inviteId]);
  await assert.rejects(
    rpc(OTHER, "sharing_claim_invite", [invitation.token, "Andere Leserin"]),
    failure("SHARE_INVITE_INVALID"),
  );
  assert.equal(
    (await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null])).entries.length,
    1,
  );
});
test("v2 selected contents become active directly, and both fetch versions enforce them", async () => {
  await create();
  await publishV2(typedEntries());
  await joinV2();
  const v2 = await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null]);
  assert.equal(v2.entries.length, 1);
  assert.equal(v2.entries[0].kind, "SHIFT");
  assert.equal(v2.entries[0].note, null);
  const v1 = await rpc(VIEWER, "sharing_fetch_calendar", [CALENDAR, null]);
  assert.equal(v1.entries.length, 1);
  assert.equal(Object.keys(v1.entries[0]).length, 8);
  assert.equal(
    (await rpc(OWNER, "sharing_list_members_v2", [CALENDAR])).members[0].rights.notes,
    false,
  );
});
test("appointments-only access and future snapshots retain the exact scope", async () => {
  await create();
  await publishV2(typedEntries());
  await joinV2(VIEWER, rights(false, true, true));
  const first = await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null]);
  assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0].title, "Arzttermin");
  assert.equal(first.entries[0].note, "Terminnotiz");
  await publishV2(
    [
      ...typedEntries(),
      { ...entry("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeea"), kind: "APPOINTMENT", note: null },
    ],
    1,
    crypto.randomUUID(),
  );
  const next = await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, first.revision]);
  assert.equal(next.reset, true);
  assert.equal(next.entries.length, 2);
});
test("reducing one person's notes forces cache reset without changing owner or other person's cursor", async () => {
  await create();
  await publishV2(typedEntries());
  await joinV2(VIEWER, rights(true, true, true));
  await joinV2(OTHER, rights(true, true, true));
  const before = await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null]);
  const other = await rpc(OTHER, "sharing_fetch_calendar_v2", [CALENDAR, null]);
  const owner = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  await rpc(OWNER, "sharing_set_member_rights", [CALENDAR, VIEWER, JSON.stringify(rights())]);
  const next = await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, before.revision]);
  assert.equal(next.reset, true);
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].note, null);
  assert.equal(
    (await rpc(OTHER, "sharing_fetch_calendar_v2", [CALENDAR, other.revision])).unchanged,
    true,
  );
  assert.equal(
    (await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, owner.revision])).unchanged,
    true,
  );
  await publishV2(typedEntries(), owner.revision, crypto.randomUUID());
});
test("v2 rights are owner-only, strictly typed and cannot revive revoked access", async () => {
  await create();
  await publishV2(typedEntries());
  const invitation = await joinV2();
  await assert.rejects(
    rpc(VIEWER, "sharing_set_member_rights", [
      CALENDAR,
      VIEWER,
      JSON.stringify(rights(true, true, true)),
    ]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  for (const bad of [
    null,
    [],
    {},
    { shifts: true, appointments: false, notes: "true" },
    { ...rights(), location: true },
  ])
    await assert.rejects(
      rpc(OWNER, "sharing_set_member_rights", [CALENDAR, VIEWER, JSON.stringify(bad)]),
      failure("SHARE_INVALID_ARGUMENT"),
    );
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "REVOKE"]);
  await assert.rejects(
    rpc(OWNER, "sharing_set_member_rights", [CALENDAR, VIEWER, JSON.stringify(rights())]),
    failure("SHARE_MEMBER_INVALID"),
  );
  await assert.rejects(
    rpc(VIEWER, "sharing_claim_invite", [invitation.token, "Leserin"]),
    failure("SHARE_INVITE_INVALID"),
  );
  await assert.rejects(
    rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
});
test("legacy untyped entries remain visible only with unrestricted contents; upgrading makes them filterable", async () => {
  await create();
  await publish();
  const invite = await invitedAfterCreate();
  assert.ok(invite);
  await rpc(OWNER, "sharing_set_member_rights", [CALENDAR, VIEWER, JSON.stringify(rights())]);
  assert.equal(
    (await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null])).entries.length,
    0,
  );
  await publishV2(typedEntries(), 1, crypto.randomUUID());
  assert.equal(
    (await rpc(VIEWER, "sharing_fetch_calendar_v2", [CALENDAR, null])).entries.length,
    1,
  );
});
async function invitedAfterCreate() {
  const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, crypto.randomUUID()]);
  assert.equal(
    (await rpc(VIEWER, "sharing_claim_invite", [invite.token, "Leserin"])).status,
    "PENDING",
  );
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  return invite;
}
test("v2 receipts bind notes, kind and invitation rights, with safe retries and device validation", async () => {
  await create();
  const entries = typedEntries();
  const first = await publishV2(entries);
  assert.deepEqual(await publishV2(entries), first);
  await assert.rejects(
    publishV2([{ ...entries[0], note: "Andere Notiz" }, entries[1]]),
    failure("SHARE_MUTATION_REUSED"),
  );
  await assert.rejects(
    publishV2(entries, 0, MUTATION, OWNER, "b".repeat(64)),
    failure("SHARE_DEVICE_MISMATCH", "42501"),
  );
  const mutation = crypto.randomUUID();
  const invite = await rpc(OWNER, "sharing_create_invite_v2", [
    CALENDAR,
    mutation,
    JSON.stringify(rights()),
  ]);
  const retry = await rpc(OWNER, "sharing_create_invite_v2", [
    CALENDAR,
    mutation,
    JSON.stringify(rights()),
  ]);
  assert.equal(retry.inviteId, invite.inviteId);
  assert.equal(retry.token, null);
  await assert.rejects(
    rpc(OWNER, "sharing_create_invite_v2", [
      CALENDAR,
      mutation,
      JSON.stringify(rights(true, true, true)),
    ]),
    failure("SHARE_MUTATION_REUSED"),
  );
});
test("v2 publication rejects oversized notes, unknown content and revealing availability notes atomically", async () => {
  await create();
  for (const bad of [
    { ...typedEntries()[0], note: "x".repeat(4097) },
    { ...typedEntries()[0], note: "bad\u0001" },
    { ...typedEntries()[0], kind: "SALARY" },
    { ...typedEntries()[0], location: "private" },
  ])
    await assert.rejects(publishV2([bad]), failure("SHARE_INVALID_ARGUMENT"));
  assert.equal((await rpc(OWNER, "sharing_fetch_calendar_v2", [CALENDAR, null])).entries.length, 0);
});
test("legacy receivers never get notes even when their v2 invitation allows them", async () => {
  await create();
  await publishV2(typedEntries());
  await joinV2(VIEWER, rights(true, true, true));
  const data = await rpc(VIEWER, "sharing_fetch_calendar", [CALENDAR, null]);
  assert.equal(data.entries.length, 2);
  assert.ok(data.entries.every((e) => !("note" in e) && !("kind" in e)));
});

test("RPC entry points are unavailable to anon and PUBLIC; auth without a real user fails", async () => {
  await assert.rejects(
    rpc(null, "sharing_list_calendars", [], "anon"),
    (error) => error.code === "42501",
  );
  await assert.rejects(
    rpc(null, "sharing_list_calendars"),
    failure("SHARE_UNAUTHENTICATED", "42501"),
  );
  const grants = await db.query(
    "select proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'sharing_%'",
  );
  assert.equal(grants.rows.length, rpcNames.size);
  assert.ok(grants.rows.every((row) => !row.anonymous));
});
test("private tables have RLS and no direct authenticated grants", async () => {
  const result = await db.query(
    "select c.relname, c.relrowsecurity, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as can_access from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='luna_sharing' and c.relkind='r'",
  );
  assert.ok(result.rows.length >= 5);
  assert.ok(result.rows.every((row) => row.relrowsecurity && !row.can_access));
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      db.query("select * from luna_sharing.calendars"),
      (error) => error.code === "42501",
    );
  } finally {
    await db.exec("reset role");
  }
});
test("security definer functions fix empty search_path and have no dynamic SQL", async () => {
  const result = await db.query(
    "select proname, proconfig, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','luna_sharing') and p.prosecdef",
  );
  assert.ok(result.rows.length >= rpcNames.size);
  assert.ok(
    result.rows.every(
      (row) =>
        row.proconfig.includes('search_path=""') &&
        !/\bexecute\s+(format|p_|query)/i.test(row.definition),
    ),
  );
});
test("calendar creation is idempotent only for exact owner/device/config", async () => {
  const first = await create();
  const retry = await create();
  assert.deepEqual(retry, first);
  assert.equal(first.revision, 0);
  await assert.rejects(
    rpc(OTHER, "sharing_create_calendar", [
      CALENDAR,
      DEVICE,
      DEVICE_SECRET,
      "Andere",
      "#D19A22",
      "DETAILS",
    ]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await assert.rejects(
    rpc(OWNER, "sharing_create_calendar", [
      CALENDAR,
      DEVICE,
      DEVICE_SECRET,
      "Andere",
      "#D19A22",
      "DETAILS",
    ]),
    failure("SHARE_MUTATION_REUSED"),
  );
});
test("owner-only device-bound publishing increments server revision and is safely repeatable", async () => {
  await create();
  await assert.rejects(
    publish([entry()], 0, MUTATION, DEVICE, OTHER),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await assert.rejects(
    publish([entry()], 0, MUTATION, OTHER),
    failure("SHARE_DEVICE_MISMATCH", "42501"),
  );
  const first = await publish();
  assert.equal(first.revision, 1);
  assert.deepEqual(await publish(), first);
  await assert.rejects(
    publish([{ ...entry(), title: "Geändert" }]),
    failure("SHARE_MUTATION_REUSED"),
  );
  await assert.rejects(publish([], 0, OTHER), failure("SHARE_REVISION_CONFLICT"));
});
test("snapshot replacement deletes missing entries and recovers old/future/null cursors", async () => {
  await create();
  await publish();
  const original = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  assert.equal(original.reset, true);
  assert.equal(original.unchanged, false);
  assert.equal(original.entries.length, 1);
  const same = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, 1]);
  assert.equal(same.unchanged, true);
  assert.equal(same.reset, false);
  assert.deepEqual(same.entries, []);
  await publish([], 1, OTHER);
  for (const cursor of [null, 0, 1, 99]) {
    const empty = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, cursor]);
    assert.equal(empty.reset, true);
    assert.equal(empty.revision, 2);
    assert.deepEqual(empty.entries, []);
  }
});
test("privacy fields, unknown keys, duplicate IDs, bad times/timezones/colors/symbols fail atomically", async () => {
  await create();
  const invalid = [
    [{ ...entry(), note: "private" }],
    [{ ...entry(), location: "private" }],
    [{ ...entry(), salary: 1234 }],
    [{ ...entry(), templateId: "private" }],
    [{ ...entry(), timeZone: "Bad/Zone" }],
    [{ ...entry(), symbol: "medical-kit" }],
    [{ ...entry(), endsAt: entry().startsAt }],
    [{ ...entry(), startsAt: "2026-10-02" }],
    [{ ...entry(), color: "red" }],
    [{ ...entry(), title: "x".repeat(129) }],
    [{ ...entry(), title: "bad\ntext" }],
    [entry(), entry()],
    [{ ...entry(), allDay: "false" }],
    [{ ...entry(), id: "not-uuid" }],
  ];
  for (const entries of invalid)
    await assert.rejects(publish(entries), failure("SHARE_INVALID_ARGUMENT"));
  assert.equal((await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null])).revision, 0);
  assert.deepEqual((await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null])).entries, []);
});
test("availability mode cannot publish revealing titles/icons/colors", async () => {
  await create("AVAILABILITY");
  await assert.rejects(publish(), failure("SHARE_INVALID_ARGUMENT"));
  await publish([
    { ...entry(), title: "Nicht verfügbar", symbol: "unavailable", color: "#737373" },
  ]);
});
test("invitation token is random, hashed, 7-day and one-use, retry has no raw token", async () => {
  await create();
  const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]);
  assert.match(invite.token, /^[a-f0-9]{64}$/);
  const rows = await db.query(
    "select token_hash, extract(epoch from expires_at-created_at)::int as lifetime from luna_sharing.invites",
  );
  assert.notEqual(rows.rows[0].token_hash, invite.token);
  assert.equal(rows.rows[0].token_hash.length, 64);
  assert.equal(rows.rows[0].lifetime, 604800);
  const retry = await rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]);
  assert.equal(retry.inviteId, invite.inviteId);
  assert.equal(retry.token, null);
  const claimed = await rpc(VIEWER, "sharing_claim_invite", [invite.token, "Leserin"]);
  assert.equal(claimed.status, "PENDING");
  assert.deepEqual(await rpc(VIEWER, "sharing_claim_invite", [invite.token, "Leserin"]), claimed);
  await assert.rejects(
    rpc(OTHER, "sharing_claim_invite", [invite.token, "Andere"]),
    failure("SHARE_INVITE_INVALID"),
  );
});
test("pending invitation grants no list/fetch access; only owner can approve", async () => {
  await invited();
  assert.deepEqual(await rpc(VIEWER, "sharing_list_calendars"), []);
  await assert.rejects(
    rpc(VIEWER, "sharing_fetch_calendar", [CALENDAR, null]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await assert.rejects(
    rpc(VIEWER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  const calendars = await rpc(VIEWER, "sharing_list_calendars");
  assert.equal(calendars.length, 1);
  assert.equal(calendars[0].isOwner, false);
  assert.equal("deviceId" in calendars[0], false);
  const snapshot = await rpc(VIEWER, "sharing_fetch_calendar", [CALENDAR, null]);
  assert.equal(snapshot.entries.length, 1);
  assert.deepEqual(Object.keys(snapshot.entries[0]).sort(), Object.keys(entry()).sort());
});
test("active viewer cannot publish/create invitations/manage others/delete calendar", async () => {
  await invited();
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  for (const [name, args] of [
    ["sharing_publish_calendar", [CALENDAR, DEVICE, DEVICE_SECRET, OTHER, 1, "[]"]],
    ["sharing_create_invite", [CALENDAR, OTHER]],
    ["sharing_list_members", [CALENDAR]],
    ["sharing_delete_calendar", [CALENDAR]],
  ])
    await assert.rejects(rpc(VIEWER, name, args), failure("SHARE_NOT_FOUND", "42501"));
});
test("revocation and leaving immediately remove future reads and calendar summaries", async () => {
  await invited();
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "REVOKE"]);
  await assert.rejects(
    rpc(VIEWER, "sharing_fetch_calendar", [CALENDAR, 1]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  assert.deepEqual(await rpc(VIEWER, "sharing_list_calendars"), []);
  const next = await rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER]);
  await rpc(VIEWER, "sharing_claim_invite", [next.token, "Leserin"]);
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  assert.deepEqual(await rpc(VIEWER, "sharing_leave_calendar", [CALENDAR]), { left: true });
  await assert.rejects(
    rpc(VIEWER, "sharing_fetch_calendar", [CALENDAR, null]),
    failure("SHARE_NOT_FOUND", "42501"),
  );
  await assert.rejects(
    rpc(OWNER, "sharing_leave_calendar", [CALENDAR]),
    failure("SHARE_OWNER_CANNOT_LEAVE"),
  );
});
test("invalid/expired/revoked invites uniformly reject and never return calendar data", async () => {
  await create();
  await assert.rejects(
    rpc(VIEWER, "sharing_claim_invite", ["a".repeat(64), "Leserin"]),
    failure("SHARE_INVITE_INVALID"),
  );
  const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]);
  await db.exec("update luna_sharing.invites set expires_at = now() - interval '1 second'");
  await assert.rejects(
    rpc(VIEWER, "sharing_claim_invite", [invite.token, "Leserin"]),
    failure("SHARE_INVITE_INVALID"),
  );
  const next = await rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER]);
  await rpc(OWNER, "sharing_revoke_invite", [CALENDAR, next.inviteId]);
  await assert.rejects(
    rpc(VIEWER, "sharing_claim_invite", [next.token, "Leserin"]),
    failure("SHARE_INVITE_INVALID"),
  );
});
test("calendar deletion cascades entries/invites/members/receipts and blocks readers", async () => {
  await invited();
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  await rpc(OWNER, "sharing_delete_calendar", [CALENDAR]);
  assert.deepEqual(await rpc(VIEWER, "sharing_list_calendars"), []);
  for (const table of ["entries", "members", "invites", "mutations"]) {
    const result = await db.query(`select count(*)::int as count from luna_sharing.${table}`);
    assert.equal(result.rows[0].count, 0);
  }
});
test("account deletion affects only caller, cascades cloud data and rejects still-unexpired JWT", async () => {
  await invited();
  await rpc(OWNER, "sharing_save_profile", ["Eigentümer"]);
  assert.deepEqual(await rpc(OWNER, "sharing_delete_account"), { deleted: true });
  assert.deepEqual(
    (await db.query("select id from auth.users order by id")).rows.map((row) => row.id),
    [VIEWER, OTHER],
  );
  await assert.rejects(
    rpc(OWNER, "sharing_list_calendars"),
    failure("SHARE_UNAUTHENTICATED", "42501"),
  );
  assert.deepEqual(await rpc(VIEWER, "sharing_list_calendars"), []);
});

test("calendar/invite quotas and payload bounds prevent unbounded resources", async () => {
  await create();
  await assert.rejects(
    publish(Array.from({ length: 10001 }, () => entry())),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  await assert.rejects(
    publish([{ ...entry(), title: "x".repeat(8388609) }]),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  await db.query(
    "insert into luna_sharing.calendars(id,owner_id,device_id,device_secret_hash,name,color,visibility) select gen_random_uuid(),$1,$2,repeat('b',64),'Plan','#D19A22','DETAILS' from generate_series(1,19)",
    [OWNER, DEVICE],
  );
  await assert.rejects(
    rpc(OWNER, "sharing_create_calendar", [
      OTHER,
      DEVICE,
      DEVICE_SECRET,
      "Weitere",
      "#D19A22",
      "DETAILS",
    ]),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  await db.query(
    "insert into luna_sharing.invites(calendar_id,token_hash) select $1,encode(extensions.digest(x::text,'sha256'),'hex') from generate_series(1,20) x",
    [CALENDAR],
  );
  await assert.rejects(
    rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]),
    failure("SHARE_INVALID_ARGUMENT"),
  );
});
test("invalid member transitions, malicious display names and own invite fail closed", async () => {
  const invite = await invited();
  await assert.rejects(
    rpc(OWNER, "sharing_claim_invite", [invite.token, "Owner"]),
    failure("SHARE_INVITE_INVALID"),
  );
  await assert.rejects(
    rpc(OTHER, "sharing_claim_invite", ["a".repeat(64), "Bad\nName"]),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  await assert.rejects(
    rpc(OWNER, "sharing_save_profile", ["Bad\nName"]),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  await assert.rejects(
    rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "ADMIN"]),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "REJECT"]);
  await assert.rejects(
    rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]),
    failure("SHARE_MEMBER_INVALID"),
  );
  await assert.rejects(
    rpc(VIEWER, "sharing_claim_invite", [invite.token, "Leserin"]),
    failure("SHARE_INVITE_INVALID"),
  );
});
test("over-midnight and DST entries keep UTC instants and explicit timezone without local-clock revision logic", async () => {
  await create();
  await publish([
    { ...entry(), startsAt: "2026-10-25T02:30:00+02:00", endsAt: "2026-10-25T02:30:00+01:00" },
  ]);
  const snapshot = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  const item = snapshot.entries[0];
  assert.equal(Date.parse(item.endsAt) - Date.parse(item.startsAt), 3600000);
  assert.equal(item.timeZone, "Europe/Berlin");
  assert.equal(snapshot.revision, 1);
});
test("snapshot rejects malformed root JSON, missing/null presentation fields and non-UUID identity", async () => {
  await create();
  for (const root of [null, {}, "private"])
    await assert.rejects(
      rpc(OWNER, "sharing_publish_calendar", [
        CALENDAR,
        DEVICE,
        DEVICE_SECRET,
        MUTATION,
        0,
        JSON.stringify(root),
      ]),
      failure("SHARE_INVALID_ARGUMENT"),
    );
  for (const field of Object.keys(entry())) {
    const omitted = { ...entry() };
    delete omitted[field];
    await assert.rejects(publish([omitted]), failure("SHARE_INVALID_ARGUMENT"));
    await assert.rejects(
      publish([{ ...entry(), [field]: null }]),
      failure("SHARE_INVALID_ARGUMENT"),
    );
  }
});

test("revoked, missing, malformed and foreign signed sessions fail closed", async () => {
  for (const session of [
    null,
    "bad-session",
    SESSIONS[VIEWER],
    "00000000-0000-4000-8000-000000000099",
  ])
    await assert.rejects(
      rpc(OWNER, "sharing_list_calendars", [], "authenticated", session),
      failure("SHARE_UNAUTHENTICATED", "42501"),
    );
  await db.query("delete from auth.sessions where id=$1", [SESSIONS[OWNER]]);
  await assert.rejects(
    rpc(OWNER, "sharing_list_calendars"),
    failure("SHARE_UNAUTHENTICATED", "42501"),
  );
});
test("banned, soft-deleted users and expired sessions fail closed", async () => {
  await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [OWNER]);
  await assert.rejects(
    rpc(OWNER, "sharing_list_calendars"),
    failure("SHARE_UNAUTHENTICATED", "42501"),
  );
  await db.query("update auth.users set banned_until=null,deleted_at=now() where id=$1", [OWNER]);
  await assert.rejects(
    rpc(OWNER, "sharing_list_calendars"),
    failure("SHARE_UNAUTHENTICATED", "42501"),
  );
  await db.query("update auth.users set deleted_at=null where id=$1", [OWNER]);
  await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [
    SESSIONS[OWNER],
  ]);
  await assert.rejects(
    rpc(OWNER, "sharing_list_calendars"),
    failure("SHARE_UNAUTHENTICATED", "42501"),
  );
});
test("generic deletion rejects any linked Apple identity without deleting cloud data", async () => {
  await create();
  await db.query(
    "insert into auth.identities(user_id,provider) values ($1,'google'),($1,'apple')",
    [OWNER],
  );
  await assert.rejects(
    rpc(OWNER, "sharing_delete_account"),
    failure("SHARE_PROVIDER_REVOKE_REQUIRED", "42501"),
  );
  assert.equal((await rpc(OWNER, "sharing_list_calendars")).length, 1);
  assert.equal(
    (await db.query("select count(*)::int as count from auth.users where id=$1", [OWNER])).rows[0]
      .count,
    1,
  );
});

test("device secret is hashed, never returned and required even with a copied owner device ID", async () => {
  const first = await create();
  assert.equal(JSON.stringify(first).includes(DEVICE_SECRET), false);
  assert.equal("deviceSecret" in first, false);
  assert.equal("deviceSecretHash" in first, false);
  const stored = (
    await db.query("select device_secret_hash from luna_sharing.calendars where id=$1", [CALENDAR])
  ).rows[0].device_secret_hash;
  assert.match(stored, /^[a-f0-9]{64}$/);
  assert.notEqual(stored, DEVICE_SECRET);
  const copiedDevice = (await rpc(OWNER, "sharing_list_calendars"))[0].deviceId;
  for (const secret of [null, "invalid", "b".repeat(64)])
    await assert.rejects(
      publish([], 0, MUTATION, copiedDevice, OWNER, secret),
      failure("SHARE_DEVICE_MISMATCH", "42501"),
    );
  await assert.rejects(
    rpc(OWNER, "sharing_create_calendar", [
      CALENDAR,
      DEVICE,
      "b".repeat(64),
      "Mein Dienstplan",
      "#D19A22",
      "DETAILS",
    ]),
    failure("SHARE_MUTATION_REUSED"),
  );
  for (const secret of [null, "invalid", "A".repeat(64)])
    await assert.rejects(
      rpc(OWNER, "sharing_create_calendar", [OTHER, DEVICE, secret, "Plan", "#D19A22", "DETAILS"]),
      failure("SHARE_INVALID_ARGUMENT"),
    );
  assert.equal((await publish()).revision, 1);
});
test("new invite mutations are capped at ten per owner/hour even after revocation", async () => {
  await create();
  for (let i = 1; i <= 10; i++) {
    const mutation = `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, mutation]);
    await rpc(OWNER, "sharing_revoke_invite", [CALENDAR, invite.inviteId]);
    assert.equal(
      (await rpc(OWNER, "sharing_create_invite", [CALENDAR, mutation])).inviteId,
      invite.inviteId,
    );
  }
  await assert.rejects(
    rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER]),
    failure("SHARE_RATE_LIMIT"),
  );
  await db.exec("update luna_sharing.mutations set created_at=now()-interval '61 minutes'");
  assert.ok((await rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER])).token);
});
test("new publishes are capped at 120 per calendar/hour while receipt retries remain valid", async () => {
  await create();
  for (let i = 0; i < 120; i++) {
    const mutation = `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    assert.equal((await publish([], i, mutation)).revision, i + 1);
    if (i === 119) assert.equal((await publish([], i, mutation)).revision, 120);
  }
  await assert.rejects(publish([], 120, OTHER), failure("SHARE_RATE_LIMIT"));
  await db.exec("update luna_sharing.mutations set created_at=now()-interval '61 minutes'");
  assert.equal((await publish([], 120, OTHER)).revision, 121);
});
test("90-day retention removes old expired/revoked history while retaining live invite receipts", async () => {
  await create();
  await publish();
  const oldInvite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]);
  await rpc(OWNER, "sharing_revoke_invite", [CALENDAR, oldInvite.inviteId]);
  await db.exec(
    "update luna_sharing.mutations set created_at=now()-interval '91 days'; update luna_sharing.invites set created_at=now()-interval '91 days',expires_at=now()-interval '90 days'",
  );
  const live = await rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER]);
  await db.query(
    "update luna_sharing.invites set created_at=now()-interval '91 days' where id=$1",
    [live.inviteId],
  );
  await db.query(
    "update luna_sharing.mutations set created_at=now()-interval '91 days' where mutation_id=$1",
    [OTHER],
  );
  await publish([], 1, "30000000-0000-4000-8000-000000000001");
  assert.equal(
    (
      await db.query("select count(*)::int as count from luna_sharing.invites where id=$1", [
        oldInvite.inviteId,
      ])
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from luna_sharing.mutations where mutation_id=$1",
        [MUTATION],
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (await rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER])).inviteId,
    live.inviteId,
  );
  assert.equal(
    (await rpc(VIEWER, "sharing_claim_invite", [live.token, "Leserin"])).status,
    "PENDING",
  );
  await assert.rejects(publish([entry()], 0, MUTATION), failure("SHARE_REVISION_CONFLICT"));
});

test("invite rate is owner-wide across calendars and private retention cannot be invoked by a client", async () => {
  await create();
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await rpc(OWNER, "sharing_create_calendar", [
    second,
    DEVICE,
    DEVICE_SECRET,
    "Zweiter Plan",
    "#D19A22",
    "DETAILS",
  ]);
  for (let i = 1; i <= 10; i++)
    await rpc(OWNER, "sharing_create_invite", [
      CALENDAR,
      `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ]);
  await assert.rejects(
    rpc(OWNER, "sharing_create_invite", [second, OTHER]),
    failure("SHARE_RATE_LIMIT"),
  );
  const permissions = (
    await db.query(
      "select has_function_privilege('authenticated','luna_sharing.prune_history(uuid)','EXECUTE') as allowed",
    )
  ).rows[0];
  assert.equal(permissions.allowed, false);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      db.query("select luna_sharing.prune_history(null)"),
      (error) => error.code === "42501",
    );
  } finally {
    await db.exec("reset role");
  }
});

// Captured account assertions stop requests whose SDK selects a newer account JWT.
async function assertedRpc(actor, expected, name, args = []) {
  return rpc(actor, name, args, "authenticated", SESSIONS[actor], expected);
}
test("profile mutation rejects a switched or absent confirmed actor without writing", async () => {
  for (const expected of [OWNER, null])
    await assert.rejects(
      assertedRpc(OTHER, expected, "sharing_save_profile", ["Alex"]),
      failure("SHARE_ACCOUNT_MISMATCH", "42501"),
    );
  assert.equal(
    (await db.query("select count(*)::int as count from luna_sharing.profiles")).rows[0].count,
    0,
  );
});
test("calendar creation rejects a switched or absent confirmed actor without creating a new owner object", async () => {
  for (const expected of [OWNER, null])
    await assert.rejects(
      assertedRpc(OTHER, expected, "sharing_create_calendar", [
        CALENDAR,
        DEVICE,
        DEVICE_SECRET,
        "Alex Plan",
        "#D19A22",
        "DETAILS",
      ]),
      failure("SHARE_ACCOUNT_MISMATCH", "42501"),
    );
  assert.equal(
    (await db.query("select count(*)::int as count from luna_sharing.calendars")).rows[0].count,
    0,
  );
});
test("invite claim rejects a switched or absent confirmed actor without consuming the one-use token", async () => {
  await create();
  const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, MUTATION]);
  for (const expected of [VIEWER, null])
    await assert.rejects(
      assertedRpc(OTHER, expected, "sharing_claim_invite", [invite.token, "Alex"]),
      failure("SHARE_ACCOUNT_MISMATCH", "42501"),
    );
  assert.equal(
    (await db.query("select consumed_by from luna_sharing.invites")).rows[0].consumed_by,
    null,
  );
  assert.equal(
    (await db.query("select count(*)::int as count from luna_sharing.members")).rows[0].count,
    0,
  );
  assert.equal(
    (await rpc(VIEWER, "sharing_claim_invite", [invite.token, "Alex"])).status,
    "PENDING",
  );
});
test("leaving rejects another confirmed reader even when both accounts read the same calendar", async () => {
  await invited();
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  const invite = await rpc(OWNER, "sharing_create_invite", [CALENDAR, OTHER]);
  await rpc(OTHER, "sharing_claim_invite", [invite.token, "Sam"]);
  await rpc(OWNER, "sharing_set_member", [CALENDAR, OTHER, "APPROVE"]);
  for (const expected of [VIEWER, null])
    await assert.rejects(
      assertedRpc(OTHER, expected, "sharing_leave_calendar", [CALENDAR]),
      failure("SHARE_ACCOUNT_MISMATCH", "42501"),
    );
  assert.deepEqual(
    (await db.query("select status from luna_sharing.members order by user_id")).rows.map(
      (row) => row.status,
    ),
    ["ACTIVE", "ACTIVE"],
  );
});
test("generic self-deletion rejects a switched or absent confirmed actor and preserves both accounts", async () => {
  for (const expected of [OWNER, null])
    await assert.rejects(
      assertedRpc(OTHER, expected, "sharing_delete_account"),
      failure("SHARE_ACCOUNT_MISMATCH", "42501"),
    );
  assert.equal((await db.query("select count(*)::int as count from auth.users")).rows[0].count, 3);
});

test("snapshot rejects timed intervals exceeding forty-eight elapsed hours atomically", async () => {
  await create();
  await publish();
  const original = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  await assert.rejects(
    publish(
      [
        {
          ...entry(),
          allDay: false,
          startsAt: "2026-10-02T00:00:00Z",
          endsAt: "2026-10-04T00:00:01Z",
        },
      ],
      1,
      OTHER,
    ),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  const snapshot = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.entries, original.entries);
});
test("snapshot rejects all-day intervals exceeding forty-eight elapsed hours atomically", async () => {
  await create();
  await publish();
  const original = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  await assert.rejects(
    publish(
      [
        {
          ...entry(),
          allDay: true,
          startsAt: "2026-10-02T00:00:00Z",
          endsAt: "2026-10-04T00:00:01Z",
        },
      ],
      1,
      OTHER,
    ),
    failure("SHARE_INVALID_ARGUMENT"),
  );
  const snapshot = await rpc(OWNER, "sharing_fetch_calendar", [CALENDAR, null]);
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.entries, original.entries);
});
test("snapshot accepts the exact forty-eight-hour interval boundary", async () => {
  await create();
  assert.equal(
    (
      await publish([
        { ...entry(), startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-04T00:00:00Z" },
      ])
    ).revision,
    1,
  );
});

test("realtime invalidates only owners and active readers without calendar payloads", async () => {
  await invited();
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "APPROVE"]);
  await db.exec("reset role; truncate realtime.messages");
  await publish([], 1, "88888888-8888-4888-8888-888888888888");
  await db.exec("reset role");
  const messages = (await db.query("select * from realtime.messages")).rows;
  assert.deepEqual(
    new Set(messages.map((m) => m.topic)),
    new Set(["sharing:" + OWNER, "sharing:" + VIEWER]),
  );
  assert.ok(messages.every((m) => m.private && JSON.stringify(m.payload) === "{}"));
  await rpc(OWNER, "sharing_set_member", [CALENDAR, VIEWER, "REVOKE"]);
  await db.exec("reset role; truncate realtime.messages");
  await publish([], 2, "99999999-9999-4999-8999-999999999999");
  await db.exec("reset role");
  assert.deepEqual(
    (await db.query("select topic from realtime.messages")).rows.map((m) => m.topic),
    ["sharing:" + OWNER],
  );
});

test("realtime receive policy rejects another user's topic and offers no client send grant", async () => {
  await invited();
  await db.exec("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false), set_config('realtime.topic', $2, false)",
    [VIEWER, "sharing:" + OWNER],
  );
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from realtime.messages")).rows.length, 0);
  await db.query("select set_config('realtime.topic', $1, false)", ["sharing:" + VIEWER]);
  const ownMessages = (await db.query("select * from realtime.messages")).rows;
  assert.ok(ownMessages.length > 0);
  assert.ok(ownMessages.every((m) => m.topic === "sharing:" + VIEWER));
  await assert.rejects(
    db.query("insert into realtime.messages values ('fake','broadcast','{}',true)"),
    (e) => e.code === "42501",
  );
});
