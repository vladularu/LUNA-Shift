-- Optional, read-only calendar sharing. Deploy only into the separate cloud Preview project.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema luna_sharing;
revoke all on schema luna_sharing from public, anon, authenticated;

create table luna_sharing.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80 and display_name !~ '[[:cntrl:]]')
);
create table luna_sharing.calendars (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_secret_hash text not null check (device_secret_hash ~ '^[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 80 and name !~ '[[:cntrl:]]'),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  visibility text not null check (visibility in ('DETAILS', 'AVAILABILITY')),
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index sharing_calendar_owner_idx on luna_sharing.calendars(owner_id);
create table luna_sharing.members (
  calendar_id uuid not null references luna_sharing.calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80 and display_name !~ '[[:cntrl:]]'),
  status text not null check (status in ('PENDING','ACTIVE','REJECTED','REVOKED','LEFT')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (calendar_id, user_id)
);
create index sharing_member_user_idx on luna_sharing.members(user_id, status);
create table luna_sharing.invites (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references luna_sharing.calendars(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete cascade,
  revoked_at timestamptz,
  check ((consumed_at is null) = (consumed_by is null))
);
create index sharing_invite_calendar_idx on luna_sharing.invites(calendar_id);
create table luna_sharing.entries (
  calendar_id uuid not null references luna_sharing.calendars(id) on delete cascade,
  id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at and ends_at-starts_at <= interval '48 hours'),
  time_zone text not null,
  all_day boolean not null,
  title text not null check (length(title) between 1 and 128 and title !~ '[[:cntrl:]]'),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  symbol text not null check (symbol in ('calendar','sunrise','sun','moon','home','book','clock','star','unavailable')),
  primary key (calendar_id, id)
);
create table luna_sharing.mutations (
  calendar_id uuid not null references luna_sharing.calendars(id) on delete cascade,
  operation text not null check (operation in ('PUBLISH','INVITE')),
  mutation_id uuid not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (calendar_id, operation, mutation_id)
);
create index sharing_mutation_rate_idx on luna_sharing.mutations(calendar_id,operation,created_at);

-- Defense in depth: client roles cannot reach this schema or any table directly.
-- Policies permit only owner rows if an accidental SELECT grant is added later.
alter table luna_sharing.profiles enable row level security;
alter table luna_sharing.calendars enable row level security;
alter table luna_sharing.members enable row level security;
alter table luna_sharing.invites enable row level security;
alter table luna_sharing.entries enable row level security;
alter table luna_sharing.mutations enable row level security;
create policy profile_owner_select on luna_sharing.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy calendar_owner_select on luna_sharing.calendars for select to authenticated using (owner_id = (select auth.uid()));
create policy member_self_or_owner_select on luna_sharing.members for select to authenticated using (user_id = (select auth.uid()) or exists (select 1 from luna_sharing.calendars c where c.id = calendar_id and c.owner_id = (select auth.uid())));
create policy invite_owner_select on luna_sharing.invites for select to authenticated using (exists (select 1 from luna_sharing.calendars c where c.id = calendar_id and c.owner_id = (select auth.uid())));
create policy entry_owner_select on luna_sharing.entries for select to authenticated using (exists (select 1 from luna_sharing.calendars c where c.id = calendar_id and c.owner_id = (select auth.uid())));
create policy mutation_owner_select on luna_sharing.mutations for select to authenticated using (exists (select 1 from luna_sharing.calendars c where c.id = calendar_id and c.owner_id = (select auth.uid())));
revoke all on all tables in schema luna_sharing from public, anon, authenticated;
revoke all on all sequences in schema luna_sharing from public, anon, authenticated;

create function luna_sharing.require_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); session_id uuid; session_claim text := auth.jwt()->>'session_id';
begin
  if session_claim is null or session_claim !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' then
    raise exception using errcode='42501', message='SHARE_UNAUTHENTICATED';
  end if;
  session_id := session_claim::uuid;
  if actor is null or not exists (
    select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=actor and s.id=session_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=now())
      and (s.not_after is null or s.not_after>now())
  ) then
    raise exception using errcode='42501', message='SHARE_UNAUTHENTICATED';
  end if;
  return actor;
end;
$$;
create function luna_sharing.lock_owner(p_calendar_id uuid) returns luna_sharing.calendars
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); result luna_sharing.calendars;
begin
  select * into result from luna_sharing.calendars c where c.id=p_calendar_id and c.owner_id=actor for update;
  if not found then raise exception using errcode='42501', message='SHARE_NOT_FOUND'; end if;
  return result;
end;
$$;
create function luna_sharing.calendar_json(p_calendar luna_sharing.calendars, p_actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_calendar.id, 'ownerId', p_calendar.owner_id,
    'name', p_calendar.name, 'color', p_calendar.color, 'visibility', p_calendar.visibility,
    'revision', p_calendar.revision, 'isOwner', p_calendar.owner_id=p_actor,
    'publishedAt', p_calendar.published_at)
    || case when p_calendar.owner_id=p_actor then jsonb_build_object('deviceId',p_calendar.device_id) else '{}'::jsonb end;
$$;
create function luna_sharing.member_json(p_member luna_sharing.members) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('userId',p_member.user_id,'displayName',p_member.display_name,
    'status',p_member.status,'requestedAt',p_member.requested_at,'updatedAt',p_member.updated_at);
$$;

-- Restricted housekeeping: requests clean their calendar; a daily owner-role job also cleans inactive calendars.
-- The 90-day retry window is explicit. Still-live invitation receipts are never removed.
create function luna_sharing.prune_history(p_calendar_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  for c in select id from luna_sharing.calendars where p_calendar_id is null or id=p_calendar_id for update skip locked loop
    delete from luna_sharing.invites where calendar_id=c.id and created_at<now()-interval '90 days'
      and (expires_at<=now() or revoked_at is not null);
    delete from luna_sharing.mutations m where m.calendar_id=c.id and m.created_at<now()-interval '90 days'
      and (m.operation='PUBLISH' or not exists(
        select 1 from luna_sharing.invites i where i.calendar_id=c.id and i.id::text=m.result->>'inviteId'
          and i.revoked_at is null and i.expires_at>now()
      ));
  end loop;
end;
$$;

create function public.sharing_save_profile(p_expected_actor_id uuid, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor();
begin
  if p_expected_actor_id is null or p_expected_actor_id<>actor then
    raise exception using errcode='42501', message='SHARE_ACCOUNT_MISMATCH';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 80 or p_display_name ~ '[[:cntrl:]]' then
    raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
  end if;
  insert into luna_sharing.profiles(user_id,display_name) values(actor,btrim(p_display_name))
    on conflict (user_id) do update set display_name=excluded.display_name;
  return jsonb_build_object('userId',actor,'displayName',btrim(p_display_name));
end;
$$;
create function public.sharing_create_calendar(p_expected_actor_id uuid, p_calendar_id uuid, p_device_id uuid, p_device_secret text, p_name text, p_color text, p_visibility text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); c luna_sharing.calendars; secret_hash text;
begin
  if p_expected_actor_id is null or p_expected_actor_id<>actor then
    raise exception using errcode='42501', message='SHARE_ACCOUNT_MISMATCH';
  end if;
  if p_calendar_id is null or p_device_id is null or p_device_secret is null or p_device_secret !~ '^[a-f0-9]{64}$' or p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_name ~ '[[:cntrl:]]' or p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_visibility is null or p_visibility not in ('DETAILS','AVAILABILITY') then
    raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
  end if;
  secret_hash := encode(extensions.digest(p_device_secret,'sha256'),'hex');
  -- One account lock serializes calendar-creation limits without device-clock ordering.
  perform 1 from auth.users u where u.id=actor for update;
  select * into c from luna_sharing.calendars where id=p_calendar_id for update;
  if found then
    if c.owner_id<>actor then raise exception using errcode='42501', message='SHARE_NOT_FOUND'; end if;
    if c.device_id<>p_device_id or c.device_secret_hash<>secret_hash or c.name<>btrim(p_name) or c.color<>p_color or c.visibility<>p_visibility then
      raise exception using errcode='22023', message='SHARE_MUTATION_REUSED';
    end if;
  else
    if (select count(*) from luna_sharing.calendars where owner_id=actor)>=20 then
      raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
    end if;
    insert into luna_sharing.calendars(id,owner_id,device_id,device_secret_hash,name,color,visibility)
      values(p_calendar_id,actor,p_device_id,secret_hash,btrim(p_name),p_color,p_visibility) returning * into c;
  end if;
  return luna_sharing.calendar_json(c,actor);
end;
$$;
create function public.sharing_publish_calendar(p_calendar_id uuid, p_device_id uuid, p_device_secret text, p_mutation_id uuid, p_expected_revision bigint, p_entries jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c luna_sharing.calendars := luna_sharing.lock_owner(p_calendar_id);
  receipt luna_sharing.mutations; payload_hash text; e jsonb; result jsonb; entry_id uuid; start_at timestamptz; end_at timestamptz;
begin
  if p_device_id is null or c.device_id<>p_device_id or p_device_secret is null or p_device_secret !~ '^[a-f0-9]{64}$'
    or c.device_secret_hash<>encode(extensions.digest(p_device_secret,'sha256'),'hex') then raise exception using errcode='42501', message='SHARE_DEVICE_MISMATCH'; end if;
  if p_mutation_id is null or p_expected_revision is null or p_expected_revision<0 or p_entries is null
    or jsonb_typeof(p_entries)<>'array' then raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT'; end if;
  if jsonb_array_length(p_entries)>10000 or octet_length(p_entries::text)>8388608 then
    raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
  end if;
  payload_hash := encode(extensions.digest(jsonb_build_object('deviceId',p_device_id,'deviceSecretHash',c.device_secret_hash,'expectedRevision',p_expected_revision,'entries',p_entries)::text,'sha256'),'hex');
  perform luna_sharing.prune_history(p_calendar_id);
  select * into receipt from luna_sharing.mutations where calendar_id=p_calendar_id and operation='PUBLISH' and mutation_id=p_mutation_id;
  if found then
    if receipt.payload_hash<>payload_hash then raise exception using errcode='22023', message='SHARE_MUTATION_REUSED'; end if;
    return receipt.result;
  end if;
  if p_expected_revision<>c.revision or c.revision>=9007199254740991 then
    raise exception using errcode='22023', message='SHARE_REVISION_CONFLICT';
  end if;
  if (select count(*) from luna_sharing.mutations where calendar_id=p_calendar_id and operation='PUBLISH' and created_at>now()-interval '1 hour')>=120 then
    raise exception using errcode='22023', message='SHARE_RATE_LIMIT';
  end if;
  -- Validate the complete payload before replacing the old snapshot. Never persist arbitrary JSON.
  for e in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(e)<>'object' or (select count(*) from jsonb_object_keys(e))<>8
      or not e ?& array['id','startsAt','endsAt','timeZone','allDay','title','color','symbol']
      or jsonb_typeof(e->'id')<>'string' or jsonb_typeof(e->'startsAt')<>'string'
      or jsonb_typeof(e->'endsAt')<>'string' or jsonb_typeof(e->'timeZone')<>'string'
      or jsonb_typeof(e->'allDay')<>'boolean' or jsonb_typeof(e->'title')<>'string'
      or jsonb_typeof(e->'color')<>'string' or jsonb_typeof(e->'symbol')<>'string'
      or length(e->>'title') not between 1 and 128 or e->>'title' ~ '[[:cntrl:]]'
      or e->>'color' !~ '^#[0-9A-Fa-f]{6}$'
      or e->>'symbol' not in ('calendar','sunrise','sun','moon','home','book','clock','star','unavailable')
      or e->>'startsAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or e->>'endsAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=e->>'timeZone') then
      raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
    end if;
    if c.visibility='AVAILABILITY' and (e->>'title'<>'Nicht verfügbar' or e->>'color'<>'#737373' or e->>'symbol'<>'unavailable') then
      raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
    end if;
    begin
      entry_id := (e->>'id')::uuid; start_at := (e->>'startsAt')::timestamptz; end_at := (e->>'endsAt')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
    end;
    if end_at<=start_at or end_at-start_at>interval '48 hours' then raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_entries))<>(select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_entries)) then
    raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
  end if;
  delete from luna_sharing.entries where calendar_id=p_calendar_id;
  insert into luna_sharing.entries(calendar_id,id,starts_at,ends_at,time_zone,all_day,title,color,symbol)
    select p_calendar_id,(value->>'id')::uuid,(value->>'startsAt')::timestamptz,(value->>'endsAt')::timestamptz,
      value->>'timeZone',(value->>'allDay')::boolean,value->>'title',value->>'color',value->>'symbol' from jsonb_array_elements(p_entries);
  update luna_sharing.calendars set revision=revision+1,published_at=clock_timestamp() where id=p_calendar_id returning * into c;
  result := jsonb_build_object('calendarId',c.id,'revision',c.revision,'publishedAt',c.published_at);
  insert into luna_sharing.mutations(calendar_id,operation,mutation_id,payload_hash,result) values(p_calendar_id,'PUBLISH',p_mutation_id,payload_hash,result);
  return result;
end;
$$;
create function public.sharing_list_calendars() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); result jsonb;
begin
  select coalesce(jsonb_agg(luna_sharing.calendar_json(c,actor) order by c.name,c.id),'[]'::jsonb) into result
    from luna_sharing.calendars c where c.owner_id=actor or exists(select 1 from luna_sharing.members m where m.calendar_id=c.id and m.user_id=actor and m.status='ACTIVE');
  return result;
end;
$$;
create function public.sharing_fetch_calendar(p_calendar_id uuid, p_after_revision bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); c luna_sharing.calendars; entries jsonb := '[]'::jsonb; same boolean;
begin
  select * into c from luna_sharing.calendars where id=p_calendar_id for share;
  if not found or (c.owner_id<>actor and not exists(select 1 from luna_sharing.members m where m.calendar_id=p_calendar_id and m.user_id=actor and m.status='ACTIVE')) then
    raise exception using errcode='42501', message='SHARE_NOT_FOUND';
  end if;
  same := p_after_revision is not null and p_after_revision=c.revision;
  if not same then
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'startsAt',e.starts_at,'endsAt',e.ends_at,'timeZone',e.time_zone,'allDay',e.all_day,'title',e.title,'color',e.color,'symbol',e.symbol) order by e.starts_at,e.id),'[]'::jsonb)
      into entries from luna_sharing.entries e where e.calendar_id=p_calendar_id;
  end if;
  return jsonb_build_object('calendar',luna_sharing.calendar_json(c,actor),'revision',c.revision,'unchanged',same,'reset',not same,'entries',entries,'fetchedAt',clock_timestamp());
end;
$$;
create function public.sharing_create_invite(p_calendar_id uuid, p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); c luna_sharing.calendars; receipt luna_sharing.mutations; i luna_sharing.invites; token text; result jsonb;
begin
  if p_mutation_id is null then raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT'; end if;
  -- Match create_calendar lock order: account first, then calendar. This serializes owner-wide invite rates.
  perform 1 from auth.users u where u.id=actor for update;
  c := luna_sharing.lock_owner(p_calendar_id);
  perform luna_sharing.prune_history(p_calendar_id);
  select * into receipt from luna_sharing.mutations where calendar_id=p_calendar_id and operation='INVITE' and mutation_id=p_mutation_id;
  if found then return receipt.result || jsonb_build_object('token',null); end if;
  if (select count(*) from luna_sharing.mutations m join luna_sharing.calendars owned on owned.id=m.calendar_id
      where owned.owner_id=actor and m.operation='INVITE' and m.created_at>now()-interval '1 hour')>=10 then
    raise exception using errcode='22023', message='SHARE_RATE_LIMIT';
  end if;
  if (select count(*) from luna_sharing.invites where calendar_id=p_calendar_id and consumed_at is null and revoked_at is null and expires_at>now())>=20 then
    raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT';
  end if;
  token := encode(extensions.gen_random_bytes(32),'hex');
  insert into luna_sharing.invites(calendar_id,token_hash) values(p_calendar_id,encode(extensions.digest(token,'sha256'),'hex')) returning * into i;
  result := jsonb_build_object('inviteId',i.id,'calendarId',i.calendar_id,'expiresAt',i.expires_at);
  insert into luna_sharing.mutations(calendar_id,operation,mutation_id,payload_hash,result) values(p_calendar_id,'INVITE',p_mutation_id,encode(extensions.digest(p_calendar_id::text,'sha256'),'hex'),result);
  return result || jsonb_build_object('token',token);
end;
$$;
create function public.sharing_claim_invite(p_expected_actor_id uuid, p_token text, p_display_name text) returns jsonb
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
  if i.consumed_by=actor then
    select * into m from luna_sharing.members v where v.calendar_id=c.id and v.user_id=actor;
    if not found or m.status not in ('PENDING','ACTIVE') then raise exception using errcode='22023', message='SHARE_INVITE_INVALID'; end if;
  else
    update luna_sharing.invites set consumed_at=clock_timestamp(),consumed_by=actor where id=i.id;
    insert into luna_sharing.members(calendar_id,user_id,display_name,status) values(c.id,actor,btrim(p_display_name),'PENDING')
      on conflict (calendar_id,user_id) do update set display_name=excluded.display_name,
        status=case when luna_sharing.members.status='ACTIVE' then 'ACTIVE' else 'PENDING' end,
        requested_at=clock_timestamp(),updated_at=clock_timestamp() returning * into m;
  end if;
  return jsonb_build_object('calendarId',c.id,'calendarName',c.name,'status',m.status);
end;
$$;
create function public.sharing_list_members(p_calendar_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c luna_sharing.calendars := luna_sharing.lock_owner(p_calendar_id); members jsonb; invites jsonb;
begin
  select coalesce(jsonb_agg(luna_sharing.member_json(m) order by m.requested_at,m.user_id),'[]'::jsonb) into members from luna_sharing.members m where m.calendar_id=p_calendar_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'expiresAt',i.expires_at,'consumedAt',i.consumed_at,'revokedAt',i.revoked_at) order by i.created_at,i.id),'[]'::jsonb) into invites from luna_sharing.invites i where i.calendar_id=p_calendar_id;
  return jsonb_build_object('members',members,'invites',invites);
end;
$$;
create function public.sharing_set_member(p_calendar_id uuid, p_user_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c luna_sharing.calendars := luna_sharing.lock_owner(p_calendar_id); m luna_sharing.members; target text;
begin
  target := case p_action when 'APPROVE' then 'ACTIVE' when 'REJECT' then 'REJECTED' when 'REVOKE' then 'REVOKED' else null end;
  if target is null or p_user_id is null then raise exception using errcode='22023', message='SHARE_INVALID_ARGUMENT'; end if;
  select * into m from luna_sharing.members where calendar_id=p_calendar_id and user_id=p_user_id for update;
  if not found then raise exception using errcode='22023', message='SHARE_MEMBER_INVALID'; end if;
  if m.status=target then return luna_sharing.member_json(m); end if;
  if (p_action in ('APPROVE','REJECT') and m.status<>'PENDING') or (p_action='REVOKE' and m.status not in ('PENDING','ACTIVE')) then
    raise exception using errcode='22023', message='SHARE_MEMBER_INVALID';
  end if;
  update luna_sharing.members set status=target,updated_at=clock_timestamp() where calendar_id=p_calendar_id and user_id=p_user_id returning * into m;
  return luna_sharing.member_json(m);
end;
$$;
create function public.sharing_revoke_invite(p_calendar_id uuid, p_invite_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c luna_sharing.calendars := luna_sharing.lock_owner(p_calendar_id);
begin
  update luna_sharing.invites set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_invite_id and calendar_id=p_calendar_id;
  if not found then raise exception using errcode='22023', message='SHARE_INVITE_INVALID'; end if;
  return jsonb_build_object('revoked',true);
end;
$$;
create function public.sharing_leave_calendar(p_expected_actor_id uuid, p_calendar_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor(); c luna_sharing.calendars;
begin
  if p_expected_actor_id is null or p_expected_actor_id<>actor then
    raise exception using errcode='42501', message='SHARE_ACCOUNT_MISMATCH';
  end if;
  select * into c from luna_sharing.calendars where id=p_calendar_id for update;
  if not found then raise exception using errcode='42501', message='SHARE_NOT_FOUND'; end if;
  if c.owner_id=actor then raise exception using errcode='22023', message='SHARE_OWNER_CANNOT_LEAVE'; end if;
  update luna_sharing.members set status='LEFT',updated_at=clock_timestamp() where calendar_id=p_calendar_id and user_id=actor;
  if not found then raise exception using errcode='42501', message='SHARE_NOT_FOUND'; end if;
  return jsonb_build_object('left',true);
end;
$$;
create function public.sharing_delete_calendar(p_calendar_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c luna_sharing.calendars := luna_sharing.lock_owner(p_calendar_id);
begin
  delete from luna_sharing.calendars where id=p_calendar_id;
  return jsonb_build_object('deleted',true);
end;
$$;
create function public.sharing_delete_account(p_expected_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor();
begin
  if p_expected_actor_id is null or p_expected_actor_id<>actor then
    raise exception using errcode='42501', message='SHARE_ACCOUNT_MISMATCH';
  end if;
  -- Apple authorization must be revoked by the authenticated server endpoint first.
  -- A client cannot bypass that endpoint by calling the generic SQL RPC directly.
  if exists(select 1 from auth.identities i where i.user_id=actor and i.provider='apple') then
    raise exception using errcode='42501', message='SHARE_PROVIDER_REVOKE_REQUIRED';
  end if;
  delete from auth.users where id=actor;
  return jsonb_build_object('deleted',true);
end;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default; remove it explicitly, including helpers.
revoke all on all functions in schema luna_sharing from public, anon, authenticated;
revoke all on function public.sharing_save_profile(uuid,text) from public, anon;
revoke all on function public.sharing_create_calendar(uuid,uuid,uuid,text,text,text,text) from public, anon;
revoke all on function public.sharing_publish_calendar(uuid,uuid,text,uuid,bigint,jsonb) from public, anon;
revoke all on function public.sharing_list_calendars() from public, anon;
revoke all on function public.sharing_fetch_calendar(uuid,bigint) from public, anon;
revoke all on function public.sharing_create_invite(uuid,uuid) from public, anon;
revoke all on function public.sharing_claim_invite(uuid,text,text) from public, anon;
revoke all on function public.sharing_list_members(uuid) from public, anon;
revoke all on function public.sharing_set_member(uuid,uuid,text) from public, anon;
revoke all on function public.sharing_revoke_invite(uuid,uuid) from public, anon;
revoke all on function public.sharing_leave_calendar(uuid,uuid) from public, anon;
revoke all on function public.sharing_delete_calendar(uuid) from public, anon;
revoke all on function public.sharing_delete_account(uuid) from public, anon;
grant execute on function public.sharing_save_profile(uuid,text), public.sharing_create_calendar(uuid,uuid,uuid,text,text,text,text),
  public.sharing_publish_calendar(uuid,uuid,text,uuid,bigint,jsonb), public.sharing_list_calendars(),
  public.sharing_fetch_calendar(uuid,bigint), public.sharing_create_invite(uuid,uuid),
  public.sharing_claim_invite(uuid,text,text), public.sharing_list_members(uuid),
  public.sharing_set_member(uuid,uuid,text), public.sharing_revoke_invite(uuid,uuid),
  public.sharing_leave_calendar(uuid,uuid), public.sharing_delete_calendar(uuid), public.sharing_delete_account(uuid) to authenticated;
commit;
