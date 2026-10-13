-- Additive content rights. Legacy RPC response shapes and existing invitations remain compatible.
begin;
alter table luna_sharing.members add column rights jsonb;
alter table luna_sharing.members add column content_revision bigint not null default 0 check(content_revision between 0 and 9007199254740991);
alter table luna_sharing.invites add column rights jsonb;
alter table luna_sharing.entries add column kind text check(kind in ('SHIFT','APPOINTMENT'));
alter table luna_sharing.entries add column note text check(length(note)<=4096);
alter table luna_sharing.mutations add column content_hash text;
create table luna_sharing.invite_joins (
 invite_id uuid not null references luna_sharing.invites(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default clock_timestamp(),primary key(invite_id,user_id)
);
alter table luna_sharing.invite_joins enable row level security;
revoke all on luna_sharing.invite_joins from public,anon,authenticated;

create function luna_sharing.valid_rights(r jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if r is null or jsonb_typeof(r)<>'object' then return false; end if;
 return coalesce((select count(*) from jsonb_object_keys(r))=3
   and jsonb_typeof(r->'shifts')='boolean' and jsonb_typeof(r->'appointments')='boolean' and jsonb_typeof(r->'notes')='boolean',false);
end;
$$;
alter table luna_sharing.members add constraint sharing_member_rights_valid check(rights is null or luna_sharing.valid_rights(rights));
alter table luna_sharing.invites add constraint sharing_invite_rights_valid check(rights is null or luna_sharing.valid_rights(rights));

create function luna_sharing.reader_revision(c luna_sharing.calendars,actor uuid) returns bigint
language sql stable set search_path='' as $$
 select c.revision+case when c.owner_id=actor then 0 else coalesce((select m.content_revision from luna_sharing.members m where m.calendar_id=c.id and m.user_id=actor),0) end;
$$;
create or replace function luna_sharing.calendar_json(p_calendar luna_sharing.calendars, p_actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_calendar.id, 'ownerId', p_calendar.owner_id,
    'name', p_calendar.name, 'color', p_calendar.color, 'visibility', p_calendar.visibility,
    'revision', luna_sharing.reader_revision(p_calendar,p_actor), 'isOwner', p_calendar.owner_id=p_actor,
    'publishedAt', p_calendar.published_at)
    || case when p_calendar.owner_id=p_actor then jsonb_build_object('deviceId',p_calendar.device_id) else '{}'::jsonb end;
$$;

create function luna_sharing.member_json_v2(m luna_sharing.members) returns jsonb
language sql stable set search_path='' as $$ select luna_sharing.member_json(m)||jsonb_build_object('rights',m.rights); $$;

create function public.sharing_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform luna_sharing.require_actor(); return jsonb_build_object('contentVersion',2); end; $$;

create function public.sharing_publish_calendar_v2(p_calendar_id uuid,p_device_id uuid,p_device_secret text,p_mutation_id uuid,p_expected_revision bigint,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c luna_sharing.calendars:=luna_sharing.lock_owner(p_calendar_id); e jsonb; base jsonb; result jsonb; receipt luna_sharing.mutations; digest text;
begin
 if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>10000 or octet_length(p_entries::text)>8388608 then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 for e in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(e)<>'object' then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
  if (select count(*) from jsonb_object_keys(e))<>10 or not e ?& array['id','startsAt','endsAt','timeZone','allDay','title','color','symbol','kind','note']
   or jsonb_typeof(e->'kind')<>'string' or e->>'kind' not in ('SHIFT','APPOINTMENT')
   or (e->'note'<>'null'::jsonb and (jsonb_typeof(e->'note')<>'string' or length(e->>'note')>4096 or translate(e->>'note',chr(9)||chr(10)||chr(13),'') ~ '[[:cntrl:]]'))
   or (c.visibility='AVAILABILITY' and e->'note'<>'null'::jsonb) then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 end loop;
 digest:=encode(extensions.digest(p_entries::text,'sha256'),'hex');
 select * into receipt from luna_sharing.mutations where calendar_id=p_calendar_id and operation='PUBLISH' and mutation_id=p_mutation_id;
 if found and receipt.content_hash is distinct from digest then raise exception using errcode='22023',message='SHARE_MUTATION_REUSED'; end if;
 select coalesce(jsonb_agg(value-'kind'-'note'),'[]'::jsonb) into base from jsonb_array_elements(p_entries);
 -- The v1 publisher retains its device, receipt, rate, timestamp and snapshot validations.
 result:=public.sharing_publish_calendar(p_calendar_id,p_device_id,p_device_secret,p_mutation_id,p_expected_revision,base);
 if receipt.mutation_id is not null then return result; end if;
 update luna_sharing.entries t set kind=incoming.value->>'kind',note=incoming.value->>'note' from jsonb_array_elements(p_entries) incoming(value) where t.calendar_id=p_calendar_id and t.id=(incoming.value->>'id')::uuid;
 update luna_sharing.mutations set content_hash=digest where calendar_id=p_calendar_id and operation='PUBLISH' and mutation_id=p_mutation_id;
 return result;
end; $$;

create function luna_sharing.fetch_contents(p_calendar_id uuid,p_after_revision bigint,p_version integer) returns jsonb
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
   ||case when p_version=2 then jsonb_build_object('kind',e.kind,'note',case when c.owner_id=actor or (r->>'notes')::boolean then e.note else null end) else '{}'::jsonb end order by e.starts_at,e.id),'[]'::jsonb)
   into entries from luna_sharing.entries e where e.calendar_id=p_calendar_id and (c.owner_id=actor
    or (e.kind='SHIFT' and (r->>'shifts')::boolean)
    or (e.kind='APPOINTMENT' and (r->>'appointments')::boolean)
    or (e.kind is null and (r->>'shifts')::boolean and (r->>'appointments')::boolean));
 end if;
 return jsonb_build_object('calendar',luna_sharing.calendar_json(c,actor),'revision',current_revision,'unchanged',same,'reset',not same,'entries',entries,'fetchedAt',clock_timestamp());
end; $$;
create or replace function public.sharing_fetch_calendar(p_calendar_id uuid,p_after_revision bigint default null) returns jsonb
language sql security definer set search_path='' as $$ select luna_sharing.fetch_contents(p_calendar_id,p_after_revision,1); $$;
create function public.sharing_fetch_calendar_v2(p_calendar_id uuid,p_after_revision bigint default null) returns jsonb
language sql security definer set search_path='' as $$ select luna_sharing.fetch_contents(p_calendar_id,p_after_revision,2); $$;

create function public.sharing_create_invite_v2(p_calendar_id uuid,p_mutation_id uuid,p_rights jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=luna_sharing.require_actor(); c luna_sharing.calendars; receipt luna_sharing.mutations; invite_result jsonb; digest text;
begin
 if not coalesce(luna_sharing.valid_rights(p_rights),false) or not ((p_rights->>'shifts')::boolean or (p_rights->>'appointments')::boolean) then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 perform 1 from auth.users where id=actor for update;
 c:=luna_sharing.lock_owner(p_calendar_id);
 digest:=encode(extensions.digest(p_rights::text,'sha256'),'hex');
 select * into receipt from luna_sharing.mutations where calendar_id=p_calendar_id and operation='INVITE' and mutation_id=p_mutation_id;
 if found and receipt.content_hash is distinct from digest then raise exception using errcode='22023',message='SHARE_MUTATION_REUSED'; end if;
 invite_result:=public.sharing_create_invite(p_calendar_id,p_mutation_id);
 if receipt.mutation_id is not null then return invite_result; end if;
 update luna_sharing.invites set rights=p_rights,expires_at=now()+interval '2 days' where id=(invite_result->>'inviteId')::uuid returning invite_result||jsonb_build_object('expiresAt',expires_at) into invite_result;
 update luna_sharing.mutations set content_hash=digest,result=(invite_result-'token') where calendar_id=p_calendar_id and operation='INVITE' and mutation_id=p_mutation_id;
 return invite_result;
end; $$;
create or replace function public.sharing_claim_invite(p_expected_actor_id uuid, p_token text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); i luna_sharing.invites; c luna_sharing.calendars; m luna_sharing.members; invite_calendar_id uuid;
begin
  if p_expected_actor_id is null or p_expected_actor_id<>actor then
    raise exception using errcode='42501', message='SHARE_ACCOUNT_MISMATCH';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023', message='SHARE_INVITE_INVALID'; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80 or p_display_name ~ '[[:cntrl:]]' then
    raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
  end if;
  select v.calendar_id into invite_calendar_id from luna_sharing.invites v where v.token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if not found then raise exception using errcode='22023', message='SHARE_INVITE_INVALID'; end if;
  select * into c from luna_sharing.calendars where id=invite_calendar_id for update;
  select * into i from luna_sharing.invites v where v.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
  if not found or c.id is null or i.revoked_at is not null or i.expires_at<=now() or c.owner_id=actor or (i.consumed_by is not null and i.consumed_by<>actor) then
    raise exception using errcode='22023', message='SHARE_INVITE_INVALID';
  end if;
  if i.rights is not null then
    if exists(select 1 from luna_sharing.invite_joins j where j.invite_id=i.id and j.user_id=actor) then
      select * into m from luna_sharing.members v where v.calendar_id=c.id and v.user_id=actor;
      if not found or m.status<>'ACTIVE' then raise exception using errcode='22023',message='SHARE_INVITE_INVALID'; end if;
    else
      insert into luna_sharing.invite_joins(invite_id,user_id) values(i.id,actor);
      insert into luna_sharing.members(calendar_id,user_id,display_name,status,rights)
        values(c.id,actor,btrim(p_display_name),'ACTIVE',i.rights)
        on conflict(calendar_id,user_id) do update set display_name=excluded.display_name,status='ACTIVE',rights=i.rights,
          content_revision=luna_sharing.members.content_revision+case when i.rights is distinct from luna_sharing.members.rights then 1 else 0 end,
          requested_at=clock_timestamp(),updated_at=clock_timestamp() returning * into m;
    end if;
  elsif i.consumed_by=actor then
    select * into m from luna_sharing.members v where v.calendar_id=c.id and v.user_id=actor;
    if not found or m.status not in ('PENDING','ACTIVE') then raise exception using errcode='22023', message='SHARE_INVITE_INVALID'; end if;
  else
    update luna_sharing.invites set consumed_at=clock_timestamp(),consumed_by=actor where id=i.id;
    insert into luna_sharing.members(calendar_id,user_id,display_name,status,rights) values(c.id,actor,btrim(p_display_name),case when i.rights is not null then 'ACTIVE' else 'PENDING' end,i.rights)
      on conflict (calendar_id,user_id) do update set display_name=excluded.display_name,
        status=case when i.rights is not null or luna_sharing.members.status='ACTIVE' then 'ACTIVE' else 'PENDING' end,
        rights=coalesce(i.rights,luna_sharing.members.rights),
        content_revision=luna_sharing.members.content_revision+case when i.rights is not null and i.rights is distinct from luna_sharing.members.rights then 1 else 0 end,
        requested_at=clock_timestamp(),updated_at=clock_timestamp() returning * into m;
  end if;
  return jsonb_build_object('calendarId',c.id,'calendarName',c.name,'status',m.status);
end;
$$;

create function public.sharing_list_members_v2(p_calendar_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c luna_sharing.calendars:=luna_sharing.lock_owner(p_calendar_id); members jsonb; invites jsonb;
begin
 select coalesce(jsonb_agg(luna_sharing.member_json_v2(m) order by m.requested_at,m.user_id),'[]'::jsonb) into members from luna_sharing.members m where m.calendar_id=p_calendar_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'expiresAt',i.expires_at,'consumedAt',i.consumed_at,'revokedAt',i.revoked_at,'rights',i.rights,'joinedCount',(select count(*) from luna_sharing.invite_joins j where j.invite_id=i.id)) order by i.created_at,i.id),'[]'::jsonb) into invites from luna_sharing.invites i where i.calendar_id=p_calendar_id;
 return jsonb_build_object('members',members,'invites',invites);
end; $$;
create function public.sharing_set_member_rights(p_calendar_id uuid,p_user_id uuid,p_rights jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c luna_sharing.calendars:=luna_sharing.lock_owner(p_calendar_id); m luna_sharing.members;
begin
 if not coalesce(luna_sharing.valid_rights(p_rights),false) then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 select * into m from luna_sharing.members where calendar_id=p_calendar_id and user_id=p_user_id for update;
 if not found or m.status not in ('PENDING','ACTIVE') then raise exception using errcode='22023',message='SHARE_MEMBER_INVALID'; end if;
 if m.rights is distinct from p_rights then
  if c.revision+m.content_revision>=9007199254740991 then raise exception using errcode='22023',message='SHARE_REVISION_CONFLICT'; end if;
  update luna_sharing.members set rights=p_rights,content_revision=content_revision+1,updated_at=clock_timestamp() where calendar_id=p_calendar_id and user_id=p_user_id returning * into m;
 end if;
 return luna_sharing.member_json_v2(m);
end; $$;

revoke all on all functions in schema luna_sharing from public,anon,authenticated;
revoke all on function public.sharing_capabilities(),public.sharing_publish_calendar_v2(uuid,uuid,text,uuid,bigint,jsonb),public.sharing_fetch_calendar_v2(uuid,bigint),public.sharing_create_invite_v2(uuid,uuid,jsonb),public.sharing_list_members_v2(uuid),public.sharing_set_member_rights(uuid,uuid,jsonb) from public,anon;
grant execute on function public.sharing_capabilities(),public.sharing_publish_calendar_v2(uuid,uuid,text,uuid,bigint,jsonb),public.sharing_fetch_calendar_v2(uuid,bigint),public.sharing_create_invite_v2(uuid,uuid,jsonb),public.sharing_list_members_v2(uuid),public.sharing_set_member_rights(uuid,uuid,jsonb) to authenticated;
commit;
