-- Fix: column "method" is of type payment_method but expression is of type text
-- Run this in the Supabase SQL Editor (one query). Safe to re-run.

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

notify pgrst, 'reload schema';
