begin;

create schema luna_private_cloud;
revoke all on schema luna_private_cloud from public, anon, authenticated;

create table luna_private_cloud.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);
create table luna_private_cloud.snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  mutation_id uuid not null,
  expected_revision bigint not null check (expected_revision >= 0),
  document jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, revision),
  unique (user_id, mutation_id),
  check (octet_length(document::text) <= 16777216)
);
alter table luna_private_cloud.accounts enable row level security;
alter table luna_private_cloud.snapshots enable row level security;
create table luna_private_cloud.mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  revision bigint not null,
  expected_revision bigint not null,
  document_digest text not null,
  updated_at timestamptz not null,
  primary key(user_id,mutation_id)
);
alter table luna_private_cloud.mutations enable row level security;
revoke all on all tables in schema luna_private_cloud from public, anon, authenticated;

create function luna_private_cloud.prune(p_actor uuid) returns void
language sql security definer set search_path = '' as $$
  delete from luna_private_cloud.snapshots s using (
    select revision,updated_at,row_number() over(
      partition by (updated_at at time zone 'Europe/Berlin')::date order by revision desc
    ) as rank from luna_private_cloud.snapshots
    where user_id=p_actor and revision<>(select revision from luna_private_cloud.accounts where user_id=p_actor)
  ) older
  where s.user_id=p_actor and s.revision=older.revision
    and (older.rank>1 or older.updated_at <
      (((now() at time zone 'Europe/Berlin')::date-29)::timestamp at time zone 'Europe/Berlin'));
$$;
revoke all on function luna_private_cloud.prune(uuid) from public,anon,authenticated;

create function public.private_cloud_retention() returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  for actor in select user_id from luna_private_cloud.accounts loop
    perform luna_private_cloud.prune(actor);
  end loop;
end;
$$;
revoke all on function public.private_cloud_retention() from public,anon,authenticated;
grant execute on function public.private_cloud_retention() to service_role;

create function luna_private_cloud.require_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := luna_sharing.require_actor();
begin
  if exists(select 1 from auth.identities where user_id=actor and provider='email')
     and not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception using errcode='42501', message='CLOUD_EMAIL_UNCONFIRMED';
  end if;
  return actor;
end;
$$;
revoke all on function luna_private_cloud.require_actor() from public,anon,authenticated;

create function public.private_cloud_read(p_expected_actor uuid, p_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_private_cloud.require_actor(); result jsonb;
begin
  if p_expected_actor is distinct from actor then
    raise exception using errcode='42501', message='CLOUD_ACCOUNT_CHANGED';
  end if;
  select jsonb_build_object('revision', s.revision, 'updatedAt', s.updated_at, 'document', s.document)
    into result from luna_private_cloud.snapshots s
    where s.user_id=actor and (p_revision is null or s.revision=p_revision)
    order by s.revision desc limit 1;
  return result;
end;
$$;

create function public.private_cloud_head(p_expected_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_private_cloud.require_actor(); result jsonb;
begin
  if p_expected_actor is distinct from actor then
    raise exception using errcode='42501', message='CLOUD_ACCOUNT_CHANGED';
  end if;
  select jsonb_build_object('revision',s.revision,'updatedAt',s.updated_at) into result
    from luna_private_cloud.snapshots s where s.user_id=actor order by s.revision desc limit 1;
  return result;
end;
$$;

create function public.private_cloud_history(p_expected_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_private_cloud.require_actor(); result jsonb;
begin
  if p_expected_actor is distinct from actor then
    raise exception using errcode='42501', message='CLOUD_ACCOUNT_CHANGED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('revision', s.revision, 'updatedAt', s.updated_at)
    order by s.revision desc), '[]'::jsonb) into result
    from (select revision,updated_at from luna_private_cloud.snapshots
          where user_id=actor order by revision desc limit 31) s;
  return result;
end;
$$;

create function public.private_cloud_write(
  p_expected_actor uuid, p_expected_revision bigint, p_mutation_id uuid, p_document jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := luna_private_cloud.require_actor(); current_revision bigint;
  receipt luna_private_cloud.mutations; next_revision bigint; document_digest text;
begin
  if p_expected_actor is distinct from actor then
    raise exception using errcode='42501', message='CLOUD_ACCOUNT_CHANGED';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision > 9007199254740990
     or p_mutation_id is null or p_document is null
     or jsonb_typeof(p_document) <> 'object'
     or p_document->>'format' is distinct from 'lunashift-private-cloud'
     or p_document->'version' is distinct from '1'::jsonb
     or jsonb_typeof(p_document->'data') is distinct from 'object'
     or jsonb_typeof(p_document->'presentation') is distinct from 'object'
     or octet_length(p_document::text)>16777216 then
    raise exception using errcode='22023', message='CLOUD_INVALID_DOCUMENT';
  end if;
  insert into luna_private_cloud.accounts(user_id) values(actor) on conflict do nothing;
  select revision into current_revision from luna_private_cloud.accounts where user_id=actor for update;
  document_digest := encode(extensions.digest(p_document::text,'sha256'),'hex');
  select * into receipt from luna_private_cloud.mutations where user_id=actor and mutation_id=p_mutation_id;
  if found then
    if receipt.expected_revision<>p_expected_revision or receipt.document_digest<>document_digest then
      raise exception using errcode='22023', message='CLOUD_MUTATION_REUSED';
    end if;
    return jsonb_build_object('revision',receipt.revision,'updatedAt',receipt.updated_at,'document',p_document);
  end if;
  if current_revision<>p_expected_revision then
    raise exception using errcode='40001', message='CLOUD_REVISION_CONFLICT';
  end if;
  next_revision := current_revision+1;
  insert into luna_private_cloud.snapshots(user_id,revision,mutation_id,expected_revision,document)
    values(actor,next_revision,p_mutation_id,p_expected_revision,p_document);
  insert into luna_private_cloud.mutations(user_id,mutation_id,revision,expected_revision,document_digest,updated_at)
    values(actor,p_mutation_id,next_revision,p_expected_revision,document_digest,now()) returning * into receipt;
  update luna_private_cloud.accounts set revision=next_revision where user_id=actor;
  perform luna_private_cloud.prune(actor);
  return jsonb_build_object('revision',receipt.revision,'updatedAt',receipt.updated_at,'document',p_document);
end;
$$;

revoke all on function public.private_cloud_head(uuid), public.private_cloud_read(uuid,bigint),
  public.private_cloud_history(uuid), public.private_cloud_write(uuid,bigint,uuid,jsonb)
  from public,anon;
grant execute on function public.private_cloud_head(uuid), public.private_cloud_read(uuid,bigint),
  public.private_cloud_history(uuid), public.private_cloud_write(uuid,bigint,uuid,jsonb)
  to authenticated;

commit;
