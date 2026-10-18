-- Read-only deployment checks. Run in the personal-data project after activation.
select jsonb_build_object(
  'private_tables', (
    select count(*) from pg_tables
    where schemaname='luna_private_cloud' and rowsecurity
      and tablename in ('accounts','snapshots','mutations')
  ),
  'anonymous_rpc_access', (
    select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'private_cloud_%'
  ),
  'authenticated_retention_access',
    has_function_privilege('authenticated','public.private_cloud_retention()','EXECUTE'),
  'authenticated_private_schema_access',
    has_schema_privilege('authenticated','luna_private_cloud','USAGE'),
  'anonymous_private_schema_access',
    has_schema_privilege('anon','luna_private_cloud','USAGE'),
  'daily_retention_active', (
    select coalesce(bool_or(active and schedule='17 2 * * *'),false)
    from cron.job where jobname='luna-private-cloud-retention'
  )
) as private_cloud_checks;
-- Expected: private_tables=3, daily_retention_active=true, all access flags=false.
