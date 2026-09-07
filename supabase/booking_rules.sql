-- CK Resort · booking rules, resort closures, room descriptions, analytics
-- Apply after schema.sql / booking_lifecycle.sql / rpc_ambiguity_fix.sql.
-- node scripts/apply-sql.mjs supabase/booking_rules.sql

-- ---------------------------------------------------------------------------
-- 1. Booking rule settings
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('max_advance_days', '365'),
  ('min_lead_hours', '4'),
  ('max_extra_hours', '6'),
  ('max_pax_day', '150'),
  ('max_pax_night', '150'),
  ('max_pax_overnight', '70'),
  ('max_pax_event', '200')
on conflict (key) do nothing;

create or replace function public.booking_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'max_advance_days', public.setting('max_advance_days', '365')::int,
    'min_lead_hours', public.setting('min_lead_hours', '4')::int,
    'max_extra_hours', public.setting('max_extra_hours', '6')::int,
    'max_pax', jsonb_build_object(
      'day', public.setting('max_pax_day', '150')::int,
      'night', public.setting('max_pax_night', '150')::int,
      'overnight', public.setting('max_pax_overnight', '70')::int,
      'event', public.setting('max_pax_event', '200')::int
    )
  )
$$;

create or replace function public.admin_save_booking_rules(
  p_max_advance_days int,
  p_min_lead_hours int,
  p_max_extra_hours int,
  p_max_pax_day int,
  p_max_pax_night int,
  p_max_pax_overnight int,
  p_max_pax_event int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_max_advance_days < 1 or p_max_advance_days > 1095 then
    raise exception 'Advance window must be between 1 and 1095 days';
  end if;
  if p_min_lead_hours < 0 or p_min_lead_hours > 720 then
    raise exception 'Lead time must be between 0 and 720 hours';
  end if;
  if p_max_extra_hours < 0 or p_max_extra_hours > 24 then
    raise exception 'Extra hours cap must be between 0 and 24';
  end if;
  if least(p_max_pax_day, p_max_pax_night, p_max_pax_overnight, p_max_pax_event) < 1 then
    raise exception 'Pax caps must be at least 1';
  end if;

  insert into public.app_settings (key, value, updated_at) values
    ('max_advance_days', p_max_advance_days::text, now()),
    ('min_lead_hours', p_min_lead_hours::text, now()),
    ('max_extra_hours', p_max_extra_hours::text, now()),
    ('max_pax_day', p_max_pax_day::text, now()),
    ('max_pax_night', p_max_pax_night::text, now()),
    ('max_pax_overnight', p_max_pax_overnight::text, now()),
    ('max_pax_event', p_max_pax_event::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.audit('save_booking_rules', 'settings', null, public.booking_rules());
  return public.booking_rules();
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Resort closures (admin schedule management)
-- ---------------------------------------------------------------------------

create table if not exists public.resort_closures (
  closure_date date primary key,
  reason text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.resort_closures enable row level security;

drop policy if exists resort_closures_read on public.resort_closures;
create policy resort_closures_read on public.resort_closures for select using (true);

drop policy if exists resort_closures_write on public.resort_closures;
create policy resort_closures_write on public.resort_closures for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.resort_closures to anon, authenticated;

create or replace function public.closed_dates(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', c.closure_date,
    'reason', c.reason
  ) order by c.closure_date), '[]'::jsonb)
  from public.resort_closures c
  where c.closure_date between p_from and p_to
$$;

create or replace function public.admin_add_closure(p_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken int;
  row public.resort_closures;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_date < public.manila_today() then
    raise exception 'Pick today or a future date';
  end if;

  select count(*) into v_taken
  from public.bookings
  where stay_date = p_date
    and status in ('pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in');
  if v_taken > 0 then
    raise exception 'There are % active booking(s) on that date. Cancel or move them first', v_taken;
  end if;

  insert into public.resort_closures (closure_date, reason, created_by)
  values (p_date, coalesce(nullif(trim(p_reason), ''), 'Closed'), auth.uid())
  on conflict (closure_date) do update set reason = excluded.reason, created_by = excluded.created_by
  returning * into row;

  perform public.audit('add_closure', 'closure', null, to_jsonb(row));
  return to_jsonb(row);
end;
$$;

create or replace function public.admin_remove_closure(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.resort_closures where closure_date = p_date;
  perform public.audit('remove_closure', 'closure', null, jsonb_build_object('date', p_date));
  return jsonb_build_object('date', p_date, 'removed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Room descriptions
-- ---------------------------------------------------------------------------

alter table public.rooms add column if not exists description text not null default '';
alter table public.room_units add column if not exists description text not null default '';

update public.rooms set description = v.description
from (values
  ('gazebo', 'Air-conditioned suite beside the main pool with a private gazebo lounge. Required before booking the Sunrise Suite.'),
  ('sunrise', 'Upper-deck suite facing the sunrise view. Available only as an add-on to a Gazebo Suite room.'),
  ('pedro', 'Our largest family block — three room sizes sharing a covered veranda and grilling area.'),
  ('pavilion-ken', 'Function-style room next to the pavilion, ideal for barkada groups and small events.'),
  ('tala', 'Quiet standard room set back from the pool, good for couples and small families.'),
  ('milagros', 'Spacious room with extra beds and direct access to the garden dining area.'),
  ('tents', 'Pitched camping tents on the lawn. Two pax each, shared wash areas, best for overnight stays.')
) as v(slug, description)
where public.rooms.slug = v.slug and public.rooms.description = '';

update public.room_units u set description = v.description
from (values
  ('gazebo-r1', '3 beds · sleeps 6 · air-conditioned · private gazebo access'),
  ('gazebo-r2', '3 beds · sleeps 6 · air-conditioned · private gazebo access'),
  ('sunrise-r1', '3 beds · sleeps 6 · sunrise-facing balcony'),
  ('sunrise-r2', '1 bed · sleeps 2 · compact couples room'),
  ('pedro-r1', '3 beds · sleeps 6 · veranda access'),
  ('pedro-r2', '4 beds · sleeps 12 · family layout with extra floor space'),
  ('pedro-r3', '6 beds · sleeps 18 · our largest room, good for reunions'),
  ('pavilion-r1', '5 beds · sleeps 15 · beside the event pavilion'),
  ('tala-r1', '3 beds · sleeps 6 · quiet garden side'),
  ('milagros-r1', '5 beds · sleeps 15 · garden dining access'),
  ('tent-1', 'Camping tent · sleeps 2 · lawn pitch'),
  ('tent-2', 'Camping tent · sleeps 2 · lawn pitch'),
  ('tent-3', 'Camping tent · sleeps 2 · lawn pitch'),
  ('tent-4', 'Camping tent · sleeps 2 · lawn pitch'),
  ('tent-5', 'Camping tent · sleeps 2 · lawn pitch')
) as v(slug, description)
where u.slug = v.slug and u.description = '';

-- ---------------------------------------------------------------------------
-- 4. Rule enforcement inside submit_booking
-- ---------------------------------------------------------------------------

create or replace function public.assert_booking_rules(payload jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tour text := coalesce(payload->>'tour_type', 'day');
  v_stay date := nullif(payload->>'stay_date', '')::date;
  v_pax int := greatest(coalesce((payload->>'pax')::int, 1), 1);
  v_extra_hours int := greatest(coalesce((payload->>'extra_hours')::int, 0), 0);
  v_max_advance int := public.setting('max_advance_days', '365')::int;
  v_min_lead int := public.setting('min_lead_hours', '4')::int;
  v_max_extra int := public.setting('max_extra_hours', '6')::int;
  v_max_pax int;
  v_start timestamptz;
  v_reason text;
begin
  if v_stay is null then
    raise exception 'Please pick a date';
  end if;

  if v_stay > public.manila_today() + v_max_advance then
    raise exception 'Bookings open only % days ahead. Please pick an earlier date', v_max_advance;
  end if;

  v_start := public.booking_window_start(
    v_tour::public.tour_type, v_stay, payload->>'overnight_shift', payload->>'event_when'
  );
  if v_start < now() + make_interval(hours => v_min_lead) then
    raise exception 'Bookings need at least % hour(s) of lead time. Please pick a later slot', v_min_lead;
  end if;

  if v_extra_hours > v_max_extra then
    raise exception 'Up to % extra hour(s) can be booked online', v_max_extra;
  end if;

  v_max_pax := case v_tour
    when 'overnight' then public.setting('max_pax_overnight', '70')::int
    when 'event' then public.setting('max_pax_event', '200')::int
    when 'night' then public.setting('max_pax_night', '150')::int
    else public.setting('max_pax_day', '150')::int
  end;
  if v_pax > v_max_pax then
    raise exception 'A % booking allows up to % guests. Contact the resort for larger groups', v_tour, v_max_pax;
  end if;

  select c.reason into v_reason from public.resort_closures c where c.closure_date = v_stay;
  if found then
    raise exception 'The resort is closed on % (%). Please pick another date', v_stay, coalesce(nullif(v_reason, ''), 'closed');
  end if;
end;
$$;

create or replace function public.submit_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_profile public.profiles%rowtype;
  q jsonb;
  b public.bookings;
  slots text[];
  unit_ids uuid[];
  gazebo_selected boolean := false;
  sunrise_selected boolean := false;
  stay date;
  tour public.tour_type;
begin
  if me is null then
    raise exception 'Sign in required';
  end if;
  select * into my_profile from public.profiles where id = me;
  if my_profile.role <> 'guest' then
    raise exception 'Only guests can submit online bookings';
  end if;
  if nullif(payload->>'stay_date', '') is null then
    raise exception 'Please pick a date';
  end if;

  perform public.process_booking_lifecycle();
  perform public.assert_guest_can_book(me);
  perform public.assert_booking_rules(payload);

  stay := (payload->>'stay_date')::date;
  tour := (payload->>'tour_type')::public.tour_type;
  if stay < public.manila_today() or now() >= public.booking_window_start(tour, stay, payload->>'overnight_shift', payload->>'event_when') then
    raise exception 'That date and time has already started. Please pick a later slot';
  end if;

  slots := public.booking_slots(tour, payload->>'event_when');
  if public.slots_taken(stay, slots) then
    raise exception 'That date and time slot is no longer available';
  end if;

  unit_ids := coalesce(array(select jsonb_array_elements_text(payload->'room_unit_ids'))::uuid[], '{}');

  select exists (
    select 1 from public.room_units u
    join public.rooms rm on rm.id = u.room_id
    where u.id = any (unit_ids) and rm.slug = 'gazebo'
  ) into gazebo_selected;
  select exists (
    select 1 from public.room_units u
    join public.rooms rm on rm.id = u.room_id
    where u.id = any (unit_ids) and rm.slug = 'sunrise'
  ) into sunrise_selected;
  if sunrise_selected and not gazebo_selected then
    raise exception 'Sunrise Suite requires Gazebo Suite';
  end if;

  if exists (
    select 1
    from public.booking_rooms br
    join public.bookings bx on bx.id = br.booking_id
    where br.room_unit_id = any (unit_ids)
      and bx.stay_date = stay
      and bx.status in ('pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in')
      and public.booking_slots(bx.tour_type, bx.event_when) && slots
  ) then
    raise exception 'One of the selected rooms is already booked for that slot';
  end if;

  q := public.quote_booking(payload);

  insert into public.bookings (
    reference, guest_id, guest_name, guest_contact, created_by, tour_type, stay_date, pax, hours,
    extra_hours, overnight_shift, event_when, pets, caterer_id, status, package_label, quote_lines,
    total_amount, downpayment_amount
  ) values (
    'CK-' || lpad(nextval('public.booking_ref_seq')::text, 4, '0'),
    me,
    trim(my_profile.first_name || ' ' || my_profile.last_name),
    my_profile.contact,
    me,
    tour,
    stay,
    greatest(coalesce((payload->>'pax')::int, 1), 1),
    coalesce((payload->>'hours')::int, 8),
    greatest(coalesce((payload->>'extra_hours')::int, 0), 0),
    payload->>'overnight_shift',
    payload->>'event_when',
    greatest(coalesce((payload->>'pets')::int, 0), 0),
    nullif(payload->>'caterer_id', '')::uuid,
    'pending_approval',
    q->>'package_label',
    coalesce(q->'lines', '[]'::jsonb),
    (q->>'total')::numeric,
    (q->>'downpayment')::numeric
  ) returning * into b;

  insert into public.booking_rooms (booking_id, room_unit_id, rate_snapshot)
  select b.id, u.id, u.rate
  from public.room_units u
  where u.id = any (unit_ids);

  if payload ? 'rentals' then
    insert into public.booking_rentals (booking_id, rental_id, qty, rate_snapshot)
    select b.id, rt.id, greatest(coalesce((x.elem->>'qty')::int, 1), 1), rt.price
    from jsonb_array_elements(payload->'rentals') as x(elem)
    join public.rentals rt on rt.id = (x.elem->>'id')::uuid;
  end if;

  perform public.notify_admins(
    'New booking request',
    b.guest_name || ' submitted ' || b.reference || ' for ' || b.stay_date::text,
    b.id
  );
  perform public.audit('submit_booking', 'booking', b.id, jsonb_build_object('reference', b.reference));

  return to_jsonb(b);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Analytics
-- ---------------------------------------------------------------------------

create or replace function public.admin_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, public.manila_today() - 30);
  v_to date := coalesce(p_to, public.manila_today());
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if v_from > v_to then
    raise exception 'Start date must be on or before the end date';
  end if;

  return jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'totals', (
      select jsonb_build_object(
        'bookings', count(*),
        'guests', coalesce(sum(coalesce(b.actual_pax, b.pax)), 0),
        'booked_value', coalesce(sum(coalesce(b.override_amount, b.total_amount)), 0),
        'cancelled', count(*) filter (where b.status in ('cancelled', 'rejected')),
        'no_show', count(*) filter (where b.status = 'no_show'),
        'completed', count(*) filter (where b.status in ('completed', 'checked_out'))
      )
      from public.bookings b
      where b.stay_date between v_from and v_to
    ),
    'revenue', (
      select jsonb_build_object(
        'collected', coalesce(sum(p.amount), 0),
        'payments', count(*),
        'downpayments', coalesce(sum(p.amount) filter (where p.type = 'downpayment'), 0),
        'onsite', coalesce(sum(p.amount) filter (where p.type <> 'downpayment'), 0),
        'cash', coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
        'ewallet', coalesce(sum(p.amount) filter (where p.method = 'ewallet'), 0),
        'paymongo', coalesce(sum(p.amount) filter (where p.method = 'paymongo'), 0)
      )
      from public.payments p
      where p.status = 'paid' and p.paid_at::date between v_from and v_to
    ),
    'by_package', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', s.tour_type, 'count', s.n, 'guests', s.guests, 'amount', s.amount
      ) order by s.amount desc), '[]'::jsonb)
      from (
        select b.tour_type::text as tour_type,
               count(*) as n,
               coalesce(sum(coalesce(b.actual_pax, b.pax)), 0) as guests,
               coalesce(sum(coalesce(b.override_amount, b.total_amount)), 0) as amount
        from public.bookings b
        where b.stay_date between v_from and v_to
          and b.status not in ('rejected', 'cancelled')
        group by b.tour_type
      ) s
    ),
    'by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('label', s.status, 'count', s.n) order by s.n desc), '[]'::jsonb)
      from (
        select b.status::text as status, count(*) as n
        from public.bookings b
        where b.stay_date between v_from and v_to
        group by b.status
      ) s
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', s.day, 'bookings', s.n, 'collected', s.collected
      ) order by s.day), '[]'::jsonb)
      from (
        select d.day::date as day,
          (select count(*) from public.bookings b
            where b.stay_date = d.day::date and b.status not in ('rejected', 'cancelled')) as n,
          (select coalesce(sum(p.amount), 0) from public.payments p
            where p.status = 'paid' and p.paid_at::date = d.day::date) as collected
        from generate_series(v_from, v_to, interval '1 day') as d(day)
      ) s
    ),
    'top_rentals', (
      select coalesce(jsonb_agg(jsonb_build_object('label', s.name, 'count', s.qty) order by s.qty desc), '[]'::jsonb)
      from (
        select rt.name, coalesce(sum(br.qty), 0) as qty
        from public.booking_rentals br
        join public.rentals rt on rt.id = br.rental_id
        join public.bookings b on b.id = br.booking_id
        where b.stay_date between v_from and v_to
          and b.status not in ('rejected', 'cancelled')
        group by rt.name
        having coalesce(sum(br.qty), 0) > 0
        limit 8
      ) s
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'reference', b.reference,
        'guest', b.guest_name,
        'type', p.type,
        'method', p.method,
        'amount', p.amount,
        'status', p.status,
        'receipt_no', p.receipt_no,
        'paid_at', p.paid_at
      ) order by p.paid_at desc), '[]'::jsonb)
      from public.payments p
      join public.bookings b on b.id = p.booking_id
      where p.status = 'paid' and p.paid_at::date between v_from and v_to
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

grant execute on function public.booking_rules() to anon, authenticated;
grant execute on function public.closed_dates(date, date) to anon, authenticated;
grant execute on function public.assert_booking_rules(jsonb) to anon, authenticated;
grant execute on function public.submit_booking(jsonb) to authenticated;
grant execute on function public.admin_save_booking_rules(int, int, int, int, int, int, int) to authenticated;
grant execute on function public.admin_add_closure(date, text) to authenticated;
grant execute on function public.admin_remove_closure(date) to authenticated;
grant execute on function public.admin_analytics(date, date) to authenticated;
