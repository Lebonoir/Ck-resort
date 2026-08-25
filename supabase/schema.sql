-- CK Resort & Events Place — full schema
-- Run this entire file in the Supabase SQL Editor (once).
-- Then run booking_lifecycle_types.sql, commit, then booking_lifecycle.sql.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('guest', 'front_desk', 'staff', 'admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.booking_status as enum (
    'pending_approval',
    'rejected',
    'awaiting_downpayment',
    'confirmed',
    'checked_in',
    'checked_out',
    'completed',
    'cancelled',
    'expired',
    'no_show'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.tour_type as enum ('day', 'night', 'overnight', 'event');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_type as enum ('downpayment', 'balance', 'onsite', 'full');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_method as enum ('paymongo', 'cash', 'ewallet', 'bank');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.room_status as enum ('available', 'occupied', 'cleaning');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.dispatch_status as enum ('out', 'returned');
exception when duplicate_object then null;
end $$;

create sequence if not exists public.booking_ref_seq start 1001;
create sequence if not exists public.receipt_seq start 1;

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  contact text not null default '',
  email text,
  role public.user_role not null default 'guest',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  role public.user_role not null,
  invited_by uuid references public.profiles (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.rate_settings (
  key text primary key,
  label text not null,
  amount numeric(12,2) not null check (amount >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.overnight_tiers (
  pax_cap int primary key check (pax_cap > 0),
  amount numeric(12,2) not null check (amount >= 0)
);

create table if not exists public.event_bands (
  max_pax int primary key check (max_pax > 0),
  day_amount numeric(12,2) not null check (day_amount >= 0),
  night_amount numeric(12,2) not null check (night_amount >= 0)
);

create table if not exists public.tour_hour_rates (
  tour_type text not null check (tour_type in ('day', 'night')),
  hours int not null check (hours > 0),
  amount numeric(12,2) not null check (amount >= 0),
  primary key (tour_type, hours)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  requires_room_id uuid references public.rooms (id),
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table if not exists public.room_units (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  slug text not null unique,
  name text not null,
  bed_count int not null default 0,
  capacity int not null default 0,
  rate numeric(12,2) not null check (rate >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  status public.room_status not null default 'available',
  current_booking_id uuid,
  check_in_at timestamptz,
  check_out_at timestamptz,
  turnaround_until timestamptz
);

create table if not exists public.rentals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  price numeric(12,2) not null check (price >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table if not exists public.caterers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_partner boolean not null default true,
  is_active boolean not null default true
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  guest_id uuid references public.profiles (id),
  guest_name text not null,
  guest_contact text not null default '',
  created_by uuid references public.profiles (id),
  is_walk_in boolean not null default false,
  tour_type public.tour_type not null,
  stay_date date not null,
  pax int not null check (pax >= 1),
  hours int not null default 8,
  extra_hours int not null default 0 check (extra_hours >= 0),
  overnight_shift text,
  event_when text,
  pets int not null default 0 check (pets >= 0),
  caterer_id uuid references public.caterers (id),
  status public.booking_status not null default 'pending_approval',
  package_label text not null default '',
  quote_lines jsonb not null default '[]'::jsonb,
  total_amount numeric(12,2) not null default 0,
  override_amount numeric(12,2),
  downpayment_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  actual_pax int,
  excess_pax int not null default 0,
  checkin_extra_hours int not null default 0,
  rejection_reason text,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  checked_in_by uuid references public.profiles (id),
  checked_in_at timestamptz,
  checked_out_by uuid references public.profiles (id),
  checked_out_at timestamptz,
  payment_due_at timestamptz,
  expired_at timestamptz,
  credit_held numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookings
  add column if not exists payment_due_at timestamptz,
  add column if not exists checked_out_at timestamptz,
  add column if not exists checked_out_by uuid references public.profiles (id),
  add column if not exists expired_at timestamptz,
  add column if not exists credit_held numeric(12,2) not null default 0;

alter table public.room_units
  drop constraint if exists room_units_current_booking_id_fkey;
alter table public.room_units
  add constraint room_units_current_booking_id_fkey
  foreign key (current_booking_id) references public.bookings (id) on delete set null;

create table if not exists public.booking_rooms (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  room_unit_id uuid not null references public.room_units (id),
  rate_snapshot numeric(12,2) not null,
  primary key (booking_id, room_unit_id)
);

create table if not exists public.booking_rentals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  rental_id uuid not null references public.rentals (id),
  qty int not null default 1 check (qty >= 1),
  rate_snapshot numeric(12,2) not null
);

create table if not exists public.booking_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  type public.payment_type not null,
  method public.payment_method not null,
  amount numeric(12,2) not null check (amount >= 0),
  status public.payment_status not null default 'pending',
  paymongo_checkout_id text,
  paymongo_payment_id text,
  receipt_no text unique,
  proof_url text,
  received_by uuid references public.profiles (id),
  notes text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.rental_dispatches (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  rental_id uuid not null references public.rentals (id),
  qty int not null default 1 check (qty >= 1),
  status public.dispatch_status not null default 'out',
  dispatched_by uuid references public.profiles (id),
  dispatched_at timestamptz not null default now(),
  returned_by uuid references public.profiles (id),
  returned_at timestamptz
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  booking_id uuid references public.bookings (id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bookings_date_idx on public.bookings (stay_date);
create index if not exists bookings_status_idx on public.bookings (status);
create index if not exists bookings_guest_idx on public.bookings (guest_id);
create index if not exists payments_booking_idx on public.payments (booking_id);
create index if not exists notifications_user_idx on public.notifications (user_id, is_read);
create index if not exists dispatches_booking_idx on public.rental_dispatches (booking_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_bookings_updated on public.bookings;
create trigger trg_bookings_updated before update on public.bookings
for each row execute procedure public.set_updated_at();

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' and is_active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_desk()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role in ('front_desk', 'admin') and is_active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role in ('staff', 'front_desk', 'admin') and is_active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.booking_slots(p_tour public.tour_type, p_event_when text)
returns text[]
language sql
immutable
as $$
  select case
    when p_tour = 'overnight' then array['day', 'night']
    when p_tour = 'night' or (p_tour = 'event' and p_event_when = 'night') then array['night']
    else array['day']
  end
$$;

create or replace function public.rate_amount(p_key text)
returns numeric
language sql
stable
as $$
  select coalesce((select amount from public.rate_settings where key = p_key), 0)
$$;

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

create or replace function public.slots_taken(p_date date, p_slots text[], p_ignore uuid default null)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.bookings b
    where b.stay_date = p_date
      and b.status in ('pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in')
      and (p_ignore is null or b.id <> p_ignore)
      and public.booking_slots(b.tour_type, b.event_when) && p_slots
  )
$$;

create or replace function public.notify_admins(p_title text, p_body text, p_booking uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, title, body, booking_id)
  select id, p_title, p_body, p_booking from public.profiles where role = 'admin' and is_active
$$;

create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_booking uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, title, body, booking_id)
  values (p_user, p_title, p_body, p_booking)
$$;

create or replace function public.audit(p_action text, p_entity text, p_id uuid, p_meta jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, p_entity, p_id, coalesce(p_meta, '{}'::jsonb))
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned public.user_role := 'guest';
  invite public.staff_invites%rowtype;
  invite_name text := '';
  admin_count int;
begin
  select * into invite
  from public.staff_invites
  where lower(email) = lower(new.email) and used_at is null
  limit 1;

  if found then
    assigned := invite.role;
    invite_name := invite.full_name;
    update public.staff_invites set used_at = now() where id = invite.id;
  else
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count = 0 then
      assigned := 'admin';
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name, contact, email, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'first_name', ''), split_part(invite_name, ' ', 1), ''),
    coalesce(nullif(new.raw_user_meta_data->>'last_name', ''), nullif(split_part(invite_name, ' ', 2), ''), ''),
    coalesce(new.raw_user_meta_data->>'contact', ''),
    new.email,
    assigned
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

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
  r record;
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

  slots := public.booking_slots((payload->>'tour_type')::public.tour_type, payload->>'event_when');
  if public.slots_taken((payload->>'stay_date')::date, slots) then
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
      and bx.stay_date = (payload->>'stay_date')::date
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
    (payload->>'tour_type')::public.tour_type,
    (payload->>'stay_date')::date,
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

create or replace function public.create_walk_in(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q jsonb;
  slots text[];
begin
  if not public.is_desk() then
    raise exception 'Front desk only';
  end if;
  if coalesce(trim(payload->>'guest_name'), '') = '' then
    raise exception 'Guest name is required';
  end if;
  slots := public.booking_slots((payload->>'tour_type')::public.tour_type, payload->>'event_when');
  if public.slots_taken(coalesce((payload->>'stay_date')::date, current_date), slots) then
    raise exception 'That slot is already booked';
  end if;
  q := public.quote_booking(payload || jsonb_build_object('stay_date', coalesce(payload->>'stay_date', current_date::text)));

  insert into public.bookings (
    reference, guest_name, guest_contact, created_by, is_walk_in, tour_type, stay_date, pax, hours,
    extra_hours, overnight_shift, event_when, pets, status, package_label, quote_lines, total_amount,
    downpayment_amount
  ) values (
    'WI-' || lpad(nextval('public.booking_ref_seq')::text, 4, '0'),
    trim(payload->>'guest_name'),
    coalesce(payload->>'guest_contact', ''),
    auth.uid(),
    true,
    (payload->>'tour_type')::public.tour_type,
    coalesce((payload->>'stay_date')::date, current_date),
    greatest(coalesce((payload->>'pax')::int, 20), 1),
    coalesce((payload->>'hours')::int, 8),
    0,
    payload->>'overnight_shift',
    payload->>'event_when',
    0,
    'confirmed',
    'Walk-in · ' || (q->>'package_label'),
    coalesce(q->'lines', '[]'::jsonb),
    (q->>'total')::numeric,
    0
  ) returning * into b;

  perform public.audit('create_walk_in', 'booking', b.id, jsonb_build_object('reference', b.reference));
  return to_jsonb(b);
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
      b.reference || ' was approved. Please pay the 50% downpayment to confirm.',
      b.id
    );
  end if;
  perform public.audit('approve_booking', 'booking', b.id, '{}'::jsonb);
  return to_jsonb(b);
end;
$$;

create or replace function public.reject_booking(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  select * into b from public.bookings where id = p_id for update;
  if b.status <> 'pending_approval' then
    raise exception 'Only pending bookings can be rejected';
  end if;
  update public.bookings
  set status = 'rejected', rejection_reason = nullif(trim(p_reason), ''), approved_by = auth.uid(), approved_at = now()
  where id = p_id
  returning * into b;
  if b.guest_id is not null then
    perform public.notify_user(b.guest_id, 'Booking declined', coalesce(b.rejection_reason, 'Your request was not approved.'), b.id);
  end if;
  perform public.audit('reject_booking', 'booking', b.id, jsonb_build_object('reason', p_reason));
  return to_jsonb(b);
end;
$$;

create or replace function public.cancel_booking(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_id for update;
  if b.guest_id <> auth.uid() and not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if b.status not in ('pending_approval', 'awaiting_downpayment') then
    raise exception 'This booking can no longer be cancelled';
  end if;
  update public.bookings set status = 'cancelled' where id = p_id returning * into b;
  perform public.audit('cancel_booking', 'booking', b.id, '{}'::jsonb);
  return to_jsonb(b);
end;
$$;

create or replace function public.server_prepare_downpayment(p_secret text, p_booking uuid, p_checkout_id text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  b public.bookings;
  pid uuid;
begin
  select value into expected from public.app_settings where key = 'internal_api_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'Unauthorized';
  end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.status <> 'awaiting_downpayment' then
    raise exception 'Booking is not awaiting downpayment';
  end if;
  if abs(p_amount - b.downpayment_amount) > 0.009 then
    raise exception 'Amount does not match required downpayment';
  end if;
  select id into pid from public.payments
  where booking_id = p_booking and type = 'downpayment' and status = 'pending'
  order by created_at desc limit 1;
  if pid is not null then
    update public.payments
    set paymongo_checkout_id = p_checkout_id, amount = p_amount
    where id = pid;
    return pid;
  end if;
  insert into public.payments (booking_id, type, method, amount, status, paymongo_checkout_id)
  values (p_booking, 'downpayment', 'paymongo', p_amount, 'pending', p_checkout_id)
  returning id into pid;
  return pid;
end;
$$;

create or replace function public.server_pending_checkout(p_secret text, p_booking uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  checkout_id text;
begin
  select value into expected from public.app_settings where key = 'internal_api_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'Unauthorized';
  end if;
  select paymongo_checkout_id into checkout_id
  from public.payments
  where booking_id = p_booking and paymongo_checkout_id is not null
  order by created_at desc
  limit 1;
  return checkout_id;
end;
$$;

create or replace function public.server_confirm_downpayment(p_secret text, p_checkout_id text, p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  pay public.payments;
  b public.bookings;
begin
  select value into expected from public.app_settings where key = 'internal_api_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'Unauthorized';
  end if;
  select * into pay from public.payments where paymongo_checkout_id = p_checkout_id for update;
  if not found then
    raise exception 'Payment not found';
  end if;
  if pay.status = 'paid' then
    select * into b from public.bookings where id = pay.booking_id;
    return to_jsonb(b);
  end if;
  update public.payments
  set status = 'paid',
      paymongo_payment_id = p_payment_id,
      paid_at = now(),
      receipt_no = coalesce(receipt_no, 'OR-' || lpad(nextval('public.receipt_seq')::text, 6, '0'))
  where id = pay.id;

  update public.bookings
  set status = 'confirmed',
      paid_amount = paid_amount + pay.amount
  where id = pay.booking_id
  returning * into b;

  if b.guest_id is not null then
    perform public.notify_user(b.guest_id, 'Reservation confirmed', b.reference || ' is confirmed. Present this at the front desk.', b.id);
  end if;
  perform public.notify_admins('Downpayment received', b.reference || ' is now confirmed.', b.id);
  return to_jsonb(b);
end;
$$;

create or replace function public.add_booking_charge(p_booking uuid, p_description text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.booking_charges;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  if coalesce(trim(p_description), '') = '' or p_amount < 0 then
    raise exception 'Invalid charge';
  end if;
  insert into public.booking_charges (booking_id, description, amount, created_by)
  values (p_booking, trim(p_description), p_amount, auth.uid())
  returning * into row;
  return to_jsonb(row);
end;
$$;

create or replace function public.booking_paid_total(p_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.payments
  where booking_id = p_id and status = 'paid'
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

create or replace function public.booking_amount_due(p_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_id;
  if not found then
    return 0;
  end if;
  if b.status in ('expired', 'no_show', 'cancelled', 'rejected') then
    return 0;
  end if;
  return greatest(public.booking_final_bill(p_id) - public.booking_paid_total(p_id), 0);
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

create or replace function public.set_room_status(p_unit uuid, p_status public.room_status)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.room_units;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  update public.room_units
  set status = p_status,
      turnaround_until = case
        when p_status = 'cleaning' then now() + interval '25 minutes'
        else null
      end,
      current_booking_id = case when p_status = 'available' then null else current_booking_id end,
      check_in_at = case when p_status = 'available' then null else check_in_at end,
      check_out_at = case when p_status = 'available' then null else check_out_at end
  where id = p_unit
  returning * into u;
  return to_jsonb(u);
end;
$$;

create or replace function public.dispatch_rental(p_booking uuid, p_rental uuid, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.rental_dispatches;
  b public.bookings;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  select * into b from public.bookings where id = p_booking;
  if b.status <> 'checked_in' then
    raise exception 'Guest must be checked in before dispatch';
  end if;
  insert into public.rental_dispatches (booking_id, rental_id, qty, dispatched_by)
  values (p_booking, p_rental, greatest(p_qty, 1), auth.uid())
  returning * into row;
  return to_jsonb(row);
end;
$$;

create or replace function public.return_rental(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.rental_dispatches;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  update public.rental_dispatches
  set status = 'returned', returned_by = auth.uid(), returned_at = now()
  where id = p_id and status = 'out'
  returning * into row;
  if not found then raise exception 'Dispatch not found or already returned'; end if;
  return to_jsonb(row);
end;
$$;

create or replace function public.invite_staff(p_email text, p_name text, p_role public.user_role)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.staff_invites;
  given_name text;
  family_name text;
  full_name text;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_email is null or p_email !~* '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  full_name := trim(coalesce(p_name, ''));
  given_name := split_part(full_name, ' ', 1);
  family_name := nullif(trim(substr(full_name, length(given_name) + 1)), '');

  insert into public.staff_invites (email, full_name, role, invited_by, used_at)
  values (
    lower(trim(p_email)),
    coalesce(nullif(full_name, ''), lower(trim(p_email))),
    p_role,
    auth.uid(),
    case when p_role = 'guest' then now() else null end
  )
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        invited_by = excluded.invited_by,
        used_at = case when excluded.role = 'guest' then now() else null end
  returning * into row;

  update public.profiles
  set role = p_role,
      first_name = case when coalesce(given_name, '') <> '' then given_name else first_name end,
      last_name = case when family_name is not null then family_name else last_name end
  where lower(email) = lower(trim(p_email));

  return to_jsonb(row);
end;
$$;

drop function if exists public.admin_update_account(jsonb);
drop function if exists public.admin_create_account(jsonb);

create or replace function public.admin_update_account(
  p_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_contact text,
  p_role public.user_role,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
  admin_count int;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if coalesce(trim(p_first_name), '') = '' then
    raise exception 'First name is required';
  end if;
  if p_email is null or p_email !~* '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_id = auth.uid() and coalesce(p_is_active, true) is false then
    raise exception 'You cannot deactivate the account you are signed in with';
  end if;

  select * into target from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Account not found';
  end if;

  if target.role = 'admin' and (p_role <> 'admin' or coalesce(p_is_active, true) is false) then
    select count(*) into admin_count from public.profiles where role = 'admin' and is_active and id <> p_id;
    if admin_count < 1 then
      raise exception 'Keep at least one active admin account';
    end if;
  end if;

  update public.profiles
  set first_name = trim(p_first_name),
      last_name = trim(coalesce(p_last_name, '')),
      email = lower(trim(p_email)),
      contact = trim(coalesce(p_contact, '')),
      role = p_role,
      is_active = coalesce(p_is_active, true)
  where id = p_id
  returning * into target;

  insert into public.staff_invites (email, full_name, role, invited_by, used_at)
  values (
    lower(trim(p_email)),
    trim(p_first_name || ' ' || coalesce(p_last_name, '')),
    p_role,
    auth.uid(),
    case when p_role = 'guest' then now() else null end
  )
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        invited_by = excluded.invited_by,
        used_at = case when excluded.role = 'guest' then now() else null end;

  perform public.notify_user(
    p_id,
    'Account updated',
    'Your CK Resort account was updated. Role: ' || p_role::text || '. Sign in again or refresh to open the matching workspace.',
    null
  );
  perform public.audit('update_account', 'profile', p_id, jsonb_build_object('role', p_role, 'is_active', p_is_active));
  return to_jsonb(target);
end;
$$;

create or replace function public.admin_delete_account(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
  admin_count int;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_id = auth.uid() then
    raise exception 'You cannot delete the account you are signed in with';
  end if;

  select * into target from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Account not found';
  end if;

  if target.role = 'admin' then
    select count(*) into admin_count from public.profiles where role = 'admin' and is_active and id <> p_id;
    if admin_count < 1 then
      raise exception 'Keep at least one active admin account';
    end if;
  end if;

  update public.bookings set guest_id = null where guest_id = p_id;
  update public.bookings set created_by = null where created_by = p_id;
  update public.bookings set approved_by = null where approved_by = p_id;
  update public.bookings set checked_in_by = null where checked_in_by = p_id;
  update public.booking_charges set created_by = null where created_by = p_id;
  update public.payments set received_by = null where received_by = p_id;
  update public.rental_dispatches set dispatched_by = null where dispatched_by = p_id;
  update public.rental_dispatches set returned_by = null where returned_by = p_id;
  update public.audit_logs set actor_id = null where actor_id = p_id;
  update public.staff_invites set invited_by = null where invited_by = p_id;
  delete from public.staff_invites where lower(email) = lower(coalesce(target.email, ''));
  delete from public.notifications where user_id = p_id;
  delete from public.profiles where id = p_id;

  perform public.audit('delete_account', 'profile', p_id, jsonb_build_object('email', target.email, 'role', target.role));
  return jsonb_build_object('id', p_id, 'email', target.email, 'deleted', true);
end;
$$;

create or replace function public.profiles_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count int;
begin
  if TG_OP = 'DELETE' then
    if OLD.role = 'admin' and OLD.is_active then
      select count(*) into admin_count from public.profiles where role = 'admin' and is_active and id <> OLD.id;
      if admin_count < 1 then
        raise exception 'Keep at least one active admin account';
      end if;
    end if;
    return OLD;
  end if;

  if OLD.role = 'admin' and OLD.is_active and (NEW.role <> 'admin' or NEW.is_active is false) then
    select count(*) into admin_count from public.profiles where role = 'admin' and is_active and id <> NEW.id;
    if admin_count < 1 then
      raise exception 'Keep at least one active admin account';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_protect_last_admin on public.profiles;
create trigger trg_profiles_protect_last_admin
before update or delete on public.profiles
for each row execute procedure public.profiles_protect_last_admin();

create or replace function public.save_rate(p_key text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.rate_settings set amount = p_amount, updated_at = now() where key = p_key;
  if not found then
    update public.overnight_tiers set amount = p_amount where ('overnight_' || pax_cap) = p_key;
  end if;
end;
$$;

create or replace function public.occupied_dates(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', stay_date,
    'slots', public.booking_slots(tour_type, event_when),
    'reference', reference
  ) order by stay_date), '[]'::jsonb)
  from public.bookings
  where stay_date between p_from and p_to
    and status in ('pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in')
$$;

create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pending int;
  occupancy numeric;
  cin int;
  cout int;
  revenue numeric;
  dp_due numeric;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select count(*) into pending from public.bookings where status = 'pending_approval';
  select round(
    100.0 * count(*) filter (where status = 'occupied') / greatest(count(*), 1),
    1
  ) into occupancy from public.room_units where is_active;
  select count(*) into cin from public.bookings where checked_in_at::date = current_date;
  select count(*) into cout from public.room_units
    where status = 'occupied' and check_out_at::date = current_date;
  select coalesce(sum(amount), 0) into revenue from public.payments where status = 'paid';
  select coalesce(sum(downpayment_amount), 0) into dp_due
  from public.bookings where status = 'awaiting_downpayment';
  return jsonb_build_object(
    'pending', pending,
    'occupancy', occupancy,
    'checkins_today', cin,
    'checkouts_today', cout,
    'revenue', revenue,
    'downpayment_due', dp_due
  );
end;
$$;

create or replace function public.admin_reports()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'by_package', (
      select coalesce(jsonb_agg(jsonb_build_object('label', tour_type, 'count', n, 'amount', amount)), '[]'::jsonb)
      from (
        select tour_type::text, count(*) as n, coalesce(sum(paid_amount), 0) as amount
        from public.bookings
        where status not in ('rejected', 'cancelled')
        group by tour_type
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
      ) order by p.created_at desc), '[]'::jsonb)
      from public.payments p
      join public.bookings b on b.id = p.booking_id
    )
  )
  from (select public.is_admin() as ok) x
  where x.ok
$$;

grant execute on function public.quote_booking(jsonb) to anon, authenticated;
grant execute on function public.occupied_dates(date, date) to anon, authenticated;
grant execute on function public.submit_booking(jsonb) to authenticated;
grant execute on function public.create_walk_in(jsonb) to authenticated;
grant execute on function public.approve_booking(uuid, numeric) to authenticated;
grant execute on function public.reject_booking(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.server_prepare_downpayment(text, uuid, text, numeric) to anon, authenticated;
grant execute on function public.server_confirm_downpayment(text, text, text) to anon, authenticated;
grant execute on function public.server_pending_checkout(text, uuid) to anon, authenticated;
grant execute on function public.add_booking_charge(uuid, text, numeric) to authenticated;
grant execute on function public.booking_amount_due(uuid) to authenticated;
grant execute on function public.booking_final_bill(uuid) to authenticated;
grant execute on function public.check_in_booking(uuid, int, int, numeric, numeric) to authenticated;
grant execute on function public.check_out_booking(uuid, numeric, numeric) to authenticated;
grant execute on function public.set_room_status(uuid, public.room_status) to authenticated;
grant execute on function public.dispatch_rental(uuid, uuid, int) to authenticated;
grant execute on function public.return_rental(uuid) to authenticated;
grant execute on function public.invite_staff(text, text, public.user_role) to authenticated;
grant execute on function public.admin_update_account(uuid, text, text, text, text, public.user_role, boolean) to authenticated;
grant execute on function public.admin_delete_account(uuid) to authenticated;
grant execute on function public.save_rate(text, numeric) to authenticated;
grant execute on function public.admin_metrics() to authenticated;
grant execute on function public.admin_reports() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_desk() to authenticated;
grant execute on function public.is_ops() to authenticated;

alter table public.profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.rate_settings enable row level security;
alter table public.overnight_tiers enable row level security;
alter table public.event_bands enable row level security;
alter table public.tour_hour_rates enable row level security;
alter table public.rooms enable row level security;
alter table public.room_units enable row level security;
alter table public.rentals enable row level security;
alter table public.caterers enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_rooms enable row level security;
alter table public.booking_rentals enable row level security;
alter table public.booking_charges enable row level security;
alter table public.payments enable row level security;
alter table public.rental_dispatches enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.is_desk());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists invites_admin on public.staff_invites;
create policy invites_admin on public.staff_invites for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists catalog_read_rates on public.rate_settings;
create policy catalog_read_rates on public.rate_settings for select to authenticated, anon using (true);
drop policy if exists catalog_read_overnight on public.overnight_tiers;
create policy catalog_read_overnight on public.overnight_tiers for select to authenticated, anon using (true);
drop policy if exists catalog_read_events on public.event_bands;
create policy catalog_read_events on public.event_bands for select to authenticated, anon using (true);
drop policy if exists catalog_read_hours on public.tour_hour_rates;
create policy catalog_read_hours on public.tour_hour_rates for select to authenticated, anon using (true);
drop policy if exists catalog_read_rooms on public.rooms;
create policy catalog_read_rooms on public.rooms for select to authenticated, anon using (true);
drop policy if exists catalog_read_units on public.room_units;
create policy catalog_read_units on public.room_units for select to authenticated, anon using (true);
drop policy if exists catalog_read_rentals on public.rentals;
create policy catalog_read_rentals on public.rentals for select to authenticated, anon using (true);
drop policy if exists catalog_read_caterers on public.caterers;
create policy catalog_read_caterers on public.caterers for select to authenticated, anon using (true);

drop policy if exists admin_write_rates on public.rate_settings;
create policy admin_write_rates on public.rate_settings for update to authenticated using (public.is_admin());
drop policy if exists admin_write_overnight on public.overnight_tiers;
create policy admin_write_overnight on public.overnight_tiers for update to authenticated using (public.is_admin());
drop policy if exists admin_write_events on public.event_bands;
create policy admin_write_events on public.event_bands for update to authenticated using (public.is_admin());
drop policy if exists admin_write_hours on public.tour_hour_rates;
create policy admin_write_hours on public.tour_hour_rates for update to authenticated using (public.is_admin());
drop policy if exists admin_write_units on public.room_units;
create policy admin_write_units on public.room_units for update to authenticated using (public.is_admin() or public.is_ops());

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated
  using (guest_id = auth.uid() or public.is_ops());

drop policy if exists booking_rooms_select on public.booking_rooms;
create policy booking_rooms_select on public.booking_rooms for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (b.guest_id = auth.uid() or public.is_ops())));

drop policy if exists booking_rentals_select on public.booking_rentals;
create policy booking_rentals_select on public.booking_rentals for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (b.guest_id = auth.uid() or public.is_ops())));

drop policy if exists charges_select on public.booking_charges;
create policy charges_select on public.booking_charges for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (b.guest_id = auth.uid() or public.is_ops())));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and (b.guest_id = auth.uid() or public.is_ops())));

drop policy if exists dispatch_select on public.rental_dispatches;
create policy dispatch_select on public.rental_dispatches for select to authenticated
  using (public.is_ops());

drop policy if exists notes_select on public.notifications;
create policy notes_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notes_update on public.notifications;
create policy notes_update on public.notifications for update to authenticated using (user_id = auth.uid());

drop policy if exists audit_admin on public.audit_logs;
create policy audit_admin on public.audit_logs for select to authenticated using (public.is_admin());

insert into public.app_settings (key, value)
values
  ('internal_api_secret', 'ck-resort-internal-pay-confirm'),
  ('downpayment_hours', '48'),
  ('no_show_grace_minutes', '120'),
  ('no_show_downpayment_policy', 'retain')
on conflict (key) do nothing;

insert into public.rate_settings (key, label, amount) values
  ('day_20', 'Day Tour · 20 pax', 6000),
  ('night_20', 'Night Tour · 20 pax', 7000),
  ('weekend', 'Weekend / holiday add-on', 1000),
  ('extra_hour', 'Extra hour', 1000),
  ('extra_pax_tour', 'Excess pax · day/night', 200),
  ('extra_pax_overnight', 'Excess pax · overnight', 800),
  ('pet', 'Pet fee', 200),
  ('corkage', 'Outside catering corkage', 1500)
on conflict (key) do nothing;

insert into public.overnight_tiers (pax_cap, amount) values
  (10, 12000), (15, 14000), (20, 17000), (25, 21000), (30, 25000),
  (35, 28000), (40, 31000), (45, 34000), (50, 38000), (55, 41000),
  (60, 44000), (65, 47000), (70, 50000)
on conflict (pax_cap) do nothing;

insert into public.event_bands (max_pax, day_amount, night_amount) values
  (50, 10000, 12000),
  (100, 12000, 14000),
  (150, 14000, 16000),
  (200, 16000, 18000)
on conflict (max_pax) do nothing;

insert into public.tour_hour_rates (tour_type, hours, amount) values
  ('day', 8, 7000),
  ('day', 12, 10000),
  ('day', 16, 13000),
  ('night', 8, 8000),
  ('night', 12, 11000),
  ('night', 16, 13000)
on conflict (tour_type, hours) do nothing;

insert into public.rooms (slug, name, sort_order)
select * from (values
  ('gazebo', 'Gazebo Suite', 1),
  ('sunrise', 'Sunrise Suite', 2),
  ('pedro', 'Pedro', 3),
  ('pavilion-ken', 'Pavilion Ken', 4),
  ('tala', 'Tala', 5),
  ('milagros', 'Milagros', 6),
  ('tents', 'Camping Tents', 7)
) as v(slug, name, sort_order)
where not exists (select 1 from public.rooms r where r.slug = v.slug);

update public.rooms s
set requires_room_id = g.id
from public.rooms g
where s.slug = 'sunrise' and g.slug = 'gazebo' and s.requires_room_id is null;

insert into public.room_units (room_id, slug, name, bed_count, capacity, rate, sort_order)
select r.id, v.slug, v.name, v.beds, v.cap, v.rate, v.sort
from public.rooms r
join (values
  ('gazebo', 'gazebo-r1', 'Room 1', 3, 6, 6000, 1),
  ('gazebo', 'gazebo-r2', 'Room 2', 3, 6, 6000, 2),
  ('sunrise', 'sunrise-r1', 'Room 1', 3, 6, 6000, 1),
  ('sunrise', 'sunrise-r2', 'Room 2', 1, 2, 6000, 2),
  ('pedro', 'pedro-r1', 'Room 1', 3, 6, 6000, 1),
  ('pedro', 'pedro-r2', 'Room 2', 4, 12, 10000, 2),
  ('pedro', 'pedro-r3', 'Room 3', 6, 18, 15000, 3),
  ('pavilion-ken', 'pavilion-r1', 'Room 1', 5, 15, 12000, 1),
  ('tala', 'tala-r1', 'Standard', 3, 6, 6000, 1),
  ('milagros', 'milagros-r1', 'Room 1', 5, 15, 12000, 1),
  ('tents', 'tent-1', 'Tent 1', 0, 2, 500, 1),
  ('tents', 'tent-2', 'Tent 2', 0, 2, 500, 2),
  ('tents', 'tent-3', 'Tent 3', 0, 2, 500, 3),
  ('tents', 'tent-4', 'Tent 4', 0, 2, 500, 4),
  ('tents', 'tent-5', 'Tent 5', 0, 2, 500, 5)
) as v(room_slug, slug, name, beds, cap, rate, sort) on v.room_slug = r.slug
where not exists (select 1 from public.room_units u where u.slug = v.slug);

insert into public.rentals (slug, name, price, sort_order)
select * from (values
  ('lpg', 'LP Gas', 250, 1),
  ('butane', 'Butane', 150, 2),
  ('billiard', 'Billiard · unlimited play', 500, 3),
  ('bonfire', 'Bonfire with marshmallow', 500, 4)
) as v(slug, name, price, sort_order)
where not exists (select 1 from public.rentals r where r.slug = v.slug);

insert into public.caterers (name, is_partner)
select * from (values
  ('Mico''s Catering by Vicky Mendoza', true),
  ('Jimsen''s Catering Services', true),
  ('Vin Keileb Catering Services', true),
  ('Cid''s Catering', true),
  ('Kariza''s Catering Service', true),
  ('Tato & Amfher Party Needs & Catering Services', true),
  ('Jaz Kitchen & Catering Services', true),
  ('WJR Styling & Catering Services', true),
  ('LJ Catering', true),
  ('Esper Catering Services', true),
  ('Lissabliss Catering Service', true),
  ('Outside catering', false)
) as v(name, is_partner)
where not exists (select 1 from public.caterers c where c.name = v.name);

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

drop policy if exists payment_proofs_insert on storage.objects;
create policy payment_proofs_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists payment_proofs_select on storage.objects;
create policy payment_proofs_select on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_ops())
);

grant usage on schema public to anon, authenticated, service_role;
grant usage on type public.user_role, public.booking_status, public.tour_type, public.payment_type, public.payment_method, public.payment_status, public.room_status, public.dispatch_status to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on table public.rate_settings, public.overnight_tiers, public.event_bands, public.tour_hour_rates, public.rooms, public.room_units, public.rentals, public.caterers to anon;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;
alter table public.profiles replica identity full;

notify pgrst, 'reload schema';

-- After a fresh install, run booking_lifecycle_types.sql then booking_lifecycle.sql
-- (two separate SQL Editor runs) so expire/no-show/checkout automation is installed.

