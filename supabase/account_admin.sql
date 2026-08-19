-- Account management RPCs. Safe to re-run.
-- Applies admin_update_account with the exact argument names the React client sends:
--   p_id, p_first_name, p_last_name, p_email, p_contact, p_role, p_is_active

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

drop function if exists public.admin_update_account(jsonb);
drop function if exists public.admin_create_account(jsonb);

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

grant execute on function public.invite_staff(text, text, public.user_role) to authenticated;
grant execute on function public.admin_update_account(uuid, text, text, text, text, public.user_role, boolean) to authenticated;
grant execute on function public.admin_delete_account(uuid) to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_desk() to authenticated;
grant execute on function public.is_ops() to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

alter table public.profiles replica identity full;

notify pgrst, 'reload schema';
