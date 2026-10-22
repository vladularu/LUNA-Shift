-- Pauses are part of shift details, with no additional sharing permission.
-- Existing RPCs retain their exact response shapes for installed clients.
begin;
alter table luna_sharing.entries add column break_minutes integer check(break_minutes between 0 and 2880);

create function public.sharing_capabilities_v3() returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform luna_sharing.require_actor(); return jsonb_build_object('contentVersion',2,'durationVersion',1); end; $$;

create function public.sharing_publish_calendar_v3(p_calendar_id uuid,p_device_id uuid,p_device_secret text,p_mutation_id uuid,p_expected_revision bigint,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c luna_sharing.calendars:=luna_sharing.lock_owner(p_calendar_id); e jsonb; base jsonb; result jsonb; receipt luna_sharing.mutations; digest text;
begin
 if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>10000 or octet_length(p_entries::text)>8388608 then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 for e in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(e)<>'object' then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
  if (select count(*) from jsonb_object_keys(e))<>11 or not e ?& array['id','startsAt','endsAt','timeZone','allDay','title','color','symbol','kind','note','breakMinutes']
   or (e->'kind'<>'null'::jsonb and (jsonb_typeof(e->'kind')<>'string' or e->>'kind' not in ('SHIFT','APPOINTMENT')))
   or (e->'note'<>'null'::jsonb and (jsonb_typeof(e->'note')<>'string' or length(e->>'note')>4096 or translate(e->>'note',chr(9)||chr(10)||chr(13),'') ~ '[[:cntrl:]]'))
   or (c.visibility='AVAILABILITY' and e->'note'<>'null'::jsonb) then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
  if e->'breakMinutes'<>'null'::jsonb then
   if jsonb_typeof(e->'breakMinutes')<>'number' then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
   if (e->>'breakMinutes')::numeric<>trunc((e->>'breakMinutes')::numeric)
    or (e->>'breakMinutes')::numeric not between 0 and 2880
    or c.visibility='AVAILABILITY' or e->>'allDay'='true' or e->>'kind'='APPOINTMENT'
    then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
  end if;
 end loop;
 digest:=encode(extensions.digest(p_entries::text,'sha256'),'hex');
 select * into receipt from luna_sharing.mutations where calendar_id=p_calendar_id and operation='PUBLISH' and mutation_id=p_mutation_id;
 if found and receipt.content_hash is distinct from digest then raise exception using errcode='22023',message='SHARE_MUTATION_REUSED'; end if;
 select coalesce(jsonb_agg(value-'kind'-'note'-'breakMinutes'),'[]'::jsonb) into base from jsonb_array_elements(p_entries);
 -- The v1 publisher retains its device, receipt, rate, timestamp and snapshot validations.
 result:=public.sharing_publish_calendar(p_calendar_id,p_device_id,p_device_secret,p_mutation_id,p_expected_revision,base);
 if receipt.mutation_id is not null then return result; end if;
 update luna_sharing.entries t set kind=incoming.value->>'kind',note=incoming.value->>'note',break_minutes=(incoming.value->>'breakMinutes')::numeric::integer from jsonb_array_elements(p_entries) incoming(value) where t.calendar_id=p_calendar_id and t.id=(incoming.value->>'id')::uuid;
 update luna_sharing.mutations set content_hash=digest where calendar_id=p_calendar_id and operation='PUBLISH' and mutation_id=p_mutation_id;
 return result;
end; $$;

create or replace function luna_sharing.fetch_contents(p_calendar_id uuid,p_after_revision bigint,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=luna_sharing.require_actor(); c luna_sharing.calendars; m luna_sharing.members; entries jsonb:='[]'::jsonb; same boolean; current_revision bigint; r jsonb;
begin
 select * into c from luna_sharing.calendars where id=p_calendar_id for share;
 if c.id is null then raise exception using errcode='42501',message='SHARE_NOT_FOUND'; end if;
 if c.owner_id<>actor then
  select * into m from luna_sharing.members where calendar_id=p_calendar_id and user_id=actor and status='ACTIVE' for share;
  if not found then raise exception using errcode='42501',message='SHARE_NOT_FOUND'; end if;
 end if;
 r:=coalesce(m.rights,'{"shifts":true,"appointments":true,"notes":false}'::jsonb);
 current_revision:=luna_sharing.reader_revision(c,actor);
 same:=p_after_revision is not null and p_after_revision=current_revision;
 if not same then
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'startsAt',e.starts_at,'endsAt',e.ends_at,'timeZone',e.time_zone,'allDay',e.all_day,'title',e.title,'color',e.color,'symbol',e.symbol)
   ||case when p_version>=2 then jsonb_build_object('kind',e.kind,'note',case when c.owner_id=actor or (r->>'notes')::boolean then e.note else null end) else '{}'::jsonb end
   ||case when p_version>=3 then jsonb_build_object('breakMinutes',case when c.visibility='DETAILS' then e.break_minutes else null end) else '{}'::jsonb end order by e.starts_at,e.id),'[]'::jsonb)
   into entries from luna_sharing.entries e where e.calendar_id=p_calendar_id and (c.owner_id=actor
    or (e.kind='SHIFT' and (r->>'shifts')::boolean)
    or (e.kind='APPOINTMENT' and (r->>'appointments')::boolean)
    or (e.kind is null and (r->>'shifts')::boolean and (r->>'appointments')::boolean));
 end if;
 return jsonb_build_object('calendar',luna_sharing.calendar_json(c,actor),'revision',current_revision,'unchanged',same,'reset',not same,'entries',entries,'fetchedAt',clock_timestamp());
end; $$;
create function public.sharing_fetch_calendar_v3(p_calendar_id uuid,p_after_revision bigint default null) returns jsonb
language sql security definer set search_path='' as $$ select luna_sharing.fetch_contents(p_calendar_id,p_after_revision,3); $$;

revoke all on function public.sharing_capabilities_v3(),public.sharing_publish_calendar_v3(uuid,uuid,text,uuid,bigint,jsonb),public.sharing_fetch_calendar_v3(uuid,bigint) from public,anon;
grant execute on function public.sharing_capabilities_v3(),public.sharing_publish_calendar_v3(uuid,uuid,text,uuid,bigint,jsonb),public.sharing_fetch_calendar_v3(uuid,bigint) to authenticated;
commit;
