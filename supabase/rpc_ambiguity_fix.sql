-- Naming-safe replacements for booking/pricing/approval/payment/lifecycle RPCs.
-- Run this in the Supabase SQL Editor (one query). Safe to re-run.

create or replace function public.quote_booking(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tour text := coalesce(payload->>'tour_type', 'day');
  v_stay date := nullif(payload->>'stay_date', '')::date;
  v_pax int := greatest(coalesce((payload->>'pax')::int, 1), 1);
  p_hours int := coalesce((payload->>'hours')::int, 8);
  v_extra_hours int := greatest(coalesce((payload->>'extra_hours')::int, 0), 0);
  v_event_when text := coalesce(payload->>'event_when', 'day');
  v_shift text := payload->>'overnight_shift';
  v_pets int := greatest(coalesce((payload->>'pets')::int, 0), 0);
  v_caterer uuid := nullif(payload->>'caterer_id', '')::uuid;
  unit_ids uuid[] := coalesce(array(select jsonb_array_elements_text(payload->'room_unit_ids'))::uuid[], '{}');
  lines jsonb := '[]'::jsonb;
  total numeric := 0;
  base numeric := 0;
  cap int := 0;
  extra_pax int := 0;
  extra_fee numeric := 0;
  label text := 'Package';
  r record;
  room_names text;
  partner boolean;
begin
  if v_tour = 'overnight' then
    select t.amount, t.pax_cap into base, cap
    from public.overnight_tiers t
    where t.pax_cap >= v_pax
    order by t.pax_cap
    limit 1;
    if base is null then
      select ot.amount, ot.pax_cap into base, cap from public.overnight_tiers ot order by ot.pax_cap desc limit 1;
      extra_pax := v_pax - cap;
      extra_fee := extra_pax * public.rate_amount('extra_pax_overnight');
    end if;
    label := 'Overnight · ' || cap || ' pax' || coalesce(' · ' || v_shift, '');
    lines := lines || jsonb_build_array(jsonb_build_object('label', label, 'amount', base));
    if extra_fee > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Extra pax × ' || extra_pax,
        'amount', extra_fee
      ));
    end if;
  elsif v_tour = 'event' then
    select case when v_event_when = 'night' then eb.night_amount else eb.day_amount end, eb.max_pax
      into base, cap
    from public.event_bands eb
    where eb.max_pax >= v_pax
    order by eb.max_pax
    limit 1;
    if base is null then
      select case when v_event_when = 'night' then eb.night_amount else eb.day_amount end, eb.max_pax
        into base, cap
      from public.event_bands eb order by eb.max_pax desc limit 1;
    end if;
    label := 'Event · ' || initcap(v_event_when) || ' · up to ' || v_pax || ' pax';
    lines := lines || jsonb_build_array(jsonb_build_object('label', label, 'amount', coalesce(base, 0)));
  else
    if v_pax <= 20 then
      base := public.rate_amount(v_tour || '_20');
      extra_pax := 0;
      extra_fee := 0;
    else
      select thr.amount into base from public.tour_hour_rates thr where thr.tour_type = v_tour and thr.hours = p_hours;
      if base is null then
        select thr.amount into base from public.tour_hour_rates thr where thr.tour_type = v_tour and thr.hours = 8;
      end if;
      extra_pax := greatest(v_pax - 30, 0);
      extra_fee := extra_pax * public.rate_amount('extra_pax_tour');
    end if;
    label := case when v_tour = 'day' then 'Day Tour' else 'Night Tour' end || ' · ' || v_pax || ' pax';
    lines := lines || jsonb_build_array(jsonb_build_object('label', label, 'amount', coalesce(base, 0)));
    if extra_fee > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Extra pax × ' || extra_pax,
        'amount', extra_fee
      ));
    end if;
  end if;

  if v_extra_hours > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object(
      'label', 'Extra hour × ' || v_extra_hours,
      'amount', v_extra_hours * public.rate_amount('extra_hour')
    ));
  end if;

  if v_stay is not null and extract(dow from v_stay) in (0, 5, 6) then
    lines := lines || jsonb_build_array(jsonb_build_object(
      'label', 'Weekend / holiday rate (Fri–Sun)',
      'amount', public.rate_amount('weekend')
    ));
  end if;

  if cardinality(unit_ids) > 0 then
    select string_agg(rm.name || ' ' || u.name, ', ' order by rm.sort_order, u.sort_order), coalesce(sum(u.rate), 0)
      into room_names, extra_fee
    from public.room_units u
    join public.rooms rm on rm.id = u.room_id
    where u.id = any (unit_ids);
    lines := lines || jsonb_build_array(jsonb_build_object(
      'label', 'Rooms · ' || coalesce(room_names, 'selected'),
      'amount', extra_fee
    ));
  end if;

  if payload ? 'rentals' then
    for r in
      select rt.name, rt.price, greatest(coalesce((x.elem->>'qty')::int, 1), 1) as qty
      from jsonb_array_elements(payload->'rentals') as x(elem)
      join public.rentals rt on rt.id = (x.elem->>'id')::uuid
    loop
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', r.name || ' × ' || r.qty,
        'amount', r.price * r.qty
      ));
    end loop;
  end if;

  if v_pets > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object(
      'label', 'Pet fee × ' || v_pets,
      'amount', v_pets * public.rate_amount('pet')
    ));
  end if;

  if v_caterer is not null then
    select c.is_partner, c.name into partner, room_names from public.caterers c where c.id = v_caterer;
    if partner then
      lines := lines || jsonb_build_array(jsonb_build_object('label', 'Tie-up catering · ' || room_names, 'amount', 0));
    else
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Outside catering corkage (minimum)',
        'amount', public.rate_amount('corkage')
      ));
    end if;
  end if;

  select coalesce(sum((line->>'amount')::numeric), 0) into total
  from jsonb_array_elements(lines) as line;

  return jsonb_build_object(
    'lines', lines,
    'total', total,
    'downpayment', round(total * 0.5, 2),
    'package_label', label
  );
end;
$$;

create or replace function public.approve_booking(p_id uuid, p_override numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_dp_window_hours int;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  perform public.process_booking_lifecycle();
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status = 'expired' then
    raise exception 'This booking has expired';
  end if;
  if b.status <> 'pending_approval' then
    raise exception 'Only pending bookings can be approved';
  end if;
  if now() > public.booking_ends_at(b) then
    raise exception 'The stay window has already ended';
  end if;
  v_dp_window_hours := public.setting('downpayment_hours', '48')::int;
  update public.bookings
  set status = 'awaiting_downpayment',
      approved_by = auth.uid(),
      approved_at = now(),
      payment_due_at = least(now() + (v_dp_window_hours::text || ' hours')::interval, public.booking_starts_at(b)),
      override_amount = p_override,
      downpayment_amount = round(coalesce(p_override, bookings.total_amount) * 0.5, 2)
  where id = p_id
  returning * into b;

  if b.guest_id is not null then
    perform public.notify_user(
      b.guest_id,
      'Booking approved',
      b.reference || ' was approved. Please pay the 50% downpayment by '
        || to_char(b.payment_due_at at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM')
        || ' to confirm.',
      b.id
    );
  end if;
  perform public.audit('approve_booking', 'booking', b.id, '{}'::jsonb);
  return to_jsonb(b);
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

  return jsonb_build_object('processed', processed);
end;
$$;

create or replace function public.sync_paid_amount(p_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
begin
  v_paid := public.booking_paid_total(p_id);
  update public.bookings set paid_amount = v_paid where id = p_id;
  return v_paid;
end;
$$;

create or replace function public.booking_final_bill(p_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_charges numeric := 0;
begin
  select * into b from public.bookings where id = p_id;
  if not found then
    return 0;
  end if;
  select coalesce(sum(bc.amount), 0) into v_charges from public.booking_charges bc where bc.booking_id = p_id;
  return coalesce(b.override_amount, b.total_amount)
    + v_charges
    + b.excess_pax * case
        when b.tour_type = 'overnight' then public.rate_amount('extra_pax_overnight')
        else public.rate_amount('extra_pax_tour')
      end
    + b.checkin_extra_hours * public.rate_amount('extra_hour');
end;
$$;

create or replace function public.apply_no_show_policy(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy text := public.setting('no_show_downpayment_policy', 'retain');
  v_paid numeric;
begin
  v_paid := public.booking_paid_total(p_id);
  if v_policy = 'credit' then
    update public.bookings set credit_held = v_paid where id = p_id;
  else
    update public.bookings set credit_held = 0 where id = p_id;
  end if;
  perform public.sync_paid_amount(p_id);
end;
$$;

create or replace function public.guest_active_booking(p_guest uuid default auth.uid())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_rooms jsonb;
  v_rentals jsonb;
begin
  if p_guest is null then
    raise exception 'Sign in required';
  end if;
  if p_guest is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  perform public.process_booking_lifecycle();
  select * into b
  from public.bookings as bk
  where bk.guest_id = p_guest
    and bk.status = any (public.guest_active_statuses())
  order by bk.created_at desc
  limit 1;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(rm.name || ' ' || u.name order by rm.sort_order, u.sort_order), '[]'::jsonb)
    into v_rooms
  from public.booking_rooms br
  join public.room_units u on u.id = br.room_unit_id
  join public.rooms rm on rm.id = u.room_id
  where br.booking_id = b.id;

  select coalesce(jsonb_agg(jsonb_build_object('name', rt.name, 'qty', br.qty) order by rt.name), '[]'::jsonb)
    into v_rentals
  from public.booking_rentals br
  join public.rentals rt on rt.id = br.rental_id
  where br.booking_id = b.id;

  return to_jsonb(b) || jsonb_build_object(
    'rooms', v_rooms,
    'rental_items', v_rentals,
    'paid_total', public.booking_paid_total(b.id),
    'amount_due', public.booking_amount_due(b.id)
  );
end;
$$;

create or replace function public.record_collected_payment(
  p_id uuid,
  p_cash numeric,
  p_ewallet numeric,
  p_type public.payment_type
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due numeric;
  v_tendered numeric := coalesce(p_cash, 0) + coalesce(p_ewallet, 0);
  v_pid uuid;
begin
  v_due := public.booking_amount_due(p_id);
  if v_tendered + 0.009 < v_due then
    raise exception 'Payment is short. Amount due is %', v_due;
  end if;
  if v_due > 0 then
    insert into public.payments (booking_id, type, method, amount, status, received_by, paid_at, receipt_no, notes)
    values (
      p_id,
      p_type,
      (case when coalesce(p_ewallet, 0) > coalesce(p_cash, 0) then 'ewallet' else 'cash' end)::public.payment_method,
      v_due,
      'paid'::public.payment_status,
      auth.uid(),
      now(),
      'OR-' || lpad(nextval('public.receipt_seq')::text, 6, '0'),
      'Cash ' || coalesce(p_cash, 0)::text || ' / E-wallet ' || coalesce(p_ewallet, 0)::text
    )
    returning id into v_pid;
    perform public.sync_paid_amount(p_id);
  end if;
  return jsonb_build_object(
    'due', v_due,
    'change', greatest(v_tendered - v_due, 0),
    'payment_id', v_pid
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
  v_included int;
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

  v_included := b.pax;
  update public.bookings
  set actual_pax = greatest(p_actual_pax, 1),
      excess_pax = greatest(greatest(p_actual_pax, 1) - v_included, 0),
      checkin_extra_hours = greatest(p_extra_hours, 0)
  where id = p_id
  returning * into b;

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
      check_out_at = public.booking_ends_at(b)
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

create or replace function public.check_out_booking(
  p_id uuid,
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
  v_next_status public.booking_status;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  select * into b from public.bookings where id = p_id for update;
  if b.status not in ('checked_in', 'checked_out') then
    raise exception 'Guest is not checked in';
  end if;
  if exists (select 1 from public.rental_dispatches rd where rd.booking_id = p_id and rd.status = 'out') then
    raise exception 'Return all rentals before checkout';
  end if;

  v_collected := public.record_collected_payment(p_id, p_cash, p_ewallet, 'balance'::public.payment_type);
  v_due := (v_collected->>'due')::numeric;
  v_next_status := (case when public.booking_amount_due(p_id) = 0 then 'completed' else 'checked_out' end)::public.booking_status;

  update public.bookings as bk
  set status = v_next_status,
      checked_out_by = coalesce(bk.checked_out_by, auth.uid()),
      checked_out_at = coalesce(bk.checked_out_at, now())
  where bk.id = p_id
  returning * into b;

  update public.room_units as ru
  set status = 'cleaning',
      turnaround_until = now() + interval '25 minutes',
      check_out_at = now()
  where ru.current_booking_id = p_id and ru.status = 'occupied';

  if v_next_status = 'completed' then
    perform public.notify_once(b.guest_id, 'Stay completed', b.reference || ' is complete. Thank you for visiting CK Resort.', b.id);
  end if;
  perform public.audit('check_out', 'booking', b.id, v_collected);

  return jsonb_build_object(
    'booking', to_jsonb(b),
    'due', v_due,
    'change', (v_collected->>'change')::numeric,
    'payment_id', v_collected->>'payment_id'
  );
end;
$$;

create or replace function public.occupied_dates(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.process_booking_lifecycle();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date', bk.stay_date,
      'slots', public.booking_slots(bk.tour_type, bk.event_when),
      'reference', bk.reference
    ) order by bk.stay_date), '[]'::jsonb)
    from public.bookings as bk
    where bk.stay_date between p_from and p_to
      and bk.status in ('pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in')
  );
end;
$$;

grant execute on function public.quote_booking(jsonb) to anon, authenticated;
grant execute on function public.approve_booking(uuid, numeric) to authenticated;
grant execute on function public.check_in_booking(uuid, int, int, numeric, numeric) to authenticated;
grant execute on function public.check_out_booking(uuid, numeric, numeric) to authenticated;
grant execute on function public.occupied_dates(date, date) to anon, authenticated;
grant execute on function public.guest_active_booking(uuid) to authenticated;

notify pgrst, 'reload schema';
