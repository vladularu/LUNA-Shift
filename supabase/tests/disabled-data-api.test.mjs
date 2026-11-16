import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const forward = await readFile(
  "supabase/operations/rule-catalog-production-disabled-api.sql",
  "utf8",
);
const rollback = await readFile(
  "supabase/operations/rule-catalog-production-disabled-api-rollback.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create role authenticator;
    alter role authenticator set lock_timeout = '8s';
  `);
  return db;
}

test("disabled Data API exposes an empty inaccessible schema and preserves unrelated role settings", async () => {
  const db = await database();
  try {
    await db.exec(forward);
    await db.exec(forward);
    const result = await db.query(`
      select
        has_schema_privilege('anon','pgrst_no_exposed_schemas','USAGE') as anon_usage,
        has_schema_privilege('authenticated','pgrst_no_exposed_schemas','CREATE') as auth_create,
        has_schema_privilege('service_role','pgrst_no_exposed_schemas','USAGE') as service_usage,
        (select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='pgrst_no_exposed_schemas') as objects,
        s.setconfig as settings
      from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
      where r.rolname='authenticator'
    `);
    const row = result.rows[0];
    assert.equal(row.anon_usage, false);
    assert.equal(row.auth_create, false);
    assert.equal(row.service_usage, false);
    assert.equal(row.objects, 0);
    assert.ok(row.settings.includes("pgrst.db_schemas=pgrst_no_exposed_schemas"));
    assert.ok(row.settings.includes("lock_timeout=8s"));
    await db.exec(rollback);
    const reset = await db.query(`
      select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
      where r.rolname='authenticator'
    `);
    assert.deepEqual(reset.rows[0].setconfig, ["lock_timeout=8s"]);
  } finally {
    await db.close();
  }
});

test("disabled Data API workaround refuses Sharing or a nonempty exposed schema atomically", async () => {
  for (const fixture of [
    "create schema luna_sharing",
    "create table public.app_data(id integer)",
    "create schema pgrst_no_exposed_schemas; create table pgrst_no_exposed_schemas.app_data(id integer)",
  ]) {
    const db = await database();
    try {
      await db.exec(fixture);
      await assert.rejects(db.exec(forward), /DISABLED_API_/);
      await db.exec("rollback");
      const result = await db.query(`
        select s.setconfig from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
        where r.rolname='authenticator'
      `);
      assert.deepEqual(result.rows[0].setconfig, ["lock_timeout=8s"]);
    } finally {
      await db.close();
    }
  }
});
