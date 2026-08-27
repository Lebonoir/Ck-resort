-- List maintenance: delete own notifications, mark all as read, delete returned rental logs.
-- Run in the Supabase SQL Editor. Safe to re-run.
-- Does not delete receipts, payments, or bookings.

drop policy if exists notes_delete on public.notifications;
create policy notes_delete on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.delete_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.notifications where id = p_id and user_id = auth.uid();
  if not found then raise exception 'Notification not found'; end if;
  return true;
end;
$$;

create or replace function public.delete_returned_dispatch(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.rental_dispatches;
begin
  if not public.is_ops() then raise exception 'Staff only'; end if;
  select * into row from public.rental_dispatches where id = p_id;
  if not found then raise exception 'Rental log not found'; end if;
  if row.status <> 'returned' then
    raise exception 'Only returned rental logs can be removed';
  end if;
  delete from public.rental_dispatches where id = p_id;
  return true;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.notifications
  set is_read = true
  where user_id = auth.uid() and is_read = false;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.delete_notification(uuid) to authenticated;
grant execute on function public.delete_returned_dispatch(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

notify pgrst, 'reload schema';
