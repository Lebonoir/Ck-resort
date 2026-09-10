-- CK Resort · audit trail, guest reviews, and time-based automation.
-- Run after schema.sql, booking_lifecycle.sql and booking_rules.sql.

-- ---------------------------------------------------------------- reviews --
create table if not exists public.booking_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  guest_id uuid references public.profiles (id),
  overall int not null check (overall between 1 and 5),
  cleanliness int not null check (cleanliness between 1 and 5),
  amenities int not null check (amenities between 1 and 5),
  staff int not null check (staff between 1 and 5),
  value_rating int not null check (value_rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists reviews_created_idx on public.booking_reviews (created_at desc);

alter table public.booking_reviews enable row level security;

drop policy if exists reviews_select on public.booking_reviews;
create policy reviews_select on public.booking_reviews for select to authenticated
  using (guest_id = auth.uid() or public.is_ops());

-- A guest may review a stay once, only after it is finished, and only their own.
create or replace function public.submit_review(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  row public.booking_reviews;
  v_booking uuid := (payload->>'booking_id')::uuid;
begin
  select * into b from public.bookings where id = v_booking;
  if not found then
    raise exception 'Booking not found';
  end if;
  if b.guest_id is distinct from auth.uid() then
    raise exception 'You can only review your own stay';
  end if;
  if b.status <> 'completed' then
    raise exception 'You can rate this stay once it is completed';
  end if;
  if exists (select 1 from public.booking_reviews r where r.booking_id = v_booking) then
    raise exception 'This stay has already been rated';
  end if;

  insert into public.booking_reviews (
    booking_id, guest_id, overall, cleanliness, amenities, staff, value_rating, comment
  )
  values (
    v_booking,
    auth.uid(),
    greatest(least((payload->>'overall')::int, 5), 1),
    greatest(least((payload->>'cleanliness')::int, 5), 1),
    greatest(least((payload->>'amenities')::int, 5), 1),
    greatest(least((payload->>'staff')::int, 5), 1),
    greatest(least((payload->>'value_rating')::int, 5), 1),
    coalesce(trim(payload->>'comment'), '')
  )
  returning * into row;

  perform public.notify_admins_once(
    'New guest rating',
    b.reference || ' rated their stay ' || row.overall || '/5.',
    b.id
  );
  perform public.audit('submit_review', 'booking', b.id, jsonb_build_object('overall', row.overall));
  return to_jsonb(row);
end;
$$;

-- Completed stays belonging to the caller that still have no rating.
create or replace function public.guest_reviewable()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'reference', b.reference,
    'package_label', b.package_label,
    'stay_date', b.stay_date
  ) order by b.stay_date desc), '[]'::jsonb)
  from public.bookings b
  where b.guest_id = auth.uid()
    and b.status = 'completed'
    and not exists (select 1 from public.booking_reviews r where r.booking_id = b.id)
$$;

create or replace function public.admin_review_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  select count(*) into v_total from public.booking_reviews;
  return jsonb_build_object(
    'total', v_total,
    'averages', (
      select jsonb_build_object(
        'overall', round(coalesce(avg(overall), 0)::numeric, 2),
        'cleanliness', round(coalesce(avg(cleanliness), 0)::numeric, 2),
        'amenities', round(coalesce(avg(amenities), 0)::numeric, 2),
        'staff', round(coalesce(avg(staff), 0)::numeric, 2),
        'value_rating', round(coalesce(avg(value_rating), 0)::numeric, 2)
      )
      from public.booking_reviews
    ),
    'distribution', (
      select coalesce(jsonb_object_agg(score::text, tally), '{}'::jsonb)
      from (
        select overall as score, count(*) as tally
        from public.booking_reviews group by overall
      ) d
    ),
    'recent', (
      select coalesce(jsonb_agg(item order by item->>'created_at' desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'reference', b.reference,
          'guest', b.guest_name,
          'overall', r.overall,
          'comment', r.comment,
          'created_at', r.created_at
        ) as item
        from public.booking_reviews r
        join public.bookings b on b.id = r.booking_id
        order by r.created_at desc
        limit 20
      ) recent_rows
    )
  );
end;
$$;

-- ------------------------------------------------------------ audit trail --
create or replace function public.admin_audit_log(
  p_limit int default 200,
  p_action text default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return (
    select coalesce(jsonb_agg(item), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'entity', a.entity,
        'entity_id', a.entity_id,
        'meta', a.meta,
        'created_at', a.created_at,
        'actor_name', coalesce(nullif(trim(p.first_name || ' ' || coalesce(p.last_name, '')), ''), p.email, 'System'),
        'actor_role', coalesce(p.role::text, 'system'),
        'actor_email', p.email,
        'reference', b.reference
      ) as item
      from public.audit_logs a
      left join public.profiles p on p.id = a.actor_id
      left join public.bookings b on b.id = a.entity_id
      where (p_action is null or a.action = p_action)
        and (p_from is null or a.created_at >= p_from::timestamptz)
        and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
      order by a.created_at desc
      limit greatest(least(coalesce(p_limit, 200), 500), 1)
    ) rows
  );
end;
$$;

-- Distinct action names, so the filter dropdown reflects real activity.
create or replace function public.admin_audit_actions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return (
    select coalesce(jsonb_agg(action order by action), '[]'::jsonb)
    from (select distinct action from public.audit_logs) a
  );
end;
$$;

-- ------------------------------------------------------- time automation --
-- Scheduled end of the stay, including extra hours bought at the counter.
create or replace function public.booking_effective_end(b public.bookings)
returns timestamptz
language sql
stable
as $$
  select public.booking_ends_at(b) + (coalesce(b.checkin_extra_hours, 0) || ' hours')::interval
$$;

-- Extra hours sold after arrival must both bill the guest AND push the
-- scheduled end out, or auto checkout would end a stay that was just extended.
create or replace function public.add_extra_hours(p_booking uuid, p_hours int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_rate numeric;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  if coalesce(p_hours, 0) < 1 then raise exception 'Add at least one hour'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.status not in ('confirmed', 'checked_in', 'checked_out') then
    raise exception 'Extra hours can only be added to an active stay';
  end if;

  v_rate := public.rate_amount('extra_hour');

  -- Only bump the counter: booking_final_bill() already prices
  -- checkin_extra_hours, so adding a charge row too would bill it twice.
  update public.bookings as bk
  set checkin_extra_hours = coalesce(bk.checkin_extra_hours, 0) + p_hours
  where bk.id = p_booking
  returning * into b;

  -- Keep the housekeeping view honest about when the room frees up.
  update public.room_units as ru
  set check_out_at = public.booking_effective_end(b)
  where ru.current_booking_id = p_booking and ru.status = 'occupied';

  perform public.audit('add_extra_hours', 'booking', p_booking, jsonb_build_object('hours', p_hours, 'amount', v_rate * p_hours));
  return jsonb_build_object('booking', to_jsonb(b), 'amount', v_rate * p_hours);
end;
$$;

create or replace function public.notify_ops_once(p_title text, p_body text, p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  for target in
    select id from public.profiles where role in ('front_desk', 'admin') and is_active
  loop
    perform public.notify_once(target, p_title, p_body, p_booking);
  end loop;
end;
$$;

create or replace function public.process_booking_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  u public.room_units;
  v_grace interval;
  v_dp_window interval;
  processed int := 0;
begin
  v_grace := (coalesce(public.setting('no_show_grace_minutes', '120'), '120') || ' minutes')::interval;
  v_dp_window := (coalesce(public.setting('downpayment_hours', '48'), '48') || ' hours')::interval;

  for b in
    select * from public.bookings as bk
    where bk.status = 'pending_approval'
      and (
        bk.stay_date < public.manila_today()
        or now() > public.booking_ends_at(bk)
      )
    for update skip locked
  loop
    update public.bookings as bk
    set status = 'expired', expired_at = coalesce(bk.expired_at, now())
    where bk.id = b.id;
    perform public.notify_once(b.guest_id, 'Booking expired', b.reference || ' expired because it was not approved in time.', b.id);
    perform public.notify_admins_once('Booking expired', b.reference || ' was still pending after the stay window.', b.id);
    processed := processed + 1;
  end loop;

  for b in
    select * from public.bookings as bk
    where bk.status = 'awaiting_downpayment'
      and now() > least(
        coalesce(bk.payment_due_at, bk.approved_at + v_dp_window, bk.created_at + v_dp_window),
        public.booking_starts_at(bk)
      )
    for update skip locked
  loop
    update public.payments as pay
    set status = 'failed'
    where pay.booking_id = b.id and pay.status = 'pending';
    update public.bookings as bk
    set status = 'expired', expired_at = coalesce(bk.expired_at, now())
    where bk.id = b.id;
    perform public.notify_once(b.guest_id, 'Booking expired', b.reference || ' expired because the downpayment was not completed in time.', b.id);
    perform public.notify_admins_once('Downpayment expired', b.reference || ' did not complete PayMongo payment in time.', b.id);
    processed := processed + 1;
  end loop;

  for b in
    select * from public.bookings as bk
    where bk.status = 'confirmed'
      and not bk.is_walk_in
      and now() > public.booking_starts_at(bk) + v_grace
    for update skip locked
  loop
    perform public.apply_no_show_policy(b.id);
    update public.bookings as bk
    set status = 'no_show', expired_at = coalesce(bk.expired_at, now())
    where bk.id = b.id;
    perform public.notify_once(b.guest_id, 'Marked as no-show', b.reference || ' was marked no-show after the arrival window. The remaining package balance is not due.', b.id);
    perform public.notify_admins_once('Guest no-show', b.reference || ' · ' || b.guest_name, b.id);
    processed := processed + 1;
  end loop;

  -- A stay whose window has elapsed with nothing left to pay checks itself out.
  -- If money is still owed the desk is told instead: cash cannot be auto-collected.
  for b in
    select * from public.bookings as bk
    where bk.status = 'checked_in'
      and now() > public.booking_effective_end(bk)
    for update skip locked
  loop
    if public.booking_amount_due(b.id) = 0 then
      update public.bookings as bk
      set status = 'checked_out',
          checked_out_at = coalesce(bk.checked_out_at, now())
      where bk.id = b.id;
      update public.room_units as ru
      set status = 'cleaning',
          turnaround_until = now() + interval '25 minutes',
          check_out_at = now()
      where ru.current_booking_id = b.id and ru.status = 'occupied';
      perform public.notify_once(b.guest_id, 'Checked out', b.reference || ' reached its scheduled end time and was checked out automatically.', b.id);
      perform public.notify_ops_once('Auto checkout', b.reference || ' · ' || b.guest_name || ' ended on schedule. Rooms moved to cleaning.', b.id);
      processed := processed + 1;
    else
      perform public.notify_ops_once(
        'Stay ended · balance due',
        b.reference || ' · ' || b.guest_name || ' passed its end time with an unpaid balance. Collect at the counter.',
        b.id
      );
    end if;
  end loop;

  for b in
    select * from public.bookings as bk
    where bk.status = 'checked_out'
      and public.booking_amount_due(bk.id) = 0
    for update skip locked
  loop
    update public.bookings as bk set status = 'completed' where bk.id = b.id;
    perform public.notify_once(b.guest_id, 'Stay completed', b.reference || ' is complete. Thank you for visiting CK Resort.', b.id);
    processed := processed + 1;
  end loop;

  -- Housekeeping turnaround finishes on its own once the timer runs out.
  for u in
    select * from public.room_units as ru
    where ru.status = 'cleaning'
      and ru.turnaround_until is not null
      and now() > ru.turnaround_until
    for update skip locked
  loop
    update public.room_units as ru
    set status = 'available',
        turnaround_until = null,
        current_booking_id = null,
        check_in_at = null,
        check_out_at = null
    where ru.id = u.id;
    processed := processed + 1;
  end loop;

  return jsonb_build_object('processed', processed);
end;
$$;

-- Realtime: the workspaces subscribe to these so screens refresh without a
-- manual reload when the lifecycle (or another user) changes a row.
do $$
declare
  t text;
begin
  foreach t in array array['bookings', 'room_units', 'notifications', 'rental_dispatches', 'booking_reviews']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

alter table public.bookings replica identity full;
alter table public.room_units replica identity full;
alter table public.notifications replica identity full;

grant execute on function public.submit_review(jsonb) to authenticated;
grant execute on function public.guest_reviewable() to authenticated;
grant execute on function public.admin_review_stats() to authenticated;
grant execute on function public.admin_audit_log(int, text, date, date) to authenticated;
grant execute on function public.admin_audit_actions() to authenticated;
grant execute on function public.booking_effective_end(public.bookings) to authenticated;
grant execute on function public.add_extra_hours(uuid, int) to authenticated;
grant execute on function public.notify_ops_once(text, text, uuid) to authenticated;
grant execute on function public.process_booking_lifecycle() to authenticated;

notify pgrst, 'reload schema';
