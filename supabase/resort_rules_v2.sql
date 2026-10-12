-- CK Resort · rules update. Run in the Supabase SQL Editor AFTER resort_ops.sql.
-- Safe to re-run.
--
--   Excess pax   a day or night tour covers up to 30 people; only the 31st
--                onward pays the excess fee (P200). An overnight stay or event
--                covers its package size (the tier or band that was booked);
--                anyone beyond that pays the excess fee (P800 overnight).
--   Rebooking    still closes 7 days before the stay; the fee is now 10% of
--                the booking total instead of a flat amount.
--   Group size   a day or night tour cannot be booked below 30 pax, nor an
--                overnight stay below its smallest tier; extra people on a
--                tour are P200 each.
--   Rates        the manager can add and remove overnight tiers, event bands,
--                tour hour rates and "for rent" items.

-- ------------------------------------------------------------ 1. settings --
insert into public.app_settings (key, value) values
  ('tour_included_pax', '30'),
  ('rebook_fee_percent', '10')
on conflict (key) do nothing;

insert into public.app_settings (key, value, updated_at) values ('rebook_min_days', '7', now())
on conflict (key) do update set value = '7', updated_at = now();

-- ------------------------------------------------- 2. who the package covers --
create or replace function public.included_pax(p_tour public.tour_type, p_pax int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_tour = 'overnight' then
      coalesce((select min(t.pax_cap) from public.overnight_tiers t where t.pax_cap >= p_pax), p_pax)
    when p_tour = 'event' then
      coalesce((select min(e.max_pax) from public.event_bands e where e.max_pax >= p_pax), p_pax)
    else greatest(p_pax, public.setting('tour_included_pax', '30')::int)
  end
$$;

grant execute on function public.included_pax(public.tour_type, int) to anon, authenticated;

-- Bookings already on the books follow the new rule from here on.
update public.bookings
set excess_pax = greatest(coalesce(actual_pax, pax) - public.included_pax(tour_type, pax), settled_excess_pax, 0)
where status in ('confirmed', 'checked_in')
  and excess_pax <> greatest(coalesce(actual_pax, pax) - public.included_pax(tour_type, pax), settled_excess_pax, 0);

create or replace function public.set_headcount(p_booking uuid, p_actual_pax int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('confirmed', 'checked_in') then
    raise exception 'Headcount can only be changed before or during the stay';
  end if;
  update public.bookings
  set actual_pax = greatest(p_actual_pax, 1),
      excess_pax = greatest(greatest(p_actual_pax, 1) - public.included_pax(tour_type, pax), settled_excess_pax, 0)
  where id = p_booking
  returning * into b;
  perform public.assert_room_capacity(p_booking);
  perform public.audit('set_headcount', 'booking', b.id, jsonb_build_object('actual_pax', b.actual_pax, 'excess', b.excess_pax));
  return to_jsonb(b);
end;
$$;

create or replace function public.collect_booking_payment(
  p_id uuid,
  p_cash numeric,
  p_ewallet numeric,
  p_actual_pax int default null,
  p_extra_hours int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_collected jsonb;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  perform public.process_booking_lifecycle();
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('confirmed', 'checked_in', 'checked_out', 'completed') then
    raise exception 'Nothing can be collected for a % booking', replace(b.status::text, '_', ' ');
  end if;

  if b.status = 'confirmed' then
    update public.bookings
    set actual_pax = greatest(coalesce(p_actual_pax, actual_pax, pax), 1),
        excess_pax = greatest(
          greatest(coalesce(p_actual_pax, actual_pax, pax), 1) - public.included_pax(tour_type, pax),
          settled_excess_pax,
          0
        ),
        checkin_extra_hours = greatest(coalesce(p_extra_hours, checkin_extra_hours), settled_extra_hours, 0)
    where id = p_id
    returning * into b;
    perform public.assert_room_capacity(p_id);
  end if;

  if public.booking_amount_due(p_id) <= 0 then
    raise exception 'There is no balance to collect';
  end if;

  v_collected := public.record_collected_payment(
    p_id, p_cash, p_ewallet,
    (case when b.is_walk_in and public.booking_paid_total(p_id) = 0 then 'full' else 'balance' end)::public.payment_type
  );

  if b.status = 'checked_out' and public.booking_amount_due(p_id) = 0 then
    update public.bookings set status = 'completed' where id = p_id returning * into b;
  else
    select * into b from public.bookings where id = p_id;
  end if;

  perform public.audit('collect_payment', 'booking', b.id, v_collected);
  return jsonb_build_object(
    'booking', to_jsonb(b),
    'due', (v_collected->>'due')::numeric,
    'change', (v_collected->>'change')::numeric,
    'payment_id', v_collected->>'payment_id'
  );
end;
$$;

create or replace function public.check_in_booking(
  p_id uuid,
  p_actual_pax int,
  p_extra_hours int,
  p_cash numeric,
  p_ewallet numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_collected jsonb;
  v_due numeric;
  v_pay_type public.payment_type;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  perform public.process_booking_lifecycle();
  select * into b from public.bookings where id = p_id for update;
  if b.status = 'no_show' then
    raise exception 'This reservation was marked no-show';
  end if;
  if b.status = 'expired' then
    raise exception 'This booking has expired';
  end if;
  if b.status not in ('confirmed', 'awaiting_downpayment') then
    if b.status = 'checked_in' then raise exception 'Already checked in'; end if;
    raise exception 'Booking is not ready for check-in';
  end if;
  if b.status = 'awaiting_downpayment' and not b.is_walk_in then
    raise exception 'Downpayment has not been collected yet';
  end if;

  -- Headcount first: it decides the excess fee and whether the rooms still fit.
  update public.bookings
  set actual_pax = greatest(p_actual_pax, 1),
      excess_pax = greatest(greatest(p_actual_pax, 1) - public.included_pax(tour_type, pax), settled_excess_pax, 0),
      checkin_extra_hours = greatest(p_extra_hours, settled_extra_hours, 0)
  where id = p_id
  returning * into b;
  perform public.assert_room_capacity(p_id);

  -- Payment before the keys: the whole balance is settled here.
  v_pay_type := (case when b.is_walk_in and public.booking_paid_total(p_id) = 0 then 'full' else 'balance' end)::public.payment_type;
  v_collected := public.record_collected_payment(p_id, p_cash, p_ewallet, v_pay_type);
  v_due := (v_collected->>'due')::numeric;

  update public.bookings
  set status = 'checked_in',
      checked_in_by = auth.uid(),
      checked_in_at = now()
  where id = p_id
  returning * into b;

  update public.room_units u
  set status = 'occupied',
      current_booking_id = b.id,
      check_in_at = now(),
      check_out_at = public.booking_effective_end(b)
  where u.id in (select br.room_unit_id from public.booking_rooms br where br.booking_id = b.id);

  perform public.notify_admins('Guest checked in', b.reference || ' · ' || b.guest_name, b.id);
  if b.guest_id is not null then
    perform public.notify_user(b.guest_id, 'Checked in', 'Welcome to CK Resort. Enjoy your stay.', b.id);
  end if;
  perform public.audit('check_in', 'booking', b.id, v_collected);

  return jsonb_build_object(
    'booking', to_jsonb(b),
    'due', v_due,
    'change', (v_collected->>'change')::numeric,
    'payment_id', v_collected->>'payment_id'
  );
end;
$$;

-- ---------------------------------------------------------- 3. rebooking --
create or replace function public.booking_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'max_advance_days', public.setting('max_advance_days', '90')::int,
    'min_lead_hours', public.setting('min_lead_hours', '4')::int,
    'max_extra_hours', public.setting('max_extra_hours', '6')::int,
    'rebook_min_days', public.setting('rebook_min_days', '7')::int,
    'rebook_fee', 0,
    'rebook_fee_percent', public.setting('rebook_fee_percent', '10')::numeric,
    'tour_included_pax', public.setting('tour_included_pax', '30')::int,
    'max_pets_per_room', public.setting('max_pets_per_room', '2')::int,
    'downpayment_hours', public.setting('downpayment_hours', '48')::int,
    'max_pax', jsonb_build_object(
      'day', public.setting('max_pax_day', '30')::int,
      'night', public.setting('max_pax_night', '30')::int,
      'overnight', public.setting('max_pax_overnight', '70')::int,
      'event', public.setting('max_pax_event', '200')::int
    )
  )
$$;

create or replace function public.rebook_booking(p_id uuid, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_days int := public.setting('rebook_min_days', '7')::int;
  v_percent numeric := public.setting('rebook_fee_percent', '10')::numeric;
  v_fee numeric := 0;
  v_old date;
  v_payload jsonb;
  q jsonb;
  slots text[];
begin
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.guest_id is distinct from auth.uid() and not public.is_desk() then
    raise exception 'Not allowed';
  end if;
  if b.status <> 'confirmed' then
    raise exception 'Only a confirmed reservation can be rebooked';
  end if;
  if p_date is null or p_date = b.stay_date then
    raise exception 'Pick a different date';
  end if;
  if now() > public.booking_starts_at(b) - make_interval(days => v_days) then
    raise exception 'Rebooking is only allowed up to % day(s) before the stay', v_days;
  end if;

  v_old := b.stay_date;
  v_payload := public.booking_payload(b) || jsonb_build_object('stay_date', p_date);
  -- A booking made before the minimum group size keeps its own headcount;
  -- only the date rules are being re-checked here.
  perform public.assert_booking_rules(v_payload || jsonb_build_object('pax', greatest(
    b.pax,
    case
      when b.tour_type in ('day', 'night') then public.setting('tour_included_pax', '30')::int
      when b.tour_type = 'overnight' then coalesce((select min(t.pax_cap) from public.overnight_tiers t), 1)
      else 1
    end
  )));

  slots := public.booking_slots(b.tour_type, b.event_when);
  if public.slots_taken(p_date, slots, b.id) then
    raise exception 'That date and time slot is no longer available';
  end if;

  -- Only the date-driven lines (weekend rate) can move; the package is kept.
  q := public.quote_booking(v_payload);

  update public.bookings
  set stay_date = p_date,
      original_stay_date = coalesce(original_stay_date, v_old),
      rebook_count = rebook_count + 1,
      quote_lines = coalesce(q->'lines', quote_lines),
      total_amount = (q->>'total')::numeric
  where id = p_id
  returning * into b;

  -- A share of the booking total, on the total for the new date.
  v_fee := round(coalesce(b.override_amount, b.total_amount) * greatest(v_percent, 0) / 100);

  if v_fee > 0 then
    insert into public.booking_charges (booking_id, description, amount, created_by, kind)
    values (
      p_id,
      'Rebooking fee (' || trim(to_char(v_percent, 'FM990.##'), '.') || '%) · '
        || to_char(v_old, 'Mon DD') || ' to ' || to_char(p_date, 'Mon DD'),
      v_fee,
      auth.uid(),
      'rebook'
    );
  end if;

  if b.guest_id is not null then
    perform public.notify_user(
      b.guest_id,
      'Reservation rebooked',
      b.reference || ' moved to ' || to_char(p_date, 'FMMonth DD, YYYY') || '.'
        || case when v_fee > 0 then ' A ' || public.peso_text(v_fee) || ' rebooking fee was added to the balance.' else '' end,
      b.id
    );
    perform public.queue_email(
      b.guest_id,
      'CK Resort reservation rebooked · ' || b.reference,
      'Hi ' || b.guest_name || ',' || E'\n\n'
        || b.reference || ' moved from ' || to_char(v_old, 'FMMonth DD, YYYY') || ' to '
        || to_char(p_date, 'FMDay, FMMonth DD, YYYY') || ' (' || public.booking_window_label(b) || ').' || E'\n'
        || case when v_fee > 0
             then 'A rebooking fee of ' || public.peso_text(v_fee) || ' was added to the balance.' || E'\n'
             else ''
           end
        || 'Balance due at check-in: ' || public.peso_text(public.booking_amount_due(b.id)) || E'\n\n'
        || 'CK Resort & Events Place',
      b.id
    );
  end if;
  perform public.notify_admins(
    'Reservation rebooked',
    b.reference || ' · ' || b.guest_name || ' moved to ' || p_date::text,
    b.id
  );
  perform public.audit('rebook_booking', 'booking', b.id, jsonb_build_object('from', v_old, 'to', p_date, 'fee', v_fee));
  return to_jsonb(b);
end;
$$;

-- ------------------------------------------- 4. manager adds/removes prices --
create or replace function public.admin_save_overnight_tier(p_pax int, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_pax, 0) < 1 then raise exception 'Enter how many pax this tier covers'; end if;
  if coalesce(p_amount, -1) < 0 then raise exception 'Enter the price'; end if;
  insert into public.overnight_tiers (pax_cap, amount) values (p_pax, p_amount)
  on conflict (pax_cap) do update set amount = excluded.amount;
  perform public.audit('save_price', 'overnight_tier', null, jsonb_build_object('pax', p_pax, 'amount', p_amount));
end;
$$;

create or replace function public.admin_delete_overnight_tier(p_pax int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if (select count(*) from public.overnight_tiers) <= 1 then
    raise exception 'Keep at least one overnight price';
  end if;
  delete from public.overnight_tiers where pax_cap = p_pax;
  perform public.audit('delete_price', 'overnight_tier', null, jsonb_build_object('pax', p_pax));
end;
$$;

create or replace function public.admin_save_event_band(p_max_pax int, p_day numeric, p_night numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_max_pax, 0) < 1 then raise exception 'Enter how many pax this event price covers'; end if;
  if coalesce(p_day, -1) < 0 or coalesce(p_night, -1) < 0 then raise exception 'Enter the day and night prices'; end if;
  insert into public.event_bands (max_pax, day_amount, night_amount) values (p_max_pax, p_day, p_night)
  on conflict (max_pax) do update set day_amount = excluded.day_amount, night_amount = excluded.night_amount;
  perform public.audit('save_price', 'event_band', null,
    jsonb_build_object('max_pax', p_max_pax, 'day', p_day, 'night', p_night));
end;
$$;

create or replace function public.admin_delete_event_band(p_max_pax int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if (select count(*) from public.event_bands) <= 1 then
    raise exception 'Keep at least one event price';
  end if;
  delete from public.event_bands where max_pax = p_max_pax;
  perform public.audit('delete_price', 'event_band', null, jsonb_build_object('max_pax', p_max_pax));
end;
$$;

create or replace function public.admin_save_hour_rate(p_tour text, p_hours int, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_tour not in ('day', 'night') then raise exception 'Choose day or night tour'; end if;
  if coalesce(p_hours, 0) < 1 or p_hours > 24 then raise exception 'Hours must be between 1 and 24'; end if;
  if coalesce(p_amount, -1) < 0 then raise exception 'Enter the price'; end if;
  insert into public.tour_hour_rates (tour_type, hours, amount) values (p_tour, p_hours, p_amount)
  on conflict (tour_type, hours) do update set amount = excluded.amount;
  perform public.audit('save_price', 'hour_rate', null,
    jsonb_build_object('tour', p_tour, 'hours', p_hours, 'amount', p_amount));
end;
$$;

create or replace function public.admin_delete_hour_rate(p_tour text, p_hours int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_hours = 8 then
    raise exception 'The 8-hour rate is the standard tour price and cannot be removed';
  end if;
  delete from public.tour_hour_rates where tour_type = p_tour and hours = p_hours;
  perform public.audit('delete_price', 'hour_rate', null, jsonb_build_object('tour', p_tour, 'hours', p_hours));
end;
$$;

-- "For rent" items. Removing one hides it; past bills keep their line.
create or replace function public.admin_save_rental(p_id uuid, p_name text, p_price numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rt public.rentals;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the item name'; end if;
  if coalesce(p_price, -1) < 0 then raise exception 'Enter the price'; end if;
  if p_id is null then
    insert into public.rentals (slug, name, price, sort_order)
    values (
      'item-' || replace(gen_random_uuid()::text, '-', ''),
      trim(p_name),
      p_price,
      coalesce((select max(sort_order) from public.rentals), 0) + 1
    )
    returning * into rt;
  else
    update public.rentals set name = trim(p_name), price = p_price, is_active = true
    where id = p_id
    returning * into rt;
    if not found then raise exception 'Item not found'; end if;
  end if;
  perform public.audit('save_price', 'rental', rt.id, jsonb_build_object('name', rt.name, 'price', rt.price));
  return to_jsonb(rt);
end;
$$;

create or replace function public.admin_delete_rental(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rt public.rentals;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.rentals set is_active = false where id = p_id returning * into rt;
  if not found then raise exception 'Item not found'; end if;
  perform public.audit('delete_price', 'rental', rt.id, jsonb_build_object('name', rt.name));
end;
$$;

-- ------------------------------------------------- 5. smallest booking --
-- A day or night tour is sold as a 30-pax package (more people are P200
-- each), and an overnight stay starts at its smallest tier (10 pax).
-- The old 30-pax ceiling becomes 50 so people can be added; a value the
-- manager already changed in Schedule is left alone.
update public.app_settings
set value = '50', updated_at = now()
where key in ('max_pax_day', 'max_pax_night') and value = '30';

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
  v_max_advance int := public.setting('max_advance_days', '90')::int;
  v_min_lead int := public.setting('min_lead_hours', '4')::int;
  v_max_extra int := public.setting('max_extra_hours', '6')::int;
  v_max_pax int;
  v_min_pax int := 1;
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
    when 'night' then public.setting('max_pax_night', '50')::int
    else public.setting('max_pax_day', '50')::int
  end;
  if v_pax > v_max_pax then
    raise exception 'A % booking allows up to % guests. Contact the resort for larger groups', v_tour, v_max_pax;
  end if;

  if v_tour in ('day', 'night') then
    v_min_pax := public.setting('tour_included_pax', '30')::int;
  elsif v_tour = 'overnight' then
    v_min_pax := coalesce((select min(t.pax_cap) from public.overnight_tiers t), 1);
  end if;
  if v_pax < v_min_pax then
    raise exception 'A % booking starts at % guests', v_tour, v_min_pax;
  end if;

  select c.reason into v_reason from public.resort_closures c where c.closure_date = v_stay;
  if found then
    raise exception 'The resort is closed on % (%). Please pick another date', v_stay, coalesce(nullif(v_reason, ''), 'closed');
  end if;
end;
$$;

-- ------------------------------------------------------------ 6. grants --
grant execute on function public.set_headcount(uuid, int) to authenticated;
grant execute on function public.collect_booking_payment(uuid, numeric, numeric, int, int) to authenticated;
grant execute on function public.check_in_booking(uuid, int, int, numeric, numeric) to authenticated;
grant execute on function public.booking_rules() to anon, authenticated;
grant execute on function public.rebook_booking(uuid, date) to authenticated;
grant execute on function public.admin_save_overnight_tier(int, numeric) to authenticated;
grant execute on function public.admin_delete_overnight_tier(int) to authenticated;
grant execute on function public.admin_save_event_band(int, numeric, numeric) to authenticated;
grant execute on function public.admin_delete_event_band(int) to authenticated;
grant execute on function public.admin_save_hour_rate(text, int, numeric) to authenticated;
grant execute on function public.admin_delete_hour_rate(text, int) to authenticated;
grant execute on function public.admin_save_rental(uuid, text, numeric) to authenticated;
grant execute on function public.admin_delete_rental(uuid) to authenticated;
