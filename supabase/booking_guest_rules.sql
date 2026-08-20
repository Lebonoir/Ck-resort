-- Fix approve_booking hours ambiguity and enforce one active guest reservation.
-- Run this after booking_lifecycle.sql (safe to re-run).

create or replace function public.guest_active_statuses()
returns public.booking_status[]
language sql
immutable
as $$
  select array[
    'pending_approval',
    'awaiting_downpayment',
    'confirmed',
    'checked_in',
    'checked_out'
  ]::public.booking_status[]
$$;

create or replace function public.assert_guest_can_book(p_guest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.bookings;
begin
  if p_guest is null then
    return;
  end if;
  select * into existing
  from public.bookings
  where guest_id = p_guest
    and status = any (public.guest_active_statuses())
  order by created_at desc
  limit 1;
  if found then
    raise exception 'You already have an active reservation (%). Open it from Book a stay or My reservations.', existing.reference;
  end if;
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

create or replace function public.bookings_one_active_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other public.bookings;
begin
  if new.guest_id is null or coalesce(new.is_walk_in, false) then
    return new;
  end if;
  if new.status = any (public.guest_active_statuses()) then
    select * into other
    from public.bookings
    where guest_id = new.guest_id
      and status = any (public.guest_active_statuses())
      and id is distinct from new.id
    order by created_at desc
    limit 1;
    if found then
      raise exception 'You already have an active reservation (%). Open it from Book a stay or My reservations.', other.reference;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_one_active on public.bookings;
create trigger bookings_one_active
before insert or update of status, guest_id
on public.bookings
for each row execute procedure public.bookings_one_active_guard();

do $$
begin
  if exists (
    select 1
    from public.bookings
    where guest_id is not null
      and status = any (array[
        'pending_approval',
        'awaiting_downpayment',
        'confirmed',
        'checked_in',
        'checked_out'
      ]::public.booking_status[])
    group by guest_id
    having count(*) > 1
  ) then
    raise notice 'Skipped unique index: a guest already has more than one active booking';
  else
    execute $idx$
      create unique index if not exists bookings_one_active_per_guest
      on public.bookings (guest_id)
      where guest_id is not null
        and status in (
          'pending_approval',
          'awaiting_downpayment',
          'confirmed',
          'checked_in',
          'checked_out'
        )
    $idx$;
  end if;
end $$;

grant execute on function public.approve_booking(uuid, numeric) to authenticated;
grant execute on function public.guest_active_booking(uuid) to authenticated;
grant execute on function public.guest_active_statuses() to authenticated;
revoke all on function public.assert_guest_can_book(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
