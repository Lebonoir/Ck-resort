-- One active reservation per guest (unique index).
-- Run in the Supabase SQL Editor. Safe to re-run.
-- Does NOT delete, cancel, or merge bookings.
--
-- If Notices report duplicates, inspect them with:
--
--   select guest_id,
--          count(*) as active_count,
--          string_agg(reference || ' · ' || status::text, ', ' order by created_at) as bookings
--   from public.bookings
--   where guest_id is not null
--     and status in (
--       'pending_approval',
--       'awaiting_downpayment',
--       'confirmed',
--       'checked_in',
--       'checked_out'
--     )
--   group by guest_id
--   having count(*) > 1;
--
-- Resolve extras (cancel/complete the ones that should not stay active), then re-run this file.

do $$
declare
  rec record;
  n int := 0;
begin
  for rec in
    select bk.guest_id,
           count(*) as active_count,
           string_agg(bk.reference || ' · ' || bk.status::text, ', ' order by bk.created_at) as bookings
    from public.bookings bk
    where bk.guest_id is not null
      and bk.status in (
        'pending_approval',
        'awaiting_downpayment',
        'confirmed',
        'checked_in',
        'checked_out'
      )
    group by bk.guest_id
    having count(*) > 1
  loop
    n := n + 1;
    raise notice 'Duplicate active bookings for guest % (%): %', rec.guest_id, rec.active_count, rec.bookings;
  end loop;

  if n > 0 then
    raise notice 'Skipped unique index bookings_one_active_per_guest. Resolve the % guest(s) above, then re-run this file.', n;
    return;
  end if;

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
  raise notice 'Created or confirmed unique index bookings_one_active_per_guest';
end $$;
