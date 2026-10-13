-- Private invalidations contain no calendar data. Existing RPC authorization remains authoritative.
begin;
create policy luna_sharing_receive_invalidations on realtime.messages
for select to authenticated using (
  extension = 'broadcast' and realtime.topic() = 'sharing:' || (select auth.uid())::text
  and topic = 'sharing:' || (select auth.uid())::text
);

create function luna_sharing.notify_calendar_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_calendar_id uuid; v_owner_id uuid; recipient uuid;
begin
  if TG_TABLE_NAME = 'calendars' then
    v_calendar_id := coalesce(new.id, old.id);
    v_owner_id := coalesce(new.owner_id, old.owner_id);
    for recipient in
      select v_owner_id union select m.user_id from luna_sharing.members m
      where m.calendar_id = v_calendar_id and m.status = 'ACTIVE'
    loop
      perform realtime.send('{}'::jsonb, 'changed', 'sharing:' || recipient::text, true);
    end loop;
  else
    v_calendar_id := coalesce(new.calendar_id, old.calendar_id);
    select c.owner_id into v_owner_id from luna_sharing.calendars c where c.id = v_calendar_id;
    recipient := coalesce(new.user_id, old.user_id);
    perform realtime.send('{}'::jsonb, 'changed', 'sharing:' || recipient::text, true);
    if v_owner_id is not null then
      perform realtime.send('{}'::jsonb, 'changed', 'sharing:' || v_owner_id::text, true);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function luna_sharing.notify_calendar_change() from public, anon, authenticated;
-- BEFORE DELETE preserves membership recipients before cascading deletes.
create trigger sharing_calendar_invalidate before delete or update on luna_sharing.calendars
for each row execute function luna_sharing.notify_calendar_change();
create trigger sharing_member_invalidate after insert or update or delete on luna_sharing.members
for each row execute function luna_sharing.notify_calendar_change();
commit;
