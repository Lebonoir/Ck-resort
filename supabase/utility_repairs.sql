-- CK Resort · repair workflow for utility monitoring.
-- Run in the Supabase SQL Editor AFTER resort_ops.sql. Safe to re-run.
--
--   Report        staff or front desk mark a fixture "needs repair" or
--                 "missing" -> it is BROKEN; if it belongs to a room, that
--                 room closes to new bookings
--   Start fixing  operations staff only -> BEING FIXED
--   Fixed         operations staff only -> working again; the room reopens
--                 once nothing else in it is reported
--
-- The front desk can only report. The manager only watches: broken, being
-- fixed and recently fixed all show in Property issues.

-- ------------------------------------------------------------- 1. schema --
alter table public.utility_items drop constraint if exists utility_items_status_check;
alter table public.utility_items
  add constraint utility_items_status_check check (status in ('ok', 'issue', 'missing', 'fixing'));

alter table public.utility_checks drop constraint if exists utility_checks_status_check;
alter table public.utility_checks
  add constraint utility_checks_status_check check (status in ('ok', 'issue', 'missing', 'fixing'));

alter table public.utility_items
  add column if not exists repair_started_at timestamptz,
  add column if not exists repair_started_by uuid references public.profiles (id) on delete set null;

-- Read by the public catalog, so guests stop being offered the room.
alter table public.room_units add column if not exists under_repair boolean not null default false;

-- Repairs are the operations staff's job, not the front desk's or the manager's.
create or replace function public.is_repair_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'staff' and is_active from public.profiles where id = auth.uid()), false)
$$;

-- --------------------------------------------- 2. room follows its fixtures --
create or replace function public.sync_room_repair(p_unit uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.room_units u
  set under_repair = exists (
    select 1 from public.utility_items i
    where i.room_unit_id = u.id and i.is_active and i.status <> 'ok'
  )
  where u.id = p_unit
$$;

create or replace function public.utility_items_sync_repair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.room_unit_id is not null then
    perform public.sync_room_repair(old.room_unit_id);
  end if;
  if tg_op <> 'DELETE' and new.room_unit_id is not null then
    perform public.sync_room_repair(new.room_unit_id);
  end if;
  return null;
end;
$$;

drop trigger if exists utility_items_sync_repair on public.utility_items;
create trigger utility_items_sync_repair
after insert or delete or update of status, is_active, room_unit_id on public.utility_items
for each row execute procedure public.utility_items_sync_repair();

update public.room_units u
set under_repair = exists (
  select 1 from public.utility_items i
  where i.room_unit_id = u.id and i.is_active and i.status <> 'ok'
)
where true;

-- ------------------------------------------- 3. no new booking on the room --
-- Only bookings created in this same transaction are checked (created_at is
-- the transaction time), so a backup restore can still re-attach old rooms.
create or replace function public.booking_rooms_block_repair()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created timestamptz;
  v_room text;
begin
  select b.created_at into v_created from public.bookings b where b.id = new.booking_id;
  if v_created is distinct from now() then
    return new;
  end if;
  select rm.name || ' ' || u.name into v_room
  from public.room_units u
  join public.rooms rm on rm.id = u.room_id
  where u.id = new.room_unit_id and u.under_repair;
  if found then
    raise exception '% is closed for repair. Please pick another room', v_room;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_rooms_block_repair on public.booking_rooms;
create trigger booking_rooms_block_repair
before insert on public.booking_rooms
for each row execute procedure public.booking_rooms_block_repair();

-- ------------------------------------------------------- 4. report / fixed --
create or replace function public.set_utility_status(
  p_item uuid,
  p_status text,
  p_note text default '',
  p_proof_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.utility_items;
  v_old text;
  v_proof text := case when p_status = 'ok' then null else nullif(trim(coalesce(p_proof_url, '')), '') end;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  if p_status not in ('ok', 'issue', 'missing') then raise exception 'Unknown status'; end if;
  if p_status <> 'ok' and coalesce(trim(p_note), '') = '' then
    raise exception 'Add a short note about what is wrong';
  end if;

  select status into v_old from public.utility_items where id = p_item for update;
  if not found then raise exception 'Item not found'; end if;
  if p_status = 'ok' and v_old <> 'ok' then
    if not public.is_repair_staff() then
      raise exception 'Only operations staff can mark a repair as fixed';
    end if;
    if v_old <> 'fixing' then
      raise exception 'Press "Start fixing" on this report before marking it fixed';
    end if;
  end if;

  update public.utility_items
  set status = p_status,
      note = coalesce(trim(p_note), ''),
      proof_url = v_proof,
      checked_by = auth.uid(),
      checked_at = now(),
      repair_started_at = null,
      repair_started_by = null
  where id = p_item
  returning * into it;

  insert into public.utility_checks (item_id, status, note, proof_url, checked_by)
  values (p_item, p_status, coalesce(trim(p_note), ''), v_proof, auth.uid());

  if p_status <> 'ok' then
    perform public.notify_admins(
      'Reported broken · ' || it.area,
      it.name || ' marked ' || case when p_status = 'missing' then 'missing' else 'needs repair' end || '. ' || it.note
        || case when it.room_unit_id is not null then ' The room is closed to new bookings until it is fixed.' else '' end,
      null
    );
  elsif v_old = 'fixing' then
    perform public.notify_admins(
      'Repair finished · ' || it.area,
      it.name || ' is working again.'
        || case
             when it.room_unit_id is null then ''
             when exists (select 1 from public.room_units u where u.id = it.room_unit_id and u.under_repair)
               then ' The room stays closed: another fixture in it is still reported.'
             else ' The room is open for booking again.'
           end,
      null
    );
  end if;
  return to_jsonb(it);
end;
$$;

-- ------------------------------------------- 5. operations: start fixing --
create or replace function public.start_utility_repair(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.utility_items;
begin
  if not public.is_repair_staff() then raise exception 'Only operations staff can start a repair'; end if;
  select * into it from public.utility_items where id = p_item for update;
  if not found then raise exception 'Item not found'; end if;
  if it.status = 'fixing' then raise exception 'This repair is already under way'; end if;
  if it.status = 'ok' then raise exception 'This fixture is not reported as broken or missing'; end if;

  update public.utility_items
  set status = 'fixing', repair_started_at = now(), repair_started_by = auth.uid()
  where id = p_item
  returning * into it;

  insert into public.utility_checks (item_id, status, note, proof_url, checked_by)
  values (p_item, 'fixing', 'Repair started', null, auth.uid());

  perform public.notify_admins(
    'Repair started · ' || it.area,
    it.name || ' is being fixed.'
      || case when it.room_unit_id is not null then ' The room stays closed until it is marked fixed.' else '' end,
    null
  );
  perform public.audit('start_utility_repair', 'utility_item', it.id,
    jsonb_build_object('area', it.area, 'name', it.name));
  return to_jsonb(it);
end;
$$;

-- ---------------------------------------------------------- 6. overview --
create or replace function public.utility_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  return jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(item order by (item->>'area_sort')::int, item->>'area', (item->>'sort_order')::int), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', u.id,
          'area', u.area,
          'area_sort', u.area_sort,
          'sort_order', u.sort_order,
          'room_unit_id', u.room_unit_id,
          'name', u.name,
          'status', u.status,
          'note', u.note,
          'proof_url', u.proof_url,
          'checked_at', u.checked_at,
          'checked_by', nullif(trim(p.first_name || ' ' || p.last_name), ''),
          'repair_started_at', u.repair_started_at,
          'repair_started_by', nullif(trim(f.first_name || ' ' || f.last_name), '')
        ) as item
        from public.utility_items u
        left join public.profiles p on p.id = u.checked_by
        left join public.profiles f on f.id = u.repair_started_by
        where u.is_active
      ) rows
    ),
    -- Finished repairs: a "working" check that closed an open report.
    'done', (
      select coalesce(jsonb_agg(item order by (item->>'fixed_at') desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', c.id,
          'area', u.area,
          'name', u.name,
          'fixed_at', c.created_at,
          'fixed_by', coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), 'Staff'),
          'note', (
            select r.note from public.utility_checks r
            where r.item_id = c.item_id and r.status in ('issue', 'missing') and r.created_at <= c.created_at
            order by r.created_at desc limit 1
          )
        ) as item
        from (
          select k.*, lag(k.status) over (partition by k.item_id order by k.created_at) as prev_status
          from public.utility_checks k
        ) c
        join public.utility_items u on u.id = c.item_id
        left join public.profiles p on p.id = c.checked_by
        where c.status = 'ok' and c.prev_status in ('issue', 'missing', 'fixing')
        order by c.created_at desc
        limit 30
      ) rows
    ),
    'log', (
      select coalesce(jsonb_agg(item order by (item->>'created_at') desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', c.id,
          'area', u.area,
          'name', u.name,
          'status', c.status,
          'note', c.note,
          'proof_url', c.proof_url,
          'created_at', c.created_at,
          'by', coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), 'Staff')
        ) as item
        from public.utility_checks c
        join public.utility_items u on u.id = c.item_id
        left join public.profiles p on p.id = c.checked_by
        order by c.created_at desc
        limit 100
      ) rows
    )
  );
end;
$$;

-- ------------------------------------------------------------ 7. grants --
grant execute on function public.set_utility_status(uuid, text, text, text) to authenticated;
grant execute on function public.start_utility_repair(uuid) to authenticated;
grant execute on function public.utility_overview() to authenticated;
grant execute on function public.is_repair_staff() to authenticated;
revoke all on function public.sync_room_repair(uuid) from public, anon, authenticated;
revoke all on function public.utility_items_sync_repair() from public, anon, authenticated;
revoke all on function public.booking_rooms_block_repair() from public, anon, authenticated;
