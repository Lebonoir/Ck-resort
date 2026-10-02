-- Instant downpayment: guests no longer wait for manager approval.
-- A submitted booking goes straight to 'awaiting_downpayment' (it already holds
-- its slot) with a payment deadline. PayMongo's webhook / verify call runs
-- server_confirm_downpayment, which flips it to 'confirmed' once paid. If the
-- deadline passes unpaid, process_booking_lifecycle expires it and frees the slot.
-- Run in the Supabase SQL editor. Safe to re-run.

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
    total_amount, downpayment_amount, payment_due_at
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
    'awaiting_downpayment',
    q->>'package_label',
    coalesce(q->'lines', '[]'::jsonb),
    (q->>'total')::numeric,
    (q->>'downpayment')::numeric,
    least(
      now() + (coalesce(public.setting('downpayment_hours', '48'), '48') || ' hours')::interval,
      public.booking_window_start(tour, stay, payload->>'overnight_shift', payload->>'event_when')
    )
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
    'New booking awaiting downpayment',
    b.guest_name || ' reserved ' || b.reference || ' for ' || b.stay_date::text || '. It is confirmed once the 50% downpayment is paid.',
    b.id
  );
  perform public.audit('submit_booking', 'booking', b.id, jsonb_build_object('reference', b.reference));

  return to_jsonb(b);
end;
$$;

grant execute on function public.submit_booking(jsonb) to authenticated;
