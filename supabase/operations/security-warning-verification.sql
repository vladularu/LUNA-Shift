-- Read-only post-change verification for Sharing and both catalog projects.
select p.oid::regprocedure::text as signature, p.prosecdef,
  p.proconfig, pg_get_userbyid(p.proowner) as owner,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))
    where grantee=0 and privilege_type='EXECUTE') as public_execute,
  md5(pg_get_functiondef(p.oid)) as definition_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','luna_sharing','luna_private_cloud') and p.prosecdef
order by signature;

select evtname, evtenabled, evtfoid::regprocedure::text as function
from pg_event_trigger where evtname='ensure_rls';

select n.nspname, c.relname, c.relrowsecurity,
  has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('luna_sharing','luna_private_cloud') and c.relkind='r'
order by n.nspname,c.relname;
