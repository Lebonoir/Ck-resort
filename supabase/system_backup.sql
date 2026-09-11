-- CK Resort · Settings → Backup & restore.
-- Run after schema.sql, booking_lifecycle.sql, booking_rules.sql and admin_extras.sql.
--
-- A backup is a JSON snapshot of the resort's business data. Snapshots are kept
-- in public.system_backups and can also be downloaded as a file. Restoring
-- replaces reservations with the snapshot's and sets rates/settings back, inside
-- one transaction, after first saving an automatic "Before restore" snapshot.
--
-- Not restored: login accounts (Supabase Auth), notifications, and the audit
-- trail, which is never rewritten. Accounts and audit rows are still written to
-- the backup for reference. Restores target the same project a backup came from.

create table if not exists public.system_backups (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  kind text not null default 'manual' check (kind in ('manual', 'auto')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  counts jsonb not null default '{}'::jsonb,
  size_bytes int not null default 0,
  payload jsonb not null
);

create index if not exists system_backups_created_idx on public.system_backups (created_at desc);

alter table public.system_backups enable row level security;

drop policy if exists backups_admin on public.system_backups;
create policy backups_admin on public.system_backups for select to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------- snapshot --
create or replace function public.build_backup_payload()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tbl text;
  v_rows jsonb;
  v_tables jsonb := '{}'::jsonb;
begin
  foreach tbl in array array[
    'app_settings', 'rate_settings', 'overnight_tiers', 'event_bands', 'tour_hour_rates',
    'rooms', 'room_units', 'rentals', 'caterers', 'resort_closures',
    'bookings', 'booking_rooms', 'booking_rentals', 'booking_charges', 'payments',
    'rental_dispatches', 'booking_reviews', 'profiles', 'audit_logs'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', tbl) into v_rows;
    -- The PayMongo confirmation secret must never leave the database in a file.
    if tbl = 'app_settings' then
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows) e
      where e->>'key' <> 'internal_api_secret';
    end if;
    v_tables := v_tables || jsonb_build_object(tbl, v_rows);
  end loop;

  return jsonb_build_object(
    'format', 'ck-resort-backup',
    'version', 1,
    'created_at', now(),
    'tables', v_tables
  );
end;
$$;

create or replace function public.backup_counts(p_payload jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(key, jsonb_array_length(value)), '{}'::jsonb)
  from jsonb_each(coalesce(p_payload->'tables', '{}'::jsonb))
  where jsonb_typeof(value) = 'array'
$$;

create or replace function public.admin_create_backup(p_label text default null, p_kind text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_kind text := case when p_kind = 'auto' then 'auto' else 'manual' end;
  row public.system_backups;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;

  v_payload := public.build_backup_payload();

  insert into public.system_backups (label, kind, created_by, counts, size_bytes, payload)
  values (
    coalesce(nullif(trim(p_label), ''), case when v_kind = 'auto' then 'Automatic backup' else 'Manual backup' end),
    v_kind,
    auth.uid(),
    public.backup_counts(v_payload),
    octet_length(v_payload::text),
    v_payload
  )
  returning * into row;

  -- Keep automatic snapshots from piling up; manual ones are only removed by an admin.
  if v_kind = 'auto' then
    delete from public.system_backups
    where kind = 'auto'
      and id not in (
        select id from public.system_backups where kind = 'auto' order by created_at desc limit 10
      );
  end if;

  perform public.audit('create_backup', 'system', row.id, jsonb_build_object('label', row.label, 'kind', row.kind));

  return jsonb_build_object(
    'id', row.id,
    'label', row.label,
    'kind', row.kind,
    'created_at', row.created_at,
    'counts', row.counts,
    'size_bytes', row.size_bytes
  );
end;
$$;

create or replace function public.admin_list_backups()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'label', b.label,
      'kind', b.kind,
      'created_at', b.created_at,
      'counts', b.counts,
      'size_bytes', b.size_bytes,
      'created_by_name', coalesce(nullif(trim(p.first_name || ' ' || coalesce(p.last_name, '')), ''), p.email, 'System')
    ) order by b.created_at desc), '[]'::jsonb)
    from public.system_backups b
    left join public.profiles p on p.id = b.created_by
  );
end;
$$;

create or replace function public.admin_get_backup(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select payload into v_payload from public.system_backups where id = p_id;
  if v_payload is null then raise exception 'Backup not found'; end if;
  perform public.audit('download_backup', 'system', p_id, '{}'::jsonb);
  return v_payload;
end;
$$;

create or replace function public.admin_delete_backup(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.system_backups;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.system_backups where id = p_id returning * into row;
  if not found then raise exception 'Backup not found'; end if;
  perform public.audit('delete_backup', 'system', p_id, jsonb_build_object('label', row.label));
  return jsonb_build_object('id', p_id, 'deleted', true);
end;
$$;

-- -------------------------------------------------------------- restore --
-- Update-in-place for settings, price lists and catalog rows. Column list comes
-- from the live table, so a snapshot taken on this schema maps one-to-one.
create or replace function public.restore_upsert(p_table text, p_keys text[], p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set text;
  v_count int := 0;
begin
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or to_regclass('public.' || p_table) is null then
    return 0;
  end if;

  select string_agg(format('%I = excluded.%I', c.column_name, c.column_name), ', ')
    into v_set
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and c.column_name <> all (p_keys);

  execute format(
    'insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%2$s) do %3$s',
    p_table,
    (select string_agg(format('%I', k), ', ') from unnest(p_keys) k),
    case when v_set is null then 'nothing' else 'update set ' || v_set end
  ) using p_rows;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Plain insert for reservation data. References to accounts that no longer
-- exist are cleared rather than failing the whole restore.
create or replace function public.restore_insert(p_table text, p_rows jsonb, p_profile_cols text[] default '{}')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  col text;
  v_count int := 0;
begin
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or to_regclass('public.' || p_table) is null then
    return 0;
  end if;

  drop table if exists pg_temp.restore_rows;
  execute format('create temp table restore_rows (like public.%I) on commit drop', p_table);
  execute format('insert into restore_rows select * from jsonb_populate_recordset(null::public.%I, $1)', p_table)
    using p_rows;

  foreach col in array coalesce(p_profile_cols, '{}'::text[])
  loop
    execute format(
      'update restore_rows set %1$I = null where %1$I is not null and not exists (select 1 from public.profiles p where p.id = restore_rows.%1$I)',
      col
    );
  end loop;

  execute format('insert into public.%I select * from restore_rows', p_table);
  get diagnostics v_count = row_count;
  drop table if exists pg_temp.restore_rows;
  return v_count;
end;
$$;

create or replace function public.restore_backup_payload(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t jsonb := p_payload->'tables';
  v_rows jsonb;
  v_max bigint;
  v_counts jsonb;
begin
  if coalesce(p_payload->>'format', '') <> 'ck-resort-backup' or jsonb_typeof(t) is distinct from 'object' then
    raise exception 'This is not a CK Resort backup';
  end if;

  -- 1. Settings and price lists are set back to the snapshot's values.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(t->'app_settings', '[]'::jsonb)) e
  where e->>'key' <> 'internal_api_secret';
  perform public.restore_upsert('app_settings', array['key'], v_rows);
  perform public.restore_upsert('rate_settings', array['key'], t->'rate_settings');
  perform public.restore_upsert('overnight_tiers', array['pax_cap'], t->'overnight_tiers');
  perform public.restore_upsert('event_bands', array['max_pax'], t->'event_bands');
  perform public.restore_upsert('tour_hour_rates', array['tour_type', 'hours'], t->'tour_hour_rates');

  -- 2. Catalog. Parent suites go first (Sunrise requires Gazebo). Room units come
  --    back unlinked from any stay and are re-attached once bookings exist.
  select coalesce(jsonb_agg(e order by (e->>'requires_room_id') is not null), '[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(t->'rooms', '[]'::jsonb)) e;
  perform public.restore_upsert('rooms', array['id'], v_rows);
  perform public.restore_upsert('rentals', array['id'], t->'rentals');
  perform public.restore_upsert('caterers', array['id'], t->'caterers');
  select coalesce(jsonb_agg(e - 'current_booking_id'), '[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(t->'room_units', '[]'::jsonb)) e;
  perform public.restore_upsert('room_units', array['id'], v_rows);

  -- 3. Reservations are replaced wholesale. Deleting bookings cascades to their
  --    rooms, rentals, charges, payments, rental logs, ratings and notifications.
  delete from public.bookings where true;
  if to_regclass('public.resort_closures') is not null then
    delete from public.resort_closures where true;
  end if;

  perform public.restore_insert('bookings', t->'bookings',
    array['guest_id', 'created_by', 'approved_by', 'checked_in_by', 'checked_out_by']);
  perform public.restore_insert('booking_rooms', t->'booking_rooms');
  perform public.restore_insert('booking_rentals', t->'booking_rentals');
  perform public.restore_insert('booking_charges', t->'booking_charges', array['created_by']);
  perform public.restore_insert('payments', t->'payments', array['received_by']);
  perform public.restore_insert('rental_dispatches', t->'rental_dispatches', array['dispatched_by', 'returned_by']);
  perform public.restore_insert('booking_reviews', t->'booking_reviews', array['guest_id']);
  perform public.restore_insert('resort_closures', t->'resort_closures', array['created_by']);

  update public.room_units u
  set current_booking_id = (e->>'current_booking_id')::uuid
  from jsonb_array_elements(coalesce(t->'room_units', '[]'::jsonb)) e
  where u.id = (e->>'id')::uuid
    and nullif(e->>'current_booking_id', '') is not null
    and exists (select 1 from public.bookings b where b.id = (e->>'current_booking_id')::uuid);

  -- 4. Booking references and official receipt numbers only ever move forward,
  --    so a number handed out after the snapshot is never issued twice.
  select max(substring(reference from '(\d+)$')::bigint) into v_max
  from public.bookings where reference ~ '\d+$';
  if v_max is not null then
    perform setval('public.booking_ref_seq', greatest(v_max, (select last_value from public.booking_ref_seq)));
  end if;

  select max(substring(receipt_no from '(\d+)$')::bigint) into v_max
  from public.payments where receipt_no ~ '\d+$';
  if v_max is not null then
    perform setval('public.receipt_seq', greatest(v_max, (select last_value from public.receipt_seq)));
  end if;

  v_counts := public.backup_counts(p_payload);
  perform public.audit('restore_backup', 'system', null,
    jsonb_build_object('backup_created_at', p_payload->>'created_at', 'counts', v_counts));

  return jsonb_build_object('restored', true, 'counts', v_counts, 'backup_created_at', p_payload->>'created_at');
end;
$$;

create or replace function public.admin_restore_backup(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_safety jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select payload into v_payload from public.system_backups where id = p_id;
  if v_payload is null then raise exception 'Backup not found'; end if;
  -- Same transaction: if the restore fails, this safety snapshot rolls back too.
  v_safety := public.admin_create_backup('Before restore', 'auto');
  return public.restore_backup_payload(v_payload) || jsonb_build_object('safety_backup', v_safety->'id');
end;
$$;

create or replace function public.admin_restore_backup_payload(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_safety jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_payload->>'format', '') <> 'ck-resort-backup' then
    raise exception 'This file is not a CK Resort backup';
  end if;
  v_safety := public.admin_create_backup('Before restore', 'auto');
  return public.restore_backup_payload(p_payload) || jsonb_build_object('safety_backup', v_safety->'id');
end;
$$;

-- create-or-replace grants EXECUTE to PUBLIC by default. The internal helpers
-- can rewrite any table, so only the admin-checked wrappers stay callable.
revoke all on function public.build_backup_payload() from public, anon, authenticated;
revoke all on function public.backup_counts(jsonb) from public, anon, authenticated;
revoke all on function public.restore_upsert(text, text[], jsonb) from public, anon, authenticated;
revoke all on function public.restore_insert(text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.restore_backup_payload(jsonb) from public, anon, authenticated;

grant execute on function public.admin_create_backup(text, text) to authenticated;
grant execute on function public.admin_list_backups() to authenticated;
grant execute on function public.admin_get_backup(uuid) to authenticated;
grant execute on function public.admin_delete_backup(uuid) to authenticated;
grant execute on function public.admin_restore_backup(uuid) to authenticated;
grant execute on function public.admin_restore_backup_payload(jsonb) to authenticated;

notify pgrst, 'reload schema';
