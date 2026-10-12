-- CK Resort · operations update (ELEC 5 notes)
-- Run LAST, after schema.sql, booking_lifecycle*.sql, rpc_ambiguity_fix.sql,
-- booking_rules.sql and admin_extras.sql. One query, safe to re-run.
--
--   Request      direct to the 50% downpayment (no manager approval) + email
--   Rooms        photos; overnight rooms are assigned by headcount, included
--   Rebooking    allowed until N days before the stay, with a fee
--   Cancellation downpayment is not refundable; no-show lands on the blacklist
--   Check-in     collect only / collect & check in, headcount vs room capacity
--   Add-ons      settled add-ons get their own receipt, unsettled ones ride
--                on the balance receipt
--   Damage       report with proof, price and reason; cash only
--   Supplies     in/out log (gas, billiards, bonfire)
--   Utilities    per-area condition checklist

-- ------------------------------------------------------------ 1. settings --
insert into public.app_settings (key, value) values
  ('rebook_min_days', '7'),
  ('max_pets_per_room', '2')
on conflict (key) do nothing;

insert into public.rate_settings (key, label, amount) values
  ('rebook_fee', 'Rebooking fee', 500)
on conflict (key) do nothing;

-- ------------------------------------------------------------- 2. columns --
alter table public.rooms add column if not exists image_url text;
alter table public.room_units add column if not exists image_url text;

alter table public.bookings
  add column if not exists settled_excess_pax int not null default 0,
  add column if not exists settled_extra_hours int not null default 0,
  add column if not exists rebook_count int not null default 0,
  add column if not exists original_stay_date date,
  add column if not exists cancelled_at timestamptz;

alter table public.payments add column if not exists receipt_lines jsonb;

alter table public.booking_charges
  add column if not exists kind text not null default 'addon',
  add column if not exists payment_id uuid references public.payments (id) on delete set null,
  add column if not exists rental_id uuid references public.rentals (id),
  add column if not exists qty int;

do $$ begin
  alter table public.booking_charges
    add constraint booking_charges_kind_check check (kind in ('addon', 'room', 'rebook', 'damage'));
exception when duplicate_object then null;
end $$;

-- Bills that are already fully paid have nothing left to put on a receipt.
update public.booking_charges bc
set payment_id = (
  select p.id from public.payments p
  where p.booking_id = bc.booking_id and p.status = 'paid'
  order by p.paid_at desc nulls last
  limit 1
)
where bc.payment_id is null
  and public.booking_amount_due(bc.booking_id) = 0;

update public.bookings b
set settled_excess_pax = b.excess_pax,
    settled_extra_hours = b.checkin_extra_hours
where (b.settled_excess_pax <> b.excess_pax or b.settled_extra_hours <> b.checkin_extra_hours)
  and public.booking_amount_due(b.id) = 0;

-- -------------------------------------------------------------- 3. tables --
create table if not exists public.blacklist (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references public.profiles (id) on delete set null,
  guest_name text not null default '',
  contact text not null default '',
  email text,
  reason text not null default 'No-show',
  booking_id uuid references public.bookings (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_by uuid references public.profiles (id) on delete set null,
  lifted_at timestamptz
);

create index if not exists blacklist_guest_idx on public.blacklist (guest_id) where lifted_at is null;

create table if not exists public.damage_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  charge_id uuid references public.booking_charges (id) on delete set null,
  item text not null,
  reason text not null,
  amount numeric(12,2) not null check (amount >= 0),
  proof_url text,
  reported_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists damage_booking_idx on public.damage_reports (booking_id);

create table if not exists public.supply_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  unit text not null default 'pc',
  stock int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table if not exists public.supply_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.supply_items (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  qty int not null check (qty >= 1),
  booking_id uuid references public.bookings (id) on delete set null,
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists supply_moves_item_idx on public.supply_moves (item_id, created_at desc);

create table if not exists public.utility_items (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  area_sort int not null default 0,
  room_unit_id uuid references public.room_units (id) on delete cascade,
  name text not null,
  status text not null default 'ok' check (status in ('ok', 'issue', 'missing')),
  note text not null default '',
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (area, name)
);

create table if not exists public.utility_checks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.utility_items (id) on delete cascade,
  status text not null check (status in ('ok', 'issue', 'missing')),
  note text not null default '',
  checked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists utility_checks_item_idx on public.utility_checks (item_id, created_at desc);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_outbox_pending_idx on public.email_outbox (created_at) where sent_at is null;

alter table public.blacklist enable row level security;
alter table public.damage_reports enable row level security;
alter table public.supply_items enable row level security;
alter table public.supply_moves enable row level security;
alter table public.utility_items enable row level security;
alter table public.utility_checks enable row level security;
alter table public.email_outbox enable row level security;

-- Reads only; every write goes through a security-definer RPC below.
drop policy if exists blacklist_select on public.blacklist;
create policy blacklist_select on public.blacklist for select to authenticated
  using (public.is_desk() or guest_id = auth.uid());

drop policy if exists damage_select on public.damage_reports;
create policy damage_select on public.damage_reports for select to authenticated
  using (
    public.is_ops()
    or exists (select 1 from public.bookings b where b.id = booking_id and b.guest_id = auth.uid())
  );

drop policy if exists supply_items_select on public.supply_items;
create policy supply_items_select on public.supply_items for select to authenticated using (public.is_ops());
drop policy if exists supply_moves_select on public.supply_moves;
create policy supply_moves_select on public.supply_moves for select to authenticated using (public.is_ops());
drop policy if exists utility_items_select on public.utility_items;
create policy utility_items_select on public.utility_items for select to authenticated using (public.is_ops());
drop policy if exists utility_checks_select on public.utility_checks;
create policy utility_checks_select on public.utility_checks for select to authenticated using (public.is_ops());

grant select on public.blacklist, public.damage_reports, public.supply_items, public.supply_moves,
  public.utility_items, public.utility_checks to authenticated;
revoke all on public.email_outbox from anon, authenticated;

-- ------------------------------------------------------------ 4. seeding --
insert into public.supply_items (slug, name, category, unit, sort_order)
select * from (values
  ('lpg-tank', 'LPG tank', 'Gas', 'tank', 1),
  ('butane-canister', 'Butane canister', 'Gas', 'can', 2),
  ('billiard-cue', 'Billiard cue (tako)', 'Billiards', 'pc', 3),
  ('billiard-powder', 'Billiard powder', 'Billiards', 'pc', 4),
  ('marshmallow', 'Marshmallow pack', 'Bonfire', 'pack', 5),
  ('bonfire-sticks', 'Bonfire sticks', 'Bonfire', 'bundle', 6),
  ('firewood', 'Firewood (kahoy)', 'Bonfire', 'bundle', 7),
  ('coconut-shell', 'Coconut shell (bao)', 'Bonfire', 'sack', 8)
) as v(slug, name, category, unit, sort_order)
where not exists (select 1 from public.supply_items s where s.slug = v.slug);

-- Every room (tents have no fixtures) gets a bed, TV and washroom check.
insert into public.utility_items (area, area_sort, room_unit_id, name, sort_order)
select rm.name || ' · ' || u.name, rm.sort_order * 10 + u.sort_order, u.id, f.name, f.sort
from public.room_units u
join public.rooms rm on rm.id = u.room_id
cross join (values ('Bed', 1), ('TV', 2), ('Washroom', 3)) as f(name, sort)
where rm.slug <> 'tents'
on conflict (area, name) do nothing;

insert into public.utility_items (area, area_sort, name, sort_order)
values
  ('Gazebo', 900, 'Chairs', 1),
  ('Gazebo', 900, 'Table', 2),
  ('Gazebo', 900, 'TV', 3),
  ('Gazebo', 900, 'Remote', 4),
  ('Function hall', 910, 'TV', 1),
  ('Function hall', 910, 'Hall condition', 2)
on conflict (area, name) do nothing;

insert into storage.buckets (id, name, public)
values ('room-photos', 'room-photos', true), ('damage-proofs', 'damage-proofs', false)
on conflict (id) do nothing;

drop policy if exists room_photos_read on storage.objects;
create policy room_photos_read on storage.objects for select
  using (bucket_id = 'room-photos');
drop policy if exists room_photos_insert on storage.objects;
create policy room_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'room-photos' and public.is_admin());
drop policy if exists room_photos_update on storage.objects;
create policy room_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'room-photos' and public.is_admin());
drop policy if exists room_photos_delete on storage.objects;
create policy room_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'room-photos' and public.is_admin());

drop policy if exists damage_proofs_insert on storage.objects;
create policy damage_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'damage-proofs' and public.is_ops());
drop policy if exists damage_proofs_select on storage.objects;
create policy damage_proofs_select on storage.objects for select to authenticated
  using (bucket_id = 'damage-proofs' and public.is_ops());

-- ------------------------------------------------------------- 5. helpers --
create or replace function public.booking_window_label(b public.bookings)
returns text
language sql
stable
as $$
  select case
    when b.tour_type = 'overnight' then coalesce(nullif(b.overnight_shift, ''), 'Overnight · 22 hours')
    when b.tour_type = 'night' or (b.tour_type = 'event' and b.event_when = 'night') then '5:00 PM – 12:00 AM'
    else '8:00 AM – 4:00 PM'
  end
$$;

create or replace function public.peso_text(p_amount numeric)
returns text
language sql
immutable
as $$
  select 'PHP ' || trim(to_char(coalesce(p_amount, 0), 'FM999,999,990.00'))
$$;

-- The request a booking was made from, so it can be re-quoted on a new date.
create or replace function public.booking_payload(b public.bookings)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tour_type', b.tour_type,
    'stay_date', b.stay_date,
    'pax', b.pax,
    'hours', b.hours,
    'extra_hours', b.extra_hours,
    'overnight_shift', b.overnight_shift,
    'event_when', b.event_when,
    'pets', b.pets,
    'caterer_id', b.caterer_id,
    'room_unit_ids', (
      select coalesce(jsonb_agg(br.room_unit_id), '[]'::jsonb)
      from public.booking_rooms br where br.booking_id = b.id
    ),
    'rentals', (
      select coalesce(jsonb_agg(jsonb_build_object('id', bx.rental_id, 'qty', bx.qty)), '[]'::jsonb)
      from public.booking_rentals bx where bx.booking_id = b.id
    )
  )
$$;

create or replace function public.queue_email(p_user uuid, p_subject text, p_body text, p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if p_user is null then return; end if;
  select email into v_email from public.profiles where id = p_user;
  if coalesce(trim(v_email), '') = '' then return; end if;
  insert into public.email_outbox (to_email, subject, body, booking_id)
  values (trim(v_email), p_subject, p_body, p_booking);
end;
$$;

create or replace function public.server_email_pending(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select value into expected from public.app_settings where key = 'internal_api_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'Unauthorized';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]'::jsonb)
    from (
      select o.id, o.to_email, o.subject, o.body, o.created_at
      from public.email_outbox o
      where o.sent_at is null and o.attempts < 5
      order by o.created_at
      limit 20
    ) q
  );
end;
$$;

create or replace function public.server_email_done(p_secret text, p_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select value into expected from public.app_settings where key = 'internal_api_secret';
  if expected is null or p_secret is distinct from expected then
    raise exception 'Unauthorized';
  end if;
  update public.email_outbox
  set sent_at = case when p_error is null then now() else sent_at end,
      attempts = attempts + 1,
      last_error = p_error
  where id = p_id;
end;
$$;

-- ----------------------------------------------------------- 6. blacklist --
create or replace function public.is_blacklisted(p_guest uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blacklist bl
    where bl.guest_id = p_guest and bl.lifted_at is null
  )
$$;

create or replace function public.guest_blocked()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object('blocked', true, 'reason', bl.reason, 'since', bl.created_at)
      from public.blacklist bl
      where bl.guest_id = auth.uid() and bl.lifted_at is null
      order by bl.created_at desc
      limit 1
    ),
    jsonb_build_object('blocked', false)
  )
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
  if public.is_blacklisted(p_guest) then
    raise exception 'This account is blocked from online booking because of a previous no-show. Please contact the resort.';
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

create or replace function public.blacklist_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  return (
    select coalesce(jsonb_agg(item order by (item->>'created_at') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', bl.id,
        'guest_id', bl.guest_id,
        'guest_name', coalesce(nullif(bl.guest_name, ''), nullif(trim(p.first_name || ' ' || p.last_name), ''), 'Guest'),
        'contact', coalesce(nullif(bl.contact, ''), p.contact, ''),
        'email', coalesce(bl.email, p.email),
        'reason', bl.reason,
        'reference', b.reference,
        'created_at', bl.created_at,
        'lifted_at', bl.lifted_at,
        'added_by', nullif(trim(a.first_name || ' ' || a.last_name), '')
      ) as item
      from public.blacklist bl
      left join public.profiles p on p.id = bl.guest_id
      left join public.profiles a on a.id = bl.created_by
      left join public.bookings b on b.id = bl.booking_id
    ) rows
  );
end;
$$;

create or replace function public.blacklist_add(p_guest uuid, p_name text, p_contact text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles%rowtype;
  row public.blacklist;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  if p_guest is null and coalesce(trim(p_name), '') = '' then
    raise exception 'Pick a guest account or enter a name';
  end if;
  if p_guest is not null then
    select * into target from public.profiles where id = p_guest;
    if not found then raise exception 'Guest account not found'; end if;
    if target.role <> 'guest' then raise exception 'Only guest accounts can be blacklisted'; end if;
    if public.is_blacklisted(p_guest) then raise exception 'That guest is already on the blacklist'; end if;
  end if;
  insert into public.blacklist (guest_id, guest_name, contact, email, reason, created_by)
  values (
    p_guest,
    coalesce(nullif(trim(p_name), ''), trim(target.first_name || ' ' || target.last_name), ''),
    coalesce(nullif(trim(p_contact), ''), target.contact, ''),
    target.email,
    coalesce(nullif(trim(p_reason), ''), 'Added by the resort'),
    auth.uid()
  )
  returning * into row;
  perform public.audit('blacklist_add', 'blacklist', row.id, jsonb_build_object('guest', row.guest_name, 'reason', row.reason));
  return to_jsonb(row);
end;
$$;

create or replace function public.blacklist_lift(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.blacklist;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.blacklist
  set lifted_at = now(), lifted_by = auth.uid()
  where id = p_id and lifted_at is null
  returning * into row;
  if not found then raise exception 'Blacklist entry not found or already lifted'; end if;
  if row.guest_id is not null then
    perform public.notify_user(row.guest_id, 'Booking access restored', 'You can book online at CK Resort again.', null);
  end if;
  perform public.audit('blacklist_lift', 'blacklist', row.id, jsonb_build_object('guest', row.guest_name));
  return to_jsonb(row);
end;
$$;

-- Confirmation, cancellation and no-show all fan out from the status change,
-- so every code path (PayMongo webhook, verify, lifecycle clock) is covered.
create or replace function public.bookings_status_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := public.setting('rebook_min_days', '7')::int;
  v_paid numeric;
  v_total numeric;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'confirmed' and old.status = 'awaiting_downpayment' and not new.is_walk_in then
    v_paid := public.booking_paid_total(new.id);
    v_total := coalesce(new.override_amount, new.total_amount);
    perform public.queue_email(
      new.guest_id,
      'CK Resort reservation confirmed · ' || new.reference,
      'Hi ' || new.guest_name || ',' || E'\n\n'
        || 'We received your 50% downpayment. Your reservation is confirmed.' || E'\n\n'
        || 'Reference: ' || new.reference || E'\n'
        || 'Package: ' || new.package_label || E'\n'
        || 'Date: ' || to_char(new.stay_date, 'FMDay, FMMonth DD, YYYY') || E'\n'
        || 'Time: ' || public.booking_window_label(new) || E'\n'
        || 'Guests: ' || new.pax || ' pax' || E'\n'
        || 'Total: ' || public.peso_text(v_total) || E'\n'
        || 'Paid: ' || public.peso_text(v_paid) || E'\n'
        || 'Balance due at check-in: ' || public.peso_text(greatest(v_total - v_paid, 0)) || E'\n\n'
        || 'Good to know:' || E'\n'
        || '- The downpayment is not refundable.' || E'\n'
        || '- You may rebook up to ' || v_days || ' day(s) before your date. A rebooking fee applies.' || E'\n'
        || '- The balance is settled at the front desk before check-in.' || E'\n'
        || '- A no-show blocks the account from booking online again.' || E'\n\n'
        || 'CK Resort & Events Place' || E'\n'
        || 'St. Duyong, San Simon, Pampanga · 0920 950 2510',
      new.id
    );
  elsif new.status = 'cancelled' and not new.is_walk_in then
    v_paid := public.booking_paid_total(new.id);
    perform public.queue_email(
      new.guest_id,
      'CK Resort reservation cancelled · ' || new.reference,
      'Hi ' || new.guest_name || ',' || E'\n\n'
        || new.reference || ' for ' || to_char(new.stay_date, 'FMMonth DD, YYYY') || ' was cancelled.' || E'\n'
        || case when v_paid > 0
             then 'The downpayment of ' || public.peso_text(v_paid) || ' is not refundable.' || E'\n'
             else 'No payment was collected for this request.' || E'\n'
           end
        || E'\n' || 'CK Resort & Events Place',
      new.id
    );
  elsif new.status = 'no_show' then
    if new.guest_id is not null and not public.is_blacklisted(new.guest_id) then
      insert into public.blacklist (guest_id, guest_name, contact, email, reason, booking_id)
      select new.guest_id, new.guest_name, new.guest_contact, p.email,
             'No-show on ' || to_char(new.stay_date, 'FMMonth DD, YYYY') || ' (' || new.reference || ')',
             new.id
      from public.profiles p where p.id = new.guest_id;
    end if;
    perform public.queue_email(
      new.guest_id,
      'CK Resort · marked as no-show · ' || new.reference,
      'Hi ' || new.guest_name || ',' || E'\n\n'
        || 'We did not see you for ' || new.reference || ' on ' || to_char(new.stay_date, 'FMMonth DD, YYYY') || '.' || E'\n'
        || 'The downpayment is not refundable and the account can no longer book online.' || E'\n'
        || 'Please call the resort if this was a mistake.' || E'\n\n'
        || 'CK Resort & Events Place · 0920 950 2510',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_status_effects on public.bookings;
create trigger bookings_status_effects
after update of status on public.bookings
for each row execute procedure public.bookings_status_effects();

-- --------------------------------------------------------- 7. rules/quote --
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
    'rebook_fee', public.rate_amount('rebook_fee'),
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

create or replace function public.admin_save_ops_rules(p_rebook_min_days int, p_max_pets_per_room int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_rebook_min_days < 0 or p_rebook_min_days > 90 then
    raise exception 'Rebooking cut-off must be between 0 and 90 days';
  end if;
  if p_max_pets_per_room < 0 or p_max_pets_per_room > 20 then
    raise exception 'Pets per room must be between 0 and 20 (0 = no limit)';
  end if;
  insert into public.app_settings (key, value, updated_at) values
    ('rebook_min_days', p_rebook_min_days::text, now()),
    ('max_pets_per_room', p_max_pets_per_room::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('save_ops_rules', 'settings', null, public.booking_rules());
  return public.booking_rules();
end;
$$;

-- Supersedes admin_extras.sql. Only the overnight room block changed: the
-- overnight rate is per head, so the rooms that fit the group are included.
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
  v_room_count int := 0;
  v_pkg_rate numeric := 0;
  v_extra_rooms numeric := 0;
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
    v_room_count := cardinality(unit_ids);
    select string_agg(rm.name || ' ' || u.name, ', ' order by rm.sort_order, u.sort_order), coalesce(sum(u.rate), 0)
      into room_names, extra_fee
    from public.room_units u
    join public.rooms rm on rm.id = u.room_id
    where u.id = any (unit_ids);

    if v_tour = 'overnight' then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Rooms included · ' || coalesce(room_names, 'assigned'),
        'amount', 0
      ));
    elsif v_room_count <= 2 then
      -- Flat package rate covers the first one or two rooms.
      v_pkg_rate := public.rate_amount(case when v_room_count = 1 then 'room_pkg_1' else 'room_pkg_2' end);
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Room package · ' || v_room_count || ' room' || case when v_room_count = 1 then '' else 's' end
                 || ' · ' || coalesce(room_names, 'selected'),
        'amount', v_pkg_rate
      ));
    else
      -- Package covers two rooms; the rest are billed at their own rates.
      v_pkg_rate := public.rate_amount('room_pkg_2');
      select coalesce(sum(u.rate), 0) into v_extra_rooms
      from (
        select u2.id, u2.rate
        from public.room_units u2
        join public.rooms rm2 on rm2.id = u2.room_id
        where u2.id = any (unit_ids)
        order by rm2.sort_order, u2.sort_order
        offset 2
      ) u;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Room package · 2 rooms',
        'amount', v_pkg_rate
      ));
      lines := lines || jsonb_build_array(jsonb_build_object(
        'label', 'Additional rooms × ' || (v_room_count - 2) || ' · ' || coalesce(room_names, 'selected'),
        'amount', v_extra_rooms
      ));
    end if;
  end if;

  if payload ? 'rentals' and jsonb_typeof(payload->'rentals') = 'array' then
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

-- Rooms must fit the group on every package: enough beds for everyone and no
-- room that could be dropped. Overnight has to take a set (it is part of the
-- package); day, night and event bookings may skip rooms altogether.
create or replace function public.assert_room_fit(p_tour text, p_pax int, p_unit_ids uuid[], p_pets int)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_max_pets int := public.setting('max_pets_per_room', '2')::int;
  v_rooms int := coalesce(cardinality(p_unit_ids), 0);
begin
  if p_tour = 'overnight' and v_rooms = 0 then
    raise exception 'Pick one of the suggested room sets for your overnight stay';
  end if;
  if v_rooms > 0 then
    select coalesce(sum(u.capacity), 0) into v_cap from public.room_units u where u.id = any (p_unit_ids);
    if v_cap < p_pax then
      raise exception 'The selected rooms sleep % but the booking is for % pax', v_cap, p_pax;
    end if;
    if exists (
      select 1 from public.room_units u
      where u.id = any (p_unit_ids) and v_cap - u.capacity >= p_pax
    ) then
      raise exception 'Rooms are matched to the headcount. Pick one of the suggested room sets';
    end if;
  end if;
  if v_max_pets > 0 and coalesce(p_pets, 0) > v_max_pets * greatest(v_rooms, 1) then
    raise exception 'Up to % pet(s) per room are allowed', v_max_pets;
  end if;
end;
$$;

-- --------------------------------------------------------- 8. the request --
-- No approval queue any more: a request holds the slot and goes straight to
-- the 50% downpayment. It expires on its own if the payment window lapses.
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
  v_pax int;
  v_start timestamptz;
  v_dp_window_hours int;
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
  v_pax := greatest(coalesce((payload->>'pax')::int, 1), 1);
  v_start := public.booking_window_start(tour, stay, payload->>'overnight_shift', payload->>'event_when');
  if stay < public.manila_today() or now() >= v_start then
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

  perform public.assert_room_fit(tour::text, v_pax, unit_ids, greatest(coalesce((payload->>'pets')::int, 0), 0));

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
  v_dp_window_hours := public.setting('downpayment_hours', '48')::int;

  insert into public.bookings (
    reference, guest_id, guest_name, guest_contact, created_by, tour_type, stay_date, pax, hours,
    extra_hours, overnight_shift, event_when, pets, caterer_id, status, package_label, quote_lines,
    total_amount, downpayment_amount, approved_at, payment_due_at
  ) values (
    'CK-' || lpad(nextval('public.booking_ref_seq')::text, 4, '0'),
    me,
    trim(my_profile.first_name || ' ' || my_profile.last_name),
    my_profile.contact,
    me,
    tour,
    stay,
    v_pax,
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
    now(),
    least(now() + (v_dp_window_hours::text || ' hours')::interval, v_start)
  ) returning * into b;

  insert into public.booking_rooms (booking_id, room_unit_id, rate_snapshot)
  select b.id, u.id, case when tour = 'overnight' then 0 else u.rate end
  from public.room_units u
  where u.id = any (unit_ids);

  if payload ? 'rentals' and jsonb_typeof(payload->'rentals') = 'array' then
    insert into public.booking_rentals (booking_id, rental_id, qty, rate_snapshot)
    select b.id, rt.id, greatest(coalesce((x.elem->>'qty')::int, 1), 1), rt.price
    from jsonb_array_elements(payload->'rentals') as x(elem)
    join public.rentals rt on rt.id = (x.elem->>'id')::uuid;
  end if;

  perform public.notify_user(
    me,
    'Pay the 50% downpayment',
    b.reference || ' is on hold. Pay ' || public.peso_text(b.downpayment_amount) || ' by '
      || to_char(b.payment_due_at at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM') || ' to confirm it.',
    b.id
  );
  perform public.notify_admins(
    'New reservation',
    b.guest_name || ' booked ' || b.reference || ' for ' || b.stay_date::text || ' · awaiting downpayment',
    b.id
  );
  perform public.queue_email(
    me,
    'CK Resort · complete your downpayment · ' || b.reference,
    'Hi ' || b.guest_name || ',' || E'\n\n'
      || 'Your request ' || b.reference || ' is holding ' || to_char(b.stay_date, 'FMDay, FMMonth DD, YYYY')
      || ' (' || public.booking_window_label(b) || ').' || E'\n'
      || 'Pay the 50% downpayment of ' || public.peso_text(b.downpayment_amount) || ' by '
      || to_char(b.payment_due_at at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM')
      || ' to confirm it. The hold is released after that.' || E'\n\n'
      || 'The downpayment is not refundable.' || E'\n\n'
      || 'CK Resort & Events Place',
    b.id
  );
  perform public.audit('submit_booking', 'booking', b.id, jsonb_build_object('reference', b.reference));

  return to_jsonb(b);
end;
$$;

-- ------------------------------------------------- 9. cancel and rebook --
create or replace function public.cancel_booking(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_paid numeric;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.guest_id is distinct from auth.uid() and not public.is_desk() then
    raise exception 'Not allowed';
  end if;
  if b.status not in ('pending_approval', 'awaiting_downpayment', 'confirmed') then
    raise exception 'This booking can no longer be cancelled';
  end if;
  if b.status = 'confirmed' and now() >= public.booking_starts_at(b) then
    raise exception 'The stay has already started and can no longer be cancelled';
  end if;

  update public.payments set status = 'failed' where booking_id = p_id and status = 'pending';
  v_paid := public.booking_paid_total(p_id);

  update public.bookings
  set status = 'cancelled', cancelled_at = now()
  where id = p_id
  returning * into b;

  if b.guest_id is not null then
    perform public.notify_user(
      b.guest_id,
      'Reservation cancelled',
      b.reference || ' was cancelled.'
        || case when v_paid > 0 then ' The downpayment of ' || public.peso_text(v_paid) || ' is not refundable.' else '' end,
      b.id
    );
  end if;
  perform public.notify_admins('Reservation cancelled', b.reference || ' · ' || b.guest_name, b.id);
  perform public.audit('cancel_booking', 'booking', b.id, jsonb_build_object('retained', v_paid));
  return to_jsonb(b);
end;
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
  v_fee numeric := public.rate_amount('rebook_fee');
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
  perform public.assert_booking_rules(v_payload);

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

  if v_fee > 0 then
    insert into public.booking_charges (booking_id, description, amount, created_by, kind)
    values (
      p_id,
      'Rebooking fee · ' || to_char(v_old, 'Mon DD') || ' to ' || to_char(p_date, 'Mon DD'),
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

-- ------------------------------------------------- 10. counter collection --
-- One receipt per collection. receipt_lines records exactly what that payment
-- settled, so an add-on bought after the balance was paid prints on its own
-- receipt, while one added before payment rides on the balance receipt.
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
  b public.bookings;
  v_due numeric;
  v_tendered numeric := coalesce(p_cash, 0) + coalesce(p_ewallet, 0);
  v_pid uuid;
  v_type public.payment_type := p_type;
  v_charges numeric := 0;
  v_damage numeric := 0;
  v_paid_before numeric;
  v_new_pax int;
  v_new_hours int;
  v_pax_rate numeric;
  v_hour_rate numeric;
  v_package numeric;
  v_lines jsonb := '[]'::jsonb;
  r record;
begin
  select * into b from public.bookings where id = p_id;
  v_due := public.booking_amount_due(p_id);
  if v_tendered + 0.009 < v_due then
    raise exception 'Payment is short. Amount due is %', v_due;
  end if;
  if v_due > 0 then
    select coalesce(sum(bc.amount), 0), coalesce(sum(bc.amount) filter (where bc.kind = 'damage'), 0)
      into v_charges, v_damage
    from public.booking_charges bc
    where bc.booking_id = p_id and bc.payment_id is null;

    if coalesce(p_cash, 0) + 0.009 < least(v_damage, v_due) then
      raise exception 'Damaged items are settled in cash. Cash needed: %', least(v_damage, v_due);
    end if;

    v_paid_before := public.booking_paid_total(p_id);
    v_new_pax := greatest(b.excess_pax - b.settled_excess_pax, 0);
    v_new_hours := greatest(b.checkin_extra_hours - b.settled_extra_hours, 0);
    v_pax_rate := case
      when b.tour_type = 'overnight' then public.rate_amount('extra_pax_overnight')
      else public.rate_amount('extra_pax_tour')
    end;
    v_hour_rate := public.rate_amount('extra_hour');
    v_package := v_due - v_charges - v_new_pax * v_pax_rate - v_new_hours * v_hour_rate;

    if v_package > 0.009 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'label', case when v_paid_before > 0 then 'Remaining balance · ' else 'Package · ' end || b.package_label,
        'amount', v_package
      ));
    else
      v_type := 'onsite';
    end if;
    for r in
      select bc.description, bc.amount
      from public.booking_charges bc
      where bc.booking_id = p_id and bc.payment_id is null
      order by bc.created_at
    loop
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('label', r.description, 'amount', r.amount));
    end loop;
    if v_new_pax > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'label', 'Excess pax × ' || v_new_pax, 'amount', v_new_pax * v_pax_rate
      ));
    end if;
    if v_new_hours > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'label', 'Extra hours × ' || v_new_hours, 'amount', v_new_hours * v_hour_rate
      ));
    end if;

    insert into public.payments (
      booking_id, type, method, amount, status, received_by, paid_at, receipt_no, notes, receipt_lines
    )
    values (
      p_id,
      v_type,
      (case when coalesce(p_ewallet, 0) > coalesce(p_cash, 0) then 'ewallet' else 'cash' end)::public.payment_method,
      v_due,
      'paid'::public.payment_status,
      auth.uid(),
      now(),
      'OR-' || lpad(nextval('public.receipt_seq')::text, 6, '0'),
      'Cash ' || coalesce(p_cash, 0)::text || ' / E-wallet ' || coalesce(p_ewallet, 0)::text,
      v_lines
    )
    returning id into v_pid;

    update public.booking_charges set payment_id = v_pid where booking_id = p_id and payment_id is null;
    update public.bookings
    set settled_excess_pax = excess_pax, settled_extra_hours = checkin_extra_hours
    where id = p_id;
    perform public.sync_paid_amount(p_id);
  end if;
  return jsonb_build_object(
    'due', v_due,
    'change', greatest(v_tendered - v_due, 0),
    'payment_id', v_pid
  );
end;
$$;

-- Headcount is who actually sleeps over. Extra heads up to the room capacity
-- only pay the excess fee; past that they also need another room.
create or replace function public.assert_room_capacity(p_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_cap int;
  v_rooms int;
begin
  select * into b from public.bookings where id = p_id;
  if b.tour_type <> 'overnight' then return; end if;
  select coalesce(sum(u.capacity), 0), count(*) into v_cap, v_rooms
  from public.booking_rooms br
  join public.room_units u on u.id = br.room_unit_id
  where br.booking_id = p_id;
  if v_rooms > 0 and coalesce(b.actual_pax, b.pax) > v_cap then
    raise exception 'Headcount is % but the booked rooms sleep %. Add another room for the extra % guest(s) first',
      coalesce(b.actual_pax, b.pax), v_cap, coalesce(b.actual_pax, b.pax) - v_cap;
  end if;
end;
$$;

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
      excess_pax = greatest(greatest(p_actual_pax, 1) - pax, settled_excess_pax, 0)
  where id = p_booking
  returning * into b;
  perform public.assert_room_capacity(p_booking);
  perform public.audit('set_headcount', 'booking', b.id, jsonb_build_object('actual_pax', b.actual_pax, 'excess', b.excess_pax));
  return to_jsonb(b);
end;
$$;

create or replace function public.add_booking_room(p_booking uuid, p_unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  u public.room_units;
  v_room text;
  slots text[];
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('confirmed', 'checked_in') then
    raise exception 'Rooms can only be added before or during the stay';
  end if;
  select * into u from public.room_units where id = p_unit and is_active;
  if not found then raise exception 'Room not found'; end if;
  if exists (select 1 from public.booking_rooms br where br.booking_id = p_booking and br.room_unit_id = p_unit) then
    raise exception 'That room is already on this booking';
  end if;
  if u.status <> 'available' and u.current_booking_id is distinct from p_booking then
    raise exception 'That room is not available right now';
  end if;
  slots := public.booking_slots(b.tour_type, b.event_when);
  if exists (
    select 1
    from public.booking_rooms br
    join public.bookings bx on bx.id = br.booking_id
    where br.room_unit_id = p_unit
      and bx.id <> p_booking
      and bx.stay_date = b.stay_date
      and bx.status in ('pending_approval', 'awaiting_downpayment', 'confirmed', 'checked_in')
      and public.booking_slots(bx.tour_type, bx.event_when) && slots
  ) then
    raise exception 'That room is already booked for this slot';
  end if;

  select rm.name || ' ' || u.name into v_room from public.rooms rm where rm.id = u.room_id;

  insert into public.booking_rooms (booking_id, room_unit_id, rate_snapshot) values (p_booking, p_unit, u.rate);
  insert into public.booking_charges (booking_id, description, amount, created_by, kind)
  values (p_booking, 'Additional room · ' || v_room, u.rate, auth.uid(), 'room');

  if b.status = 'checked_in' then
    update public.room_units
    set status = 'occupied',
        current_booking_id = b.id,
        check_in_at = now(),
        check_out_at = public.booking_effective_end(b)
    where id = p_unit;
  end if;

  perform public.audit('add_booking_room', 'booking', b.id, jsonb_build_object('room', v_room, 'amount', u.rate));
  return jsonb_build_object('room', v_room, 'amount', u.rate);
end;
$$;

-- A catalog rental sold at the counter after booking (LPG, butane, …).
create or replace function public.add_booking_addon(p_booking uuid, p_rental uuid, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  rt public.rentals;
  v_qty int := greatest(coalesce(p_qty, 1), 1);
  row public.booking_charges;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('confirmed', 'checked_in', 'checked_out') then
    raise exception 'Add-ons can only be added to an active stay';
  end if;
  select * into rt from public.rentals where id = p_rental and is_active;
  if not found then raise exception 'Rental not found'; end if;
  insert into public.booking_charges (booking_id, description, amount, created_by, kind, rental_id, qty)
  values (p_booking, rt.name || ' × ' || v_qty, rt.price * v_qty, auth.uid(), 'addon', rt.id, v_qty)
  returning * into row;
  perform public.audit('add_booking_addon', 'booking', b.id, jsonb_build_object('item', rt.name, 'qty', v_qty, 'amount', row.amount));
  return to_jsonb(row);
end;
$$;

-- "Collect" on its own: take the money now, check the guest in later.
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
        excess_pax = greatest(greatest(coalesce(p_actual_pax, actual_pax, pax), 1) - pax, settled_excess_pax, 0),
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
      excess_pax = greatest(greatest(p_actual_pax, 1) - pax, settled_excess_pax, 0),
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

-- ---------------------------------------------------------- 11. damage --
create or replace function public.report_damage(
  p_booking uuid,
  p_item text,
  p_reason text,
  p_amount numeric,
  p_proof_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  charge public.booking_charges;
  row public.damage_reports;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  if coalesce(trim(p_item), '') = '' then raise exception 'Name the damaged item'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Describe what happened'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the price of the damaged item'; end if;

  select * into b from public.bookings where id = p_booking for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('checked_in', 'checked_out', 'completed') then
    raise exception 'Damage can only be reported for a guest who has checked in';
  end if;

  insert into public.booking_charges (booking_id, description, amount, created_by, kind)
  values (p_booking, 'Damaged item · ' || trim(p_item), p_amount, auth.uid(), 'damage')
  returning * into charge;

  insert into public.damage_reports (booking_id, charge_id, item, reason, amount, proof_url, reported_by)
  values (p_booking, charge.id, trim(p_item), trim(p_reason), p_amount, nullif(trim(coalesce(p_proof_url, '')), ''), auth.uid())
  returning * into row;

  -- A closed stay owes money again, so it goes back to the desk queue.
  if b.status = 'completed' then
    begin
      update public.bookings set status = 'checked_out' where id = p_booking;
    exception when others then
      null;
    end;
  end if;

  perform public.notify_ops_once(
    'Damage reported · ' || trim(p_item),
    b.reference || ' · ' || b.guest_name || ' · ' || public.peso_text(p_amount) || ' to collect in cash.',
    b.id
  );
  if b.guest_id is not null then
    perform public.notify_user(
      b.guest_id,
      'Damaged item added to your bill',
      trim(p_item) || ' · ' || public.peso_text(p_amount) || '. ' || trim(p_reason) || ' Payable in cash at the front desk.',
      b.id
    );
  end if;
  perform public.audit('report_damage', 'booking', b.id, jsonb_build_object('item', row.item, 'amount', row.amount));
  return to_jsonb(row);
end;
$$;

create or replace function public.damage_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  return (
    select coalesce(jsonb_agg(item order by (item->>'created_at') desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', d.id,
        'booking_id', d.booking_id,
        'reference', b.reference,
        'guest_name', b.guest_name,
        'item', d.item,
        'reason', d.reason,
        'amount', d.amount,
        'proof_url', d.proof_url,
        'created_at', d.created_at,
        'reported_by', coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), 'Staff'),
        'paid', bc.payment_id is not null
      ) as item
      from public.damage_reports d
      join public.bookings b on b.id = d.booking_id
      left join public.booking_charges bc on bc.id = d.charge_id
      left join public.profiles p on p.id = d.reported_by
      order by d.created_at desc
      limit 300
    ) rows
  );
end;
$$;

-- --------------------------------------------------------- 12. supplies --
create or replace function public.log_supply_move(
  p_item uuid,
  p_direction text,
  p_qty int,
  p_booking uuid default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.supply_items;
  v_qty int := coalesce(p_qty, 0);
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Choose in or out'; end if;
  if v_qty < 1 then raise exception 'Quantity must be at least 1'; end if;
  select * into it from public.supply_items where id = p_item for update;
  if not found then raise exception 'Supply item not found'; end if;
  if p_direction = 'out' and v_qty > it.stock then
    raise exception 'Only % % of % left in stock', it.stock, it.unit, it.name;
  end if;

  insert into public.supply_moves (item_id, direction, qty, booking_id, note, created_by)
  values (p_item, p_direction, v_qty, p_booking, coalesce(trim(p_note), ''), auth.uid());

  update public.supply_items
  set stock = stock + case when p_direction = 'in' then v_qty else -v_qty end
  where id = p_item
  returning * into it;

  return to_jsonb(it);
end;
$$;

create or replace function public.supply_overview()
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
      select coalesce(jsonb_agg(to_jsonb(s) order by s.sort_order, s.name), '[]'::jsonb)
      from public.supply_items s where s.is_active
    ),
    'moves', (
      select coalesce(jsonb_agg(item order by (item->>'created_at') desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', m.id,
          'item_id', m.item_id,
          'item', s.name,
          'category', s.category,
          'unit', s.unit,
          'direction', m.direction,
          'qty', m.qty,
          'note', m.note,
          'reference', b.reference,
          'guest_name', b.guest_name,
          'created_at', m.created_at,
          'by', coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), 'Staff')
        ) as item
        from public.supply_moves m
        join public.supply_items s on s.id = m.item_id
        left join public.bookings b on b.id = m.booking_id
        left join public.profiles p on p.id = m.created_by
        order by m.created_at desc
        limit 300
      ) rows
    )
  );
end;
$$;

-- -------------------------------------------------------- 13. utilities --
-- A fault report can carry a proof photo (stored in the damage-proofs bucket).
alter table public.utility_items add column if not exists proof_url text;
alter table public.utility_checks add column if not exists proof_url text;

-- Replaced by the 4-argument version below; dropped so only one remains.
drop function if exists public.set_utility_status(uuid, text, text);

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
  v_proof text := case when p_status = 'ok' then null else nullif(trim(coalesce(p_proof_url, '')), '') end;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  if p_status not in ('ok', 'issue', 'missing') then raise exception 'Unknown status'; end if;
  if p_status <> 'ok' and coalesce(trim(p_note), '') = '' then
    raise exception 'Add a short note about what is wrong';
  end if;
  update public.utility_items
  set status = p_status,
      note = coalesce(trim(p_note), ''),
      proof_url = v_proof,
      checked_by = auth.uid(),
      checked_at = now()
  where id = p_item
  returning * into it;
  if not found then raise exception 'Item not found'; end if;

  insert into public.utility_checks (item_id, status, note, proof_url, checked_by)
  values (p_item, p_status, coalesce(trim(p_note), ''), v_proof, auth.uid());

  if p_status <> 'ok' then
    perform public.notify_admins(
      'Utility check · ' || it.area,
      it.name || ' marked ' || case when p_status = 'missing' then 'missing' else 'needs repair' end || '. ' || it.note,
      null
    );
  end if;
  return to_jsonb(it);
end;
$$;

create or replace function public.add_utility_item(p_area text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.utility_items;
  v_sort int;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  if coalesce(trim(p_area), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'Area and item name are required';
  end if;
  select coalesce(max(area_sort), 990) into v_sort from public.utility_items where area = trim(p_area);
  insert into public.utility_items (area, area_sort, name, sort_order)
  values (trim(p_area), v_sort, trim(p_name), 50)
  on conflict (area, name) do update set is_active = true
  returning * into it;
  return to_jsonb(it);
end;
$$;

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
          'name', u.name,
          'status', u.status,
          'note', u.note,
          'proof_url', u.proof_url,
          'checked_at', u.checked_at,
          'checked_by', nullif(trim(p.first_name || ' ' || p.last_name), '')
        ) as item
        from public.utility_items u
        left join public.profiles p on p.id = u.checked_by
        where u.is_active
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

-- ------------------------------------------------- 13b. manual occupancy --
-- Staff can hold a free room by hand (someone staying without a booking),
-- but only with a reason, which shows on the housekeeping board.
alter table public.room_units
  add column if not exists occupied_note text,
  add column if not exists occupied_by uuid references public.profiles (id) on delete set null;

create or replace function public.occupy_room(p_unit uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.room_units;
  v_room text;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Enter the reason this room is being marked occupied';
  end if;
  select * into u from public.room_units where id = p_unit for update;
  if not found then raise exception 'Room not found'; end if;
  if u.status <> 'available' then
    raise exception 'Only an available room can be marked occupied';
  end if;
  if exists (
    select 1
    from public.booking_rooms br
    join public.bookings b on b.id = br.booking_id
    where br.room_unit_id = p_unit
      and b.stay_date = public.manila_today()
      and b.status in ('awaiting_downpayment', 'confirmed')
  ) then
    raise exception 'This room is reserved for a guest arriving today';
  end if;

  update public.room_units
  set status = 'occupied',
      current_booking_id = null,
      check_in_at = now(),
      check_out_at = null,
      turnaround_until = null,
      occupied_note = trim(p_reason),
      occupied_by = auth.uid()
  where id = p_unit
  returning * into u;

  select rm.name || ' ' || u.name into v_room from public.rooms rm where rm.id = u.room_id;
  perform public.audit('occupy_room', 'room', u.id, jsonb_build_object('room', v_room, 'reason', u.occupied_note));
  return to_jsonb(u);
end;
$$;

-- The note only describes a hand-marked stay: drop it as soon as the room is
-- freed, sent to cleaning, or taken over by a real check-in.
create or replace function public.room_units_clear_note()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'occupied' or new.current_booking_id is not null then
    new.occupied_note := null;
    new.occupied_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists room_units_clear_note on public.room_units;
create trigger room_units_clear_note
before update on public.room_units
for each row execute procedure public.room_units_clear_note();

grant execute on function public.occupy_room(uuid, text) to authenticated;

-- ------------------------------------------------------------ 14. grants --
grant execute on function public.booking_rules() to anon, authenticated;
grant execute on function public.quote_booking(jsonb) to anon, authenticated;
grant execute on function public.submit_booking(jsonb) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.rebook_booking(uuid, date) to authenticated;
grant execute on function public.guest_blocked() to authenticated;
grant execute on function public.assert_guest_can_book(uuid) to authenticated;
grant execute on function public.blacklist_overview() to authenticated;
grant execute on function public.blacklist_add(uuid, text, text, text) to authenticated;
grant execute on function public.blacklist_lift(uuid) to authenticated;
grant execute on function public.admin_save_ops_rules(int, int) to authenticated;
grant execute on function public.set_headcount(uuid, int) to authenticated;
grant execute on function public.add_booking_room(uuid, uuid) to authenticated;
grant execute on function public.add_booking_addon(uuid, uuid, int) to authenticated;
grant execute on function public.collect_booking_payment(uuid, numeric, numeric, int, int) to authenticated;
grant execute on function public.check_in_booking(uuid, int, int, numeric, numeric) to authenticated;
grant execute on function public.report_damage(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.damage_overview() to authenticated;
grant execute on function public.log_supply_move(uuid, text, int, uuid, text) to authenticated;
grant execute on function public.supply_overview() to authenticated;
grant execute on function public.set_utility_status(uuid, text, text, text) to authenticated;
grant execute on function public.add_utility_item(text, text) to authenticated;
grant execute on function public.utility_overview() to authenticated;
grant execute on function public.server_email_pending(text) to anon, authenticated;
grant execute on function public.server_email_done(text, uuid, text) to anon, authenticated;

revoke all on function public.record_collected_payment(uuid, numeric, numeric, public.payment_type) from public, anon, authenticated;
revoke all on function public.queue_email(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.assert_room_capacity(uuid) from public, anon, authenticated;
revoke all on function public.bookings_status_effects() from public, anon, authenticated;

notify pgrst, 'reload schema';
