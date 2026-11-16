-- Run only in the authorized Sharing project after the migration.
-- Synthetic fixtures, RPC calls and notifications are rolled back together.
begin;
set local statement_timeout = '8s';
do $fixture$
declare actor uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at)
    values(session_id,actor,now(),now());
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',actor,'role','authenticated','session_id',session_id)::text,true);
end;
$fixture$;
set local role authenticated;
do $verify$
declare actor uuid:=auth.uid(); calendar_id uuid:=gen_random_uuid(); device_id uuid:=gen_random_uuid();
  mutation_id uuid:=gen_random_uuid(); entries jsonb; published jsonb; snapshot jsonb;
  started timestamptz; elapsed_ms numeric; invalid_rejected boolean:=false;
begin
  perform public.sharing_create_calendar(actor,calendar_id,device_id,repeat('a',64),
    'Rollback-only publication verification','#D19A22','DETAILS');
  select jsonb_agg(jsonb_build_object(
    'id',gen_random_uuid(),'startsAt','2026-11-16T06:00:00Z','endsAt','2026-11-16T14:00:00Z',
    'timeZone',case when i%2=0 then 'Europe/Berlin' else 'UTC' end,
    'allDay',false,'title','Verification shift','color','#D19A22','symbol','sun',
    'kind','SHIFT','note','Synthetic verification','breakMinutes',45) order by i)
    into entries from generate_series(1,1000) i;
  started:=clock_timestamp();
  published:=public.sharing_publish_calendar_v3(
    calendar_id,device_id,repeat('a',64),mutation_id,0,entries);
  elapsed_ms:=extract(epoch from clock_timestamp()-started)*1000;
  if elapsed_ms>=8000 then raise exception 'PUBLICATION_EXCEEDED_SERVER_BUDGET'; end if;
  if public.sharing_publish_calendar_v3(
    calendar_id,device_id,repeat('a',64),mutation_id,0,entries) is distinct from published then
    raise exception 'PUBLICATION_RETRY_CHANGED_RESULT';
  end if;
  snapshot:=public.sharing_fetch_calendar_v3(calendar_id,null);
  if jsonb_array_length(snapshot->'entries')<>1000 or snapshot->>'revision'<>'1' then
    raise exception 'PUBLICATION_SNAPSHOT_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(snapshot->'entries') e
    where e->>'note' is distinct from 'Synthetic verification'
      or e->'breakMinutes' is distinct from '45'::jsonb) then
    raise exception 'PUBLICATION_CONTENT_MISMATCH';
  end if;
  begin
    perform public.sharing_publish_calendar_v3(calendar_id,device_id,repeat('a',64),
      gen_random_uuid(),1,jsonb_set(entries,'{999,timeZone}','"Bad/Zone"'::jsonb));
  exception when sqlstate '22023' then
    if sqlerrm<>'SHARE_INVALID_ARGUMENT' then raise; end if;
    invalid_rejected:=true;
  end;
  if not invalid_rejected or public.sharing_fetch_calendar_v3(calendar_id,null)->'entries'
    is distinct from snapshot->'entries' then
    raise exception 'INVALID_PUBLICATION_WAS_NOT_ATOMIC';
  end if;
  perform set_config('luna.verification_result',jsonb_build_object(
    'entries',1000,'publication_ms',round(elapsed_ms,2),'revision',1,
    'retry_idempotent',true,'invalid_timezone_rejected',true,'snapshot_preserved',true)::text,true);
end;
$verify$;
reset role;
select current_setting('luna.verification_result')::jsonb as verification;
rollback;
