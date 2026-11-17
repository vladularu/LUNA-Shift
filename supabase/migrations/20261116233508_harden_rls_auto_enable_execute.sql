-- This Supabase platform hook runs from the ensure_rls event trigger, never
-- from an app RPC. Keep its implementation and trigger registration intact.
-- Plain local databases may not contain the platform-managed hook.
do $migration$
declare hook oid := to_regprocedure('public.rls_auto_enable()');
begin
  if hook is null then
    return;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid=hook and prorettype='pg_catalog.event_trigger'::regtype and prosecdef
  ) then
    raise exception 'RLS_AUTO_ENABLE_UNEXPECTED_FUNCTION';
  end if;
  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
end;
$migration$;
