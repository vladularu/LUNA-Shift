-- ONLY for ajccsftbgsvfmuwirjux (dedicated Production rule-catalog project).
-- Do not put this in shared migrations or apply it to the Sharing project.
-- Official workaround; the dashboard Data API and catalog delivery stay disabled:
-- https://supabase.com/kb/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist
begin;
do $guard$
begin
  if to_regnamespace('luna_sharing') is not null
     or exists (
       select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind in ('r','p','v','m','f')
     ) then
    raise exception 'DISABLED_API_REQUIRES_DEDICATED_CATALOG_PROJECT';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='pgrst_no_exposed_schemas'
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='pgrst_no_exposed_schemas'
  ) then
    raise exception 'DISABLED_API_SCHEMA_MUST_BE_EMPTY';
  end if;
end;
$guard$;
create schema if not exists pgrst_no_exposed_schemas;
revoke all on schema pgrst_no_exposed_schemas from public, anon, authenticated, service_role;
alter role authenticator set pgrst.db_schemas = 'pgrst_no_exposed_schemas';
notify pgrst;
commit;
