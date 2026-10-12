-- CK Resort · last-minute add-ons take their items out of Supplies.
-- Run in the Supabase SQL Editor AFTER resort_ops.sql. Safe to re-run.
--
-- When the front desk adds a rental add-on to a bill (LP Gas, Butane,
-- Billiard, Bonfire), the supply items it uses are deducted from stock and
-- logged in "Supplies in & out" against that booking.

-- --------------------------------------------- 1. what each add-on uses --
create table if not exists public.rental_supplies (
  rental_id uuid not null references public.rentals (id) on delete cascade,
  supply_item_id uuid not null references public.supply_items (id) on delete cascade,
  qty int not null default 1 check (qty >= 1),
  primary key (rental_id, supply_item_id)
);

alter table public.rental_supplies enable row level security;
drop policy if exists rental_supplies_select on public.rental_supplies;
create policy rental_supplies_select on public.rental_supplies for select to authenticated using (public.is_ops());
grant select on public.rental_supplies to authenticated;

-- One of each linked item per add-on sold. Change a qty, or add/remove rows,
-- in the Table Editor if an add-on uses a different amount.
insert into public.rental_supplies (rental_id, supply_item_id, qty)
select r.id, s.id, v.qty
from (values
  ('lpg', 'lpg-tank', 1),
  ('butane', 'butane-canister', 1),
  ('billiard', 'billiard-cue', 1),
  ('billiard', 'billiard-powder', 1),
  ('bonfire', 'marshmallow', 1),
  ('bonfire', 'bonfire-sticks', 1),
  ('bonfire', 'firewood', 1),
  ('bonfire', 'coconut-shell', 1)
) as v(rental_slug, supply_slug, qty)
join public.rentals r on r.slug = v.rental_slug
join public.supply_items s on s.slug = v.supply_slug
on conflict (rental_id, supply_item_id) do nothing;

-- ------------------------------------------- 2. add-on = bill + stock out --
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
  s record;
  v_used jsonb := '[]'::jsonb;
begin
  if not public.is_desk() then raise exception 'Front desk only'; end if;
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  if b.status not in ('confirmed', 'checked_in', 'checked_out') then
    raise exception 'Add-ons can only be added to an active stay';
  end if;
  select * into rt from public.rentals where id = p_rental and is_active;
  if not found then raise exception 'Rental not found'; end if;

  -- Stock first: nothing is billed for an item that is not on the shelf.
  for s in
    select si.id, si.name, si.unit, si.stock, rs.qty * v_qty as need
    from public.rental_supplies rs
    join public.supply_items si on si.id = rs.supply_item_id
    where rs.rental_id = rt.id and si.is_active
    order by si.sort_order
    for update of si
  loop
    if s.need > s.stock then
      raise exception 'Not enough % in stock for % × %: % % left, % needed. Log a delivery in Supplies first',
        s.name, rt.name, v_qty, s.stock, s.unit, s.need;
    end if;
    insert into public.supply_moves (item_id, direction, qty, booking_id, note, created_by)
    values (s.id, 'out', s.need, p_booking, 'Add-on · ' || rt.name || ' × ' || v_qty, auth.uid());
    update public.supply_items set stock = stock - s.need where id = s.id;
    v_used := v_used || jsonb_build_array(jsonb_build_object('item', s.name, 'qty', s.need, 'left', s.stock - s.need));
  end loop;

  insert into public.booking_charges (booking_id, description, amount, created_by, kind, rental_id, qty)
  values (p_booking, rt.name || ' × ' || v_qty, rt.price * v_qty, auth.uid(), 'addon', rt.id, v_qty)
  returning * into row;
  perform public.audit('add_booking_addon', 'booking', b.id,
    jsonb_build_object('item', rt.name, 'qty', v_qty, 'amount', row.amount, 'supplies', v_used));
  return to_jsonb(row) || jsonb_build_object('supplies', v_used);
end;
$$;

grant execute on function public.add_booking_addon(uuid, uuid, int) to authenticated;
