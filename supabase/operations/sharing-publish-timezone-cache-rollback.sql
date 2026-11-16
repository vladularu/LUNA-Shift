-- Emergency rollback for 20261116223556_sharing_publish_timezone_cache.
-- Restores the prior function body and its previous performance characteristics.
create or replace function public.sharing_publish_calendar(p_calendar_id uuid, p_device_id uuid, p_device_secret text, p_mutation_id uuid, p_expected_revision bigint, p_entries jsonb) returns jsonb
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
