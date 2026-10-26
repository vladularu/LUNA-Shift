import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let db;
const document = {
  format: "lunashift-private-cloud",
  version: 1,
  data: { note: "privat" },
  presentation: {},
};
const write = (revision = 0, id = crypto.randomUUID(), value = document) => [
  revision,
  id,
  JSON.stringify(value),
];
async function rpc(name, args = [], actor = OWNER, expectedActor = actor, session = SESSION) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, session_id: session }),
  ]);
  try {
    const values = [expectedActor, ...args];
    const result = await db.query(
      `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as value`,
      values,
    );
    return result.rows[0].value;
  } finally {
    await db.exec("reset role");
  }
}
before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz,email_confirmed_at timestamptz default now());
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,provider text);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.jwt(),auth.uid() to anon,authenticated;
  `);
  await db.exec(await readFile("supabase/migrations/202610120001_calendar_sharing.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261017211850_private_cloud.sql", "utf8"));
});
beforeEach(async () => {
  await db.exec("truncate auth.users cascade");
  await db.query("insert into auth.users(id) values($1),($2)", [OWNER, OTHER]);
  await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [SESSION, OWNER]);
});
after(async () => {
  if (db) await db.close();
});

test("personal snapshots are private and versioned", async () => {
  assert.equal(await rpc("private_cloud_read"), null);
  assert.equal((await rpc("private_cloud_write", write())).revision, 1);
  assert.deepEqual((await rpc("private_cloud_read")).document, document);
  assert.equal((await rpc("private_cloud_head")).revision, 1);
  assert.equal((await rpc("private_cloud_head")).document, undefined);
  assert.equal((await rpc("private_cloud_history")).length, 1);
  await assert.rejects(rpc("private_cloud_read", [], OWNER, OTHER), /CLOUD_ACCOUNT_CHANGED/);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select * from luna_private_cloud.snapshots"), /permission denied/);
  await db.exec("reset role");
});
test("backup v21 target settings roundtrip in the unchanged v1 document envelope", async () => {
  const value = {
    ...document,
    backupVersion: 21,
    databaseSchemaVersion: 34,
    data: {
      ...document.data,
      workingTimeTargetSettings: [
        {
          id: "singleton",
          settings_json: JSON.stringify({
            version: 1,
            context: { periods: [], days: [] },
            planBindings: [],
          }),
          revision: 1,
          created_at: "2026-10-23T12:00:00Z",
          updated_at: "2026-10-23T12:00:00Z",
        },
      ],
    },
  };
  assert.equal(
    (await rpc("private_cloud_write", write(0, crypto.randomUUID(), value))).revision,
    1,
  );
  assert.deepEqual((await rpc("private_cloud_read")).document, value);
});

test("retries are idempotent even after another revision", async () => {
  const first = write();
  const receipt = await rpc("private_cloud_write", first);
  await rpc("private_cloud_write", write(1));
  assert.deepEqual(await rpc("private_cloud_write", first), receipt);
  assert.equal((await rpc("private_cloud_history")).length, 2);
  await assert.rejects(
    rpc("private_cloud_write", write(0, first[1], { ...document, data: {} })),
    /CLOUD_MUTATION_REUSED/,
  );
});
test("stale writers cannot overwrite newer cloud data", async () => {
  await rpc("private_cloud_write", write());
  await assert.rejects(rpc("private_cloud_write", write()), /CLOUD_REVISION_CONFLICT/);
  assert.equal((await rpc("private_cloud_read")).revision, 1);
});
test("another authenticated account has an independent empty cloud", async () => {
  await rpc("private_cloud_write", write());
  const otherSession = crypto.randomUUID();
  await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [otherSession, OTHER]);
  assert.equal(await rpc("private_cloud_read", [], OTHER, OTHER, otherSession), null);
  assert.deepEqual(await rpc("private_cloud_history", [], OTHER, OTHER, otherSession), []);
});
test("deleted and revoked sessions cannot use old JWT claims", async () => {
  await rpc("private_cloud_write", write());
  await db.query("delete from auth.sessions where id=$1", [SESSION]);
  await assert.rejects(rpc("private_cloud_read"), /SHARE_UNAUTHENTICATED/);
});
test("an unconfirmed email identity cannot access personal cloud data", async () => {
  await db.query("insert into auth.identities(user_id,provider) values($1,'email')", [OWNER]);
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [OWNER]);
  await assert.rejects(rpc("private_cloud_read"), /CLOUD_EMAIL_UNCONFIRMED/);
  await assert.rejects(rpc("private_cloud_write", write()), /CLOUD_EMAIL_UNCONFIRMED/);
});
test("account deletion cascades through all private copies", async () => {
  await rpc("private_cloud_write", write());
  await db.query("delete from auth.users where id=$1", [OWNER]);
  assert.equal(
    (await db.query("select count(*)::int as n from luna_private_cloud.snapshots")).rows[0].n,
    0,
  );
});
test("anonymous access and malformed payloads are denied", async () => {
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select public.private_cloud_read($1)", [OWNER]),
    /permission denied/,
  );
  await db.exec("reset role");
  await assert.rejects(rpc("private_cloud_write", write(-1)), /CLOUD_INVALID_DOCUMENT/);
  await assert.rejects(
    rpc("private_cloud_write", write(0, crypto.randomUUID(), { ...document, version: 2 })),
    /CLOUD_INVALID_DOCUMENT/,
  );
});

test("retention keeps the current state and at most one older copy per Berlin day for 30 calendar days", async () => {
  await db.query("insert into luna_private_cloud.accounts(user_id,revision) values($1,100)", [
    OWNER,
  ]);
  await db.query(
    `insert into luna_private_cloud.snapshots(user_id,revision,mutation_id,expected_revision,document,updated_at)
    select $1,day*2+copy+1,gen_random_uuid(),0,$2::jsonb,
      (((now() at time zone 'Europe/Berlin')::date-day)::timestamp at time zone 'Europe/Berlin')+copy*interval '1 hour'
    from generate_series(0,35) day cross join generate_series(0,1) copy`,
    [OWNER, JSON.stringify(document)],
  );
  await db.query(
    "insert into luna_private_cloud.snapshots(user_id,revision,mutation_id,expected_revision,document,updated_at) values($1,100,gen_random_uuid(),0,$2::jsonb,now()-interval '90 days')",
    [OWNER, JSON.stringify(document)],
  );
  await db.exec("select public.private_cloud_retention()");
  const kept = await db.query(
    "select revision from luna_private_cloud.snapshots where user_id=$1",
    [OWNER],
  );
  assert.equal(kept.rows.length, 31);
  assert.ok(kept.rows.some((row) => row.revision === 100));
  const duplicates = await db.query(
    "select count(*)::int as n from (select (updated_at at time zone 'Europe/Berlin')::date from luna_private_cloud.snapshots where revision<>100 group by 1 having count(*)>1) d",
  );
  assert.equal(duplicates.rows[0].n, 0);
});

test("pruning old daily copies does not break retries of an earlier acknowledged mutation", async () => {
  const first = write();
  const receipt = await rpc("private_cloud_write", first);
  await rpc("private_cloud_write", write(1));
  await rpc("private_cloud_write", write(2));
  assert.equal(
    (await db.query("select count(*)::int as n from luna_private_cloud.snapshots where revision=1"))
      .rows[0].n,
    0,
  );
  assert.deepEqual(await rpc("private_cloud_write", first), receipt);
  assert.equal((await rpc("private_cloud_read")).revision, 3);
});
