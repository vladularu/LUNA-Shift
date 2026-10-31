-- Opt-in per invitation/recipient. Old RPC response shapes remain unchanged.
begin;
alter table luna_sharing.invites add column share_profile_photo boolean not null default false;
alter table luna_sharing.members add column share_profile_photo boolean not null default false;
alter table luna_sharing.mutations add column profile_photo_consent boolean;

create function luna_sharing.clear_photo_consent() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.status not in ('PENDING','ACTIVE') then new.share_profile_photo:=false; end if;
 return new;
end; $$;
create trigger sharing_clear_photo_consent before insert or update on luna_sharing.members
for each row execute function luna_sharing.clear_photo_consent();

create function public.sharing_profile_photo_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform luna_sharing.require_actor(); return jsonb_build_object('profilePhotoVersion',1); end; $$;

create function public.sharing_create_invite_v3(p_calendar_id uuid,p_mutation_id uuid,p_rights jsonb,p_share_profile_photo boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=luna_sharing.require_actor(); receipt luna_sharing.mutations; result jsonb;
begin
 if p_share_profile_photo is null then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 -- Same lock order as v2; one transaction binds consent to the invitation receipt.
 perform 1 from auth.users where id=actor for update;
 perform luna_sharing.lock_owner(p_calendar_id);
 select * into receipt from luna_sharing.mutations where calendar_id=p_calendar_id and operation='INVITE' and mutation_id=p_mutation_id;
 if found and receipt.profile_photo_consent is distinct from p_share_profile_photo then
  raise exception using errcode='22023',message='SHARE_MUTATION_REUSED';
 end if;
 result:=public.sharing_create_invite_v2(p_calendar_id,p_mutation_id,p_rights);
 if receipt.mutation_id is null then
  update luna_sharing.invites set share_profile_photo=p_share_profile_photo where id=(result->>'inviteId')::uuid;
  update luna_sharing.mutations set profile_photo_consent=p_share_profile_photo where calendar_id=p_calendar_id and operation='INVITE' and mutation_id=p_mutation_id;
 end if;
 return result;
end; $$;

create function luna_sharing.member_json_v3(m luna_sharing.members) returns jsonb
language sql stable set search_path='' as $$
 select luna_sharing.member_json_v2(m)||jsonb_build_object('shareProfilePhoto',m.share_profile_photo);
$$;
create function public.sharing_list_members_v3(p_calendar_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c luna_sharing.calendars:=luna_sharing.lock_owner(p_calendar_id); members jsonb; invites jsonb;
begin
 select coalesce(jsonb_agg(luna_sharing.member_json_v3(m) order by m.requested_at,m.user_id),'[]'::jsonb) into members from luna_sharing.members m where m.calendar_id=p_calendar_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'expiresAt',i.expires_at,'consumedAt',i.consumed_at,'revokedAt',i.revoked_at,'rights',i.rights,'shareProfilePhoto',i.share_profile_photo,'joinedCount',(select count(*) from luna_sharing.invite_joins j where j.invite_id=i.id)) order by i.created_at,i.id),'[]'::jsonb) into invites from luna_sharing.invites i where i.calendar_id=p_calendar_id;
 return jsonb_build_object('members',members,'invites',invites);
end; $$;
create function public.sharing_set_member_profile_photo(p_calendar_id uuid,p_user_id uuid,p_allowed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c luna_sharing.calendars:=luna_sharing.lock_owner(p_calendar_id); m luna_sharing.members;
begin
 if p_allowed is null then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 update luna_sharing.members set share_profile_photo=p_allowed,updated_at=clock_timestamp()
  where calendar_id=p_calendar_id and user_id=p_user_id and status in ('PENDING','ACTIVE') returning * into m;
 if not found then raise exception using errcode='22023',message='SHARE_MEMBER_INVALID'; end if;
 return luna_sharing.member_json_v3(m);
end; $$;

-- Narrow projection, called only AFTER authorization. Never returns a document or its revision.
create function luna_sharing.current_profile_photo(p_owner_id uuid) returns text
language sql stable set search_path='' as $$
 select case when jsonb_typeof(s.document#>'{presentation,accountPhoto}')='string'
   and length(s.document#>>'{presentation,accountPhoto}') between 4 and 524288
   and length(s.document#>>'{presentation,accountPhoto}')%4=0
   and (s.document#>>'{presentation,accountPhoto}') ~ '^/9j/[A-Za-z0-9+/]*={0,2}$'
  then s.document#>>'{presentation,accountPhoto}' else null end
 from luna_private_cloud.accounts a join luna_private_cloud.snapshots s on s.user_id=a.user_id and s.revision=a.revision
 where a.user_id=p_owner_id;
$$;
create function public.sharing_get_profile_photo(p_calendar_id uuid,p_known_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=luna_sharing.require_actor(); c luna_sharing.calendars; m luna_sharing.members; image text; photo_key text; same boolean;
begin
 if p_known_key is not null and p_known_key !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='SHARE_INVALID_ARGUMENT'; end if;
 select * into c from luna_sharing.calendars where id=p_calendar_id for share;
 if not found then raise exception using errcode='42501',message='SHARE_NOT_FOUND'; end if;
 select * into m from luna_sharing.members where calendar_id=p_calendar_id and user_id=actor and status='ACTIVE' for share;
 if not found then raise exception using errcode='42501',message='SHARE_NOT_FOUND'; end if;
 if m.share_profile_photo then image:=luna_sharing.current_profile_photo(c.owner_id); end if;
 if image is not null then photo_key:=encode(extensions.digest(image,'sha256'),'hex'); end if;
 same:=photo_key is not null and photo_key=p_known_key;
 return jsonb_build_object('calendarId',p_calendar_id,'photoKey',photo_key,'image',case when same then null else image end,'unchanged',same);
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
      insert into luna_sharing.members(calendar_id,user_id,display_name,status,rights,share_profile_photo)
        values(c.id,actor,btrim(p_display_name),'ACTIVE',i.rights,i.share_profile_photo)
        on conflict(calendar_id,user_id) do update set display_name=excluded.display_name,status='ACTIVE',rights=i.rights,share_profile_photo=i.share_profile_photo,
          content_revision=luna_sharing.members.content_revision+case when i.rights is distinct from luna_sharing.members.rights then 1 else 0 end,
          requested_at=clock_timestamp(),updated_at=clock_timestamp() returning * into m;
    end if;
  elsif i.consumed_by=actor then
    select * into m from luna_sharing.members v where v.calendar_id=c.id and v.user_id=actor;
    if not found or m.status not in ('PENDING','ACTIVE') then raise exception using errcode='22023', message='SHARE_INVITE_INVALID'; end if;
  else
    update luna_sharing.invites set consumed_at=clock_timestamp(),consumed_by=actor where id=i.id;
    insert into luna_sharing.members(calendar_id,user_id,display_name,status,rights,share_profile_photo) values(c.id,actor,btrim(p_display_name),case when i.rights is not null then 'ACTIVE' else 'PENDING' end,i.rights,i.share_profile_photo)
      on conflict (calendar_id,user_id) do update set display_name=excluded.display_name,
        status=case when i.rights is not null or luna_sharing.members.status='ACTIVE' then 'ACTIVE' else 'PENDING' end,
        rights=coalesce(i.rights,luna_sharing.members.rights),share_profile_photo=i.share_profile_photo,
        content_revision=luna_sharing.members.content_revision+case when i.rights is not null and i.rights is distinct from luna_sharing.members.rights then 1 else 0 end,
        requested_at=clock_timestamp(),updated_at=clock_timestamp() returning * into m;
  end if;
  return jsonb_build_object('calendarId',c.id,'calendarName',c.name,'status',m.status);
end;
$$;



revoke all on function luna_sharing.clear_photo_consent(),luna_sharing.member_json_v3(luna_sharing.members),luna_sharing.current_profile_photo(uuid) from public,anon,authenticated;
revoke all on function public.sharing_profile_photo_capabilities(),public.sharing_create_invite_v3(uuid,uuid,jsonb,boolean),public.sharing_list_members_v3(uuid),public.sharing_set_member_profile_photo(uuid,uuid,boolean),public.sharing_get_profile_photo(uuid,text) from public,anon;
grant execute on function public.sharing_profile_photo_capabilities(),public.sharing_create_invite_v3(uuid,uuid,jsonb,boolean),public.sharing_list_members_v3(uuid),public.sharing_set_member_profile_photo(uuid,uuid,boolean),public.sharing_get_profile_photo(uuid,text) to authenticated;
commit;
