-- Booking lifecycle types and columns.
-- Run this FIRST in the Supabase SQL Editor, then run booking_lifecycle.sql.
-- New enum values cannot be used until this transaction commits.

do $$ begin
  alter type public.booking_status add value if not exists 'expired';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.booking_status add value if not exists 'no_show';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.booking_status add value if not exists 'checked_out';
exception when duplicate_object then null;
end $$;

alter table public.bookings
  add column if not exists payment_due_at timestamptz,
  add column if not exists checked_out_at timestamptz,
  add column if not exists checked_out_by uuid references public.profiles (id),
  add column if not exists expired_at timestamptz,
  add column if not exists credit_held numeric(12,2) not null default 0;

insert into public.app_settings (key, value) values
  ('downpayment_hours', '48'),
  ('no_show_grace_minutes', '120'),
  ('no_show_downpayment_policy', 'retain')
on conflict (key) do nothing;
