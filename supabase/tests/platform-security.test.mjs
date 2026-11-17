import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrations = (await readdir("supabase/migrations")).filter((file) =>
  file.endsWith("_harden_rls_auto_enable_execute.sql"),
);
assert.equal(migrations.length, 1);
const migration = await readFile(`supabase/migrations/${migrations[0]}`, "utf8");

async function database() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role");
  return db;
}

test("internal event hook loses client EXECUTE while automatic RLS still protects new tables", async () => {
  const db = await database();
  try {
    // Same event-trigger contract as the Supabase-managed hook inspected live.
    await db.exec(`
      create function public.rls_auto_enable() returns event_trigger
        language plpgsql security definer set search_path=pg_catalog as $$
      declare cmd record;
      begin
        for cmd in select * from pg_event_trigger_ddl_commands()
          where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
            and object_type in ('table','partitioned table')
        loop
          if cmd.schema_name='public' then
            execute format('alter table %s enable row level security',cmd.object_identity);
          end if;
        end loop;
      end;
      $$;
      create event trigger ensure_rls on ddl_command_end
        execute function public.rls_auto_enable();
    `);
    const before = await db.query(`
      select pg_get_functiondef(p.oid) as definition, p.proowner as owner,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon
      from pg_proc p where p.oid='public.rls_auto_enable()'::regprocedure
    `);
    assert.equal(before.rows[0].anon, true);
    await db.exec(migration);
    await db.exec(migration);
    const after = await db.query(`
      select pg_get_functiondef(p.oid) as definition, p.proowner as owner,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
        has_function_privilege(p.proowner,p.oid,'EXECUTE') as owner_execute,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))
          where grantee=0 and privilege_type='EXECUTE') as public_execute,
        (select evtenabled from pg_event_trigger where evtname='ensure_rls') as enabled
      from pg_proc p where p.oid='public.rls_auto_enable()'::regprocedure
    `);
    const row = after.rows[0];
    assert.equal(row.definition, before.rows[0].definition);
    assert.equal(row.owner, before.rows[0].owner);
    assert.equal(row.owner_execute, true);
    assert.equal(row.public_execute, false);
    assert.equal(row.anon, false);
    assert.equal(row.authenticated, false);
    assert.equal(row.enabled, "O");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(
          db.query("select public.rls_auto_enable()"),
          (error) => error.code === "42501",
        );
      } finally {
        await db.exec("reset role");
      }
    }
    await db.exec("create table public.rls_probe(id integer)");
    assert.equal(
      (await db.query("select relrowsecurity from pg_class where oid='public.rls_probe'::regclass"))
        .rows[0].relrowsecurity,
      true,
    );
  } finally {
    await db.close();
  }
});

test("migration accepts a fresh local database and rejects an unrelated namesake", async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(
      "create function public.rls_auto_enable() returns void language sql as $$ select $$",
    );
    await assert.rejects(db.exec(migration), /RLS_AUTO_ENABLE_UNEXPECTED_FUNCTION/);
  } finally {
    await db.close();
  }
});
