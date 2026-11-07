-- =====================================================================
-- Sai Motor Works – Online booking module
-- Run AFTER schema.sql, in Supabase → SQL Editor. Safe to re-run.
-- Spec: docs/booking/DATA_MODEL.md (tables, functions, access rules)
--       docs/booking/BUSINESS_RULES.md (hours, capacity, limits)
--
-- Access in one line: anon gets NOTHING here. The public booking page
-- reaches these tables only through server route handlers (service role).
-- The owner (authenticated) reads everything and edits settings; booking
-- status/date changes only happen through functions (later tasks).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- booking_settings (single row, id = 1)
-- Business name, phone and address come from public.settings.
-- ---------------------------------------------------------------------
create table if not exists public.booking_settings (
  id                    int primary key default 1 check (id = 1),
  online_enabled        boolean not null default true,
  horizon_days          int  not null default 30 check (horizon_days between 1 and 90),
  online_cutoff_time    time not null default '17:00',  -- online booking for tomorrow closes at this time today
  cancel_cutoff_time    time not null default '17:00',  -- customer cancel/reschedule closes at this time the day before
  reminder_time         time not null default '10:00',
  pickup_message        text not null default 'From 3pm, we''ll SMS you when it''s ready.'
                        check (char_length(pickup_message) <= 200),
  price_disclaimer      text not null default 'Final price depends on your vehicle and the work needed. We''ll contact you before doing any extra work.'
                        check (char_length(price_disclaimer) <= 300),
  sms_sender_id         text not null default 'SaiMotor' check (sms_sender_id ~ '^[A-Za-z0-9]{1,11}$'),
  sms_enabled           boolean not null default true,
  ready_sms_mode        text not null default 'manual' check (ready_sms_mode in ('manual', 'on_complete')),
  max_active_per_mobile int  not null default 3 check (max_active_per_mobile between 1 and 20),
  updated_at            timestamptz not null default now()
);
insert into public.booking_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists booking_settings_set_updated_at on public.booking_settings;
create trigger booking_settings_set_updated_at
  before update on public.booking_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- booking_services: never hard-deleted once used (deactivate instead)
-- Prices in cents, AUD, GST-inclusive. price_cents is null iff 'quote'.
-- ---------------------------------------------------------------------
create table if not exists public.booking_services (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (char_length(name) between 1 and 80),
  description     text not null default '' check (char_length(description) <= 300),
  price_type      text not null check (price_type in ('fixed', 'from', 'quote')),
  price_cents     int  check (price_cents >= 0),
  online_bookable boolean not null default true,
  active          boolean not null default true,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint booking_services_price_check check ((price_type = 'quote') = (price_cents is null))
);

drop trigger if exists booking_services_set_updated_at on public.booking_services;
create trigger booking_services_set_updated_at
  before update on public.booking_services
  for each row execute function public.set_updated_at();

-- Seed (BUSINESS_RULES §3). Existing rows are left alone so owner edits survive a re-run.
insert into public.booking_services (name, price_type, price_cents, sort_order) values
  ('Basic service',                         'from',  16000, 10),
  ('Logbook service',                       'quote', null,  20),
  ('Brakes',                                'quote', null,  30),
  ('Tyres',                                 'quote', null,  40),
  ('Pink slip (e-Safety check)',            'quote', null,  50),
  ('Diagnostics / warning light',           'quote', null,  60),
  ('Air-con',                               'quote', null,  70),
  ('General repair (describe the problem)', 'quote', null,  80)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- booking_weekly_hours: one row per ISO weekday (1 = Mon … 7 = Sun).
-- Times are kept even on closed days, so an override that opens a closed
-- weekday always has hours to fall back on.
-- ---------------------------------------------------------------------
create table if not exists public.booking_weekly_hours (
  weekday       smallint primary key check (weekday between 1 and 7),
  is_open       boolean not null,
  open_time     time not null,
  close_time    time not null,
  capacity_cars int  not null check (capacity_cars between 0 and 200),
  constraint booking_weekly_hours_times_check check (open_time < close_time)
);

insert into public.booking_weekly_hours (weekday, is_open, open_time, close_time, capacity_cars) values
  (1, true,  '08:30', '17:00', 10),
  (2, true,  '08:30', '17:00', 10),
  (3, true,  '08:30', '17:00', 10),
  (4, true,  '08:30', '17:00', 10),
  (5, true,  '08:30', '17:00', 10),
  (6, true,  '08:30', '16:00',  8),
  (7, false, '08:30', '16:00',  0)
on conflict (weekday) do nothing;

-- ---------------------------------------------------------------------
-- booking_windows: drop-off windows (one for now: 08:30–09:30)
-- ---------------------------------------------------------------------
create table if not exists public.booking_windows (
  id         uuid primary key default gen_random_uuid(),
  start_time time not null,
  end_time   time not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  constraint booking_windows_times_check check (start_time < end_time)
);

insert into public.booking_windows (start_time, end_time, sort_order)
select '08:30', '09:30', 10
where not exists (select 1 from public.booking_windows);

-- ---------------------------------------------------------------------
-- booking_date_overrides: open or close one date, or change its hours /
-- capacity. Null times/capacity = use the weekday's values.
-- ---------------------------------------------------------------------
create table if not exists public.booking_date_overrides (
  date          date primary key,
  is_open       boolean not null,
  open_time     time,
  close_time    time,
  capacity_cars int check (capacity_cars between 0 and 200),
  reason        text check (char_length(reason) <= 100),
  constraint booking_date_overrides_times_check
    check (open_time is null or close_time is null or open_time < close_time)
);

-- show_phone: on a day the owner closed, show customers "call us" with the
-- business phone (BUSINESS_RULES §1). Never for holidays, Sundays or full days.
-- The reason above stays private to the owner.
alter table public.booking_date_overrides add column if not exists show_phone boolean not null default false;
do $$ begin
  alter table public.booking_date_overrides drop constraint if exists booking_date_overrides_show_phone_check;
  alter table public.booking_date_overrides add constraint booking_date_overrides_show_phone_check
    check (not (show_phone and is_open));
end $$;

-- ---------------------------------------------------------------------
-- booking_public_holidays: closed unless an override opens the date.
-- NSW public holidays 2026–2027 (nsw.gov.au/about-nsw/public-holidays,
-- checked 2026-11-05, re-checked against the full table after review).
-- Bank Holiday is left out: it applies to banks only.
-- ---------------------------------------------------------------------
create table if not exists public.booking_public_holidays (
  date date primary key,
  name text not null check (char_length(name) between 1 and 80)
);

insert into public.booking_public_holidays (date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-26', 'Australia Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-04', 'Easter Saturday'),
  ('2026-04-05', 'Easter Sunday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-04-25', 'Anzac Day'),
  ('2026-04-27', 'Anzac Day (additional day)'),
  ('2026-06-08', 'King''s Birthday'),
  ('2026-10-05', 'Labour Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Boxing Day'),
  ('2026-12-28', 'Boxing Day (additional day)'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-26', 'Australia Day'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-27', 'Easter Saturday'),
  ('2027-03-28', 'Easter Sunday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-04-25', 'Anzac Day'),
  ('2027-04-26', 'Anzac Day (additional day)'),
  ('2027-06-14', 'King''s Birthday'),
  ('2027-10-04', 'Labour Day'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-26', 'Boxing Day'),
  ('2027-12-27', 'Christmas Day (additional day)'),
  ('2027-12-28', 'Boxing Day (additional day)')
on conflict (date) do nothing;

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
create sequence if not exists public.booking_ref_seq start with 1001;

create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  reference_no      text not null unique default ('BKG-' || nextval('public.booking_ref_seq')),
  status            text not null default 'booked'
                    check (status in ('booked', 'arrived', 'completed', 'cancelled', 'no_show')),
  source            text not null check (source in ('online', 'owner')),
  drop_off_date     date not null,
  window_id         uuid references public.booking_windows (id) on delete set null,
  window_start      time not null,
  window_end        time not null,
  first_name        text not null check (char_length(first_name) between 1 and 80),
  last_name         text not null check (char_length(last_name) between 1 and 80),
  mobile            text not null check (mobile ~ '^\+614\d{8}$'),
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rego              text not null check (rego ~ '^[A-Z0-9]{1,9}$'),
  rego_state        text not null check (rego_state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT')),
  make              text not null check (char_length(make) between 1 and 60),
  model             text not null check (char_length(model) between 1 and 80),
  year              int  check (year between 1950 and 2100),
  customer_notes    text not null default '' check (char_length(customer_notes) <= 1000),
  owner_notes       text not null default '' check (char_length(owner_notes) <= 2000),
  over_capacity     boolean not null default false,
  manage_token_hash bytea not null unique check (octet_length(manage_token_hash) = 32), -- SHA-256; raw token never stored
  checkin_id        uuid references public.checkins (id) on delete set null,
  cancelled_at      timestamptz,
  is_read           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint bookings_window_check    check (window_start < window_end),
  constraint bookings_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null))
);

-- One active booking per rego per day (BUSINESS_RULES §5)
create unique index if not exists bookings_rego_day_active_uidx
  on public.bookings (rego, drop_off_date) where status in ('booked', 'arrived', 'completed');
create unique index if not exists bookings_checkin_id_uidx
  on public.bookings (checkin_id) where checkin_id is not null;
create index if not exists bookings_date_status_idx on public.bookings (drop_off_date, status);
create index if not exists bookings_mobile_idx      on public.bookings (mobile);
create index if not exists bookings_rego_idx        on public.bookings (rego);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- booking_items: services on a booking, with snapshots of name/price
-- ---------------------------------------------------------------------
create table if not exists public.booking_items (
  booking_id           uuid not null references public.bookings (id) on delete cascade,
  service_id           uuid not null references public.booking_services (id) on delete restrict,
  name_snapshot        text not null check (char_length(name_snapshot) between 1 and 80),
  price_type_snapshot  text not null check (price_type_snapshot in ('fixed', 'from', 'quote')),
  price_cents_snapshot int  check (price_cents_snapshot >= 0),
  primary key (booking_id, service_id)
);
create index if not exists booking_items_service_idx on public.booking_items (service_id);

-- ---------------------------------------------------------------------
-- booking_events: append-only history (no PII beyond what's on the booking).
-- No role gets update/delete; rows go only when their booking is deleted (cascade).
-- ---------------------------------------------------------------------
create table if not exists public.booking_events (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  at         timestamptz not null default now(),
  actor      text not null check (actor in ('customer', 'owner', 'system')),
  action     text not null check (action in ('created', 'cancelled', 'rescheduled', 'arrived', 'completed', 'no_show',
                                             'reverted', 'overbooked', 'linked_checkin', 'sms_retry')),
  details    jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index if not exists booking_events_booking_idx on public.booking_events (booking_id, at);

-- ---------------------------------------------------------------------
-- sms_outbox: every SMS goes through here; the dispatcher (T3) sends them
-- ---------------------------------------------------------------------
create table if not exists public.sms_outbox (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid references public.bookings (id) on delete set null,
  checkin_id          uuid references public.checkins (id) on delete set null,
  template            text not null check (template in ('confirmation', 'reminder', 'ready', 'cancelled',
                                                         'rescheduled', 'booking_link')),
  to_mobile           text not null check (to_mobile ~ '^\+614\d{8}$'),
  body                text not null check (char_length(body) between 1 and 480),
  status              text not null default 'pending'
                      check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts            int  not null default 0 check (attempts between 0 and 3),
  next_attempt_at     timestamptz not null default now(),
  provider_message_id text check (char_length(provider_message_id) <= 100),
  last_error          text check (char_length(last_error) <= 300),
  dedupe_key          text not null unique check (char_length(dedupe_key) between 1 and 120),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists sms_outbox_due_idx     on public.sms_outbox (next_attempt_at) where status = 'pending';
create index if not exists sms_outbox_booking_idx on public.sms_outbox (booking_id);
create index if not exists sms_outbox_checkin_idx on public.sms_outbox (checkin_id);
create index if not exists sms_outbox_mobile_idx  on public.sms_outbox (to_mobile, created_at);

-- =====================================================================
-- Functions
-- =====================================================================

-- Output columns change between versions of this file, and CREATE OR REPLACE
-- can't change them: drop first. Grants are re-applied in the grants section.
drop function if exists public.booking_availability(date, date, boolean);
drop function if exists public.booking_availability_at(date, date, boolean, timestamptz);
drop function if exists public.booking_day(date);

-- ---------------------------------------------------------------------
-- booking_day(d): the effective hours/capacity of one date.
--   override → else public holiday ⇒ closed → else weekly hours
-- source: 'override' | 'holiday' | 'weekly'; note: override reason or holiday name;
-- show_phone: owner-closed day where customers may call (overrides only).
-- Internal helper (service_role, and booking_* functions). SECURITY INVOKER:
-- it needs no extra rights; callers already read these tables.
-- search_path = pg_catalog, pg_temp: every object is schema-qualified, and
-- pg_temp is listed last so a temp table can't shadow a type name.
-- ---------------------------------------------------------------------
create or replace function public.booking_day(d date)
returns table (day date, is_open boolean, open_time time, close_time time,
               capacity int, source text, note text, show_phone boolean)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_week public.booking_weekly_hours%rowtype;
  v_over public.booking_date_overrides%rowtype;
  v_hol  public.booking_public_holidays%rowtype;
begin
  select * into v_week from public.booking_weekly_hours w where w.weekday = extract(isodow from d)::smallint;
  select * into v_over from public.booking_date_overrides o where o.date = d;
  if found then
    return query select d, v_over.is_open,
      coalesce(v_over.open_time, v_week.open_time),
      coalesce(v_over.close_time, v_week.close_time),
      coalesce(v_over.capacity_cars, v_week.capacity_cars, 0),
      'override'::text, v_over.reason, v_over.show_phone;
    return;
  end if;

  select * into v_hol from public.booking_public_holidays h where h.date = d;
  if found then
    return query select d, false, v_week.open_time, v_week.close_time, 0, 'holiday'::text, v_hol.name, false;
    return;
  end if;

  return query select d, coalesce(v_week.is_open, false), v_week.open_time, v_week.close_time,
    case when coalesce(v_week.is_open, false) then v_week.capacity_cars else 0 end,
    'weekly'::text, null::text, false;
end $$;

-- ---------------------------------------------------------------------
-- booking_availability_at(from, to, online, now): one row per date.
--   status : 'open' | 'full' | 'closed'
--   reason : why closed – 'past', 'booking_off', 'same_day', 'cutoff', 'horizon'
--            (online rules, checked first), then 'override' | 'holiday' | 'weekly'.
--            Null when open or full.
--   booked : active bookings (booked, arrived, completed). Cancelled / no-show don't count.
-- p_online = true applies the online rules (BUSINESS_RULES §5): no same day,
-- tomorrow closes at online_cutoff_time today, up to horizon_days ahead.
-- The owner (p_online = false) may book today and ignores cutoff/horizon.
-- "Today" and the cutoff are Sydney wall-clock time (handles DST).
--   call_us: true only when the owner closed the day with show_phone on.
-- p_now exists so tests can fix the clock: service_role only. The app calls
-- booking_availability(), which passes now(). SECURITY INVOKER (see booking_day).
-- spots_left is 0 on closed days; callers must still check status.
-- ---------------------------------------------------------------------
create or replace function public.booking_availability_at(p_from date, p_to date, p_online boolean, p_now timestamptz)
returns table (day date, status text, reason text, note text, capacity int, booked int, spots_left int,
               call_us boolean)
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_set   public.booking_settings%rowtype;
  v_local timestamp;
  v_today date;
begin
  if p_from is null or p_to is null or p_now is null or p_online is null
     or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;

  select * into v_set from public.booking_settings where id = 1;
  v_local := p_now at time zone 'Australia/Sydney';
  v_today := v_local::date;

  return query
  with days as (
    select (p_from + i) as d from generate_series(0, p_to - p_from) as i   -- integer steps: no DST surprises
  ),
  counts as (
    select b.drop_off_date as d, count(*)::int as n
      from public.bookings b
     where b.drop_off_date between p_from and p_to
       and b.status in ('booked', 'arrived', 'completed')
     group by b.drop_off_date
  ),
  rules as (
    select days.d, bd.is_open, bd.capacity, bd.source, bd.note, bd.show_phone, coalesce(c.n, 0) as n,
           case
             when days.d < v_today then 'past'
             when p_online and not coalesce(v_set.online_enabled, false) then 'booking_off'
             when p_online and days.d = v_today then 'same_day'
             when p_online and days.d = v_today + 1
                  and v_local::time >= coalesce(v_set.online_cutoff_time, time '17:00') then 'cutoff'
             when p_online and days.d > v_today + coalesce(v_set.horizon_days, 30) then 'horizon'
             when not bd.is_open then bd.source
           end as why
      from days
      cross join lateral public.booking_day(days.d) bd
      left join counts c on c.d = days.d
  )
  select r.d,
         case when r.why is not null then 'closed'
              when r.n >= r.capacity then 'full'
              else 'open' end,
         r.why,
         r.note,
         r.capacity,
         r.n,
         case when r.why is not null then 0 else greatest(r.capacity - r.n, 0) end,
         coalesce(r.why = 'override' and r.show_phone, false)
    from rules r
   order by r.d;
end $$;

-- booking_availability(from, to, online): what the app calls (real clock).
-- SECURITY DEFINER because the owner can't execute booking_availability_at.
-- The result includes the owner's override note and exact counts: public
-- routes must map it down to date + status (API_SPEC §1).
create or replace function public.booking_availability(p_from date, p_to date, p_online boolean)
returns table (day date, status text, reason text, note text, capacity int, booked int, spots_left int,
               call_us boolean)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select * from public.booking_availability_at(p_from, p_to, p_online, now());
$$;

-- =====================================================================
-- Row Level Security & grants (DATA_MODEL §5)
--   anon          : nothing
--   authenticated : the owner. Reads everything; edits settings, services,
--                   hours, windows, overrides; on bookings only owner_notes
--                   and is_read. No deletes of services or holidays.
--   service_role  : server route handlers + tests (bypasses RLS). Supabase's
--                   default grants (truncate, references, trigger) are revoked;
--                   booking_events is append-only (select, insert).
-- =====================================================================
alter table public.booking_settings        enable row level security;
alter table public.booking_services        enable row level security;
alter table public.booking_weekly_hours    enable row level security;
alter table public.booking_windows         enable row level security;
alter table public.booking_date_overrides  enable row level security;
alter table public.booking_public_holidays enable row level security;
alter table public.bookings                enable row level security;
alter table public.booking_items           enable row level security;
alter table public.booking_events          enable row level security;
alter table public.sms_outbox              enable row level security;

do $$
declare t text;
begin
  foreach t in array array['booking_settings', 'booking_services', 'booking_weekly_hours', 'booking_windows',
                           'booking_date_overrides', 'booking_public_holidays', 'bookings', 'booking_items',
                           'booking_events', 'sms_outbox'] loop
    execute format('drop policy if exists "owner reads" on public.%I', t);
    execute format('create policy "owner reads" on public.%I for select to authenticated using (true)', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    if t = 'booking_events' then
      execute format('grant select, insert on public.%I to service_role', t);  -- append-only history
    else
      execute format('grant select, insert, update, delete on public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- Settings: update only (single row)
drop policy if exists "owner updates" on public.booking_settings;
create policy "owner updates" on public.booking_settings
  for update to authenticated using (id = 1) with check (id = 1);
grant update (online_enabled, horizon_days, online_cutoff_time, cancel_cutoff_time, reminder_time,
              pickup_message, price_disclaimer, sms_sender_id, sms_enabled, ready_sms_mode,
              max_active_per_mobile)
  on public.booking_settings to authenticated;

-- Services: add and edit, never delete (deactivate instead)
drop policy if exists "owner adds"    on public.booking_services;
drop policy if exists "owner updates" on public.booking_services;
create policy "owner adds"    on public.booking_services for insert to authenticated with check (true);
create policy "owner updates" on public.booking_services for update to authenticated using (true) with check (true);
grant insert (name, description, price_type, price_cents, online_bookable, active, sort_order),
      update (name, description, price_type, price_cents, online_bookable, active, sort_order)
  on public.booking_services to authenticated;

-- Weekly hours: edit the 7 rows
drop policy if exists "owner updates" on public.booking_weekly_hours;
create policy "owner updates" on public.booking_weekly_hours
  for update to authenticated using (true) with check (true);
grant update (is_open, open_time, close_time, capacity_cars) on public.booking_weekly_hours to authenticated;

-- Windows and date overrides: full control
drop policy if exists "owner adds"    on public.booking_windows;
drop policy if exists "owner updates" on public.booking_windows;
drop policy if exists "owner deletes" on public.booking_windows;
create policy "owner adds"    on public.booking_windows for insert to authenticated with check (true);
create policy "owner updates" on public.booking_windows for update to authenticated using (true) with check (true);
create policy "owner deletes" on public.booking_windows for delete to authenticated using (true);
grant insert, update, delete on public.booking_windows to authenticated;

drop policy if exists "owner adds"    on public.booking_date_overrides;
drop policy if exists "owner updates" on public.booking_date_overrides;
drop policy if exists "owner deletes" on public.booking_date_overrides;
create policy "owner adds"    on public.booking_date_overrides for insert to authenticated with check (true);
create policy "owner updates" on public.booking_date_overrides for update to authenticated using (true) with check (true);
create policy "owner deletes" on public.booking_date_overrides for delete to authenticated using (true);
grant insert, update, delete on public.booking_date_overrides to authenticated;

-- Bookings: the owner edits only notes and the "new" flag. Status, dates,
-- customer details: through booking_* functions only.
drop policy if exists "owner updates" on public.bookings;
create policy "owner updates" on public.bookings
  for update to authenticated using (true) with check (true);
grant update (owner_notes, is_read) on public.bookings to authenticated;

revoke all on sequence public.booking_ref_seq from public, anon, authenticated;
grant usage on sequence public.booking_ref_seq to service_role;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default:
-- revoke explicitly, then grant back only what each role needs.
revoke all on function public.booking_day(date)                                         from public, anon, authenticated;
revoke all on function public.booking_availability_at(date, date, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.booking_availability(date, date, boolean)                 from public, anon, authenticated;
grant execute on function public.booking_day(date)                                         to service_role;
grant execute on function public.booking_availability_at(date, date, boolean, timestamptz) to service_role;
grant execute on function public.booking_availability(date, date, boolean)                 to service_role, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: owner dashboard live updates (RLS applies; anon sees nothing)
-- ---------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.sms_outbox;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- T2: creating bookings
-- =====================================================================

-- ---------------------------------------------------------------------
-- booking_tokens: the raw manage-link token, kept so later SMS (reminder,
-- rescheduled) can carry the link. Decided 2026-11-05 (security review
-- finding 2): SMS bodies hold a {manage_link} placeholder that the
-- dispatcher (T3) fills at send time from PUBLIC_BASE_URL.
-- Locked down: service_role only, no owner access, not on Realtime.
-- bookings.manage_token_hash is still what the manage page looks up.
-- Rows expire 7 days after drop-off (deleted by the retention cron, T3).
-- ---------------------------------------------------------------------
create table if not exists public.booking_tokens (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  token      text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  expires_on date not null
);
create index if not exists booking_tokens_expires_idx on public.booking_tokens (expires_on);

alter table public.booking_tokens enable row level security;
revoke all on public.booking_tokens from public, anon, authenticated, service_role;
grant select, insert, delete on public.booking_tokens to service_role;

-- ---------------------------------------------------------------------
-- Small helpers (internal: no grants; called from booking_* functions)
-- ---------------------------------------------------------------------
-- One line of customer text: control characters removed, spaces collapsed, trimmed.
create or replace function public.booking_clean_line(t text)
returns text language sql immutable security invoker set search_path = pg_catalog, pg_temp as $$
  select nullif(btrim(regexp_replace(regexp_replace(t, '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')), '');
$$;

-- Customer text that goes into an SMS: also no links, max 40 chars (SECURITY §3).
create or replace function public.booking_sms_safe(t text)
returns text language sql immutable security invoker set search_path = pg_catalog, pg_temp as $$
  select left(coalesce(public.booking_clean_line(
           regexp_replace(t, '(https?://|www\.)\S*', '', 'gi')), ''), 40);
$$;

-- 04xx xxx xxx / +61 4xx… / 614xx… → +614xxxxxxxx; anything else (landlines, 1300…) → null.
create or replace function public.booking_normalise_mobile(t text)
returns text language sql immutable security invoker set search_path = pg_catalog, pg_temp as $$
  select case
    when d ~ '^04\d{8}$'  then '+61' || substr(d, 2)
    when d ~ '^614\d{8}$' then '+' || d
  end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x;
$$;

-- 'Thu 12 Nov'
create or replace function public.booking_format_day(d date)
returns text language sql immutable security invoker set search_path = pg_catalog, pg_temp as $$
  select to_char(d, 'Dy FMDD Mon');
$$;

-- '8:30–9:30am', '11:30am–12:30pm'
create or replace function public.booking_format_window(s time, e time)
returns text language sql immutable security invoker set search_path = pg_catalog, pg_temp as $$
  select to_char(s, 'FMHH12:MI')
         || case when (s < time '12:00') = (e < time '12:00') then '' else lower(to_char(s, 'am')) end
         || '–' || to_char(e, 'FMHH12:MI') || lower(to_char(e, 'am'));
$$;

-- ---------------------------------------------------------------------
-- booking_create(p, source, allow_over, send_sms) → {id, reference_no, token, date, window_start, window_end}
--   p: {service_ids[1..5], date, window_id, first_name, last_name, mobile,
--       email?, rego, rego_state, make, model, year?, notes?}  (unknown keys rejected)
--   source 'online' : all online rules (BUSINESS_RULES §4–5); never overbooks.
--   source 'owner'  : no cutoff/horizon, same day allowed; overbooks only with allow_over.
-- Errors: exception message = API code (VALIDATION, NOT_FOUND, FULL,
-- DUPLICATE_BOOKING, CLOSED, CUTOFF_PASSED, OUTSIDE_HORIZON, MOBILE_LIMIT,
-- BOOKING_OFF), detail = field name or the existing booking's date. No PII.
-- Concurrency: advisory locks, always mobile first, then date, held to commit.
-- The raw token is returned once; the table keeps its SHA-256.
-- service_role only (the owner gets a wrapper in T5).
-- ---------------------------------------------------------------------
create or replace function public.booking_create(p jsonb, p_source text, p_allow_over boolean, p_send_sms boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  c_fields constant text[] := array['service_ids', 'date', 'window_id', 'first_name', 'last_name', 'mobile',
                                    'email', 'rego', 'rego_state', 'make', 'model', 'year', 'notes'];
  v_set      public.booking_settings%rowtype;
  v_window   public.booking_windows%rowtype;
  v_online   boolean;
  v_service_ids uuid[];
  v_n        int;
  v_date     date;
  v_first    text;
  v_last     text;
  v_mobile   text;
  v_email    text;
  v_rego     text;
  v_state    text;
  v_make     text;
  v_model    text;
  v_year     int;
  v_notes    text;
  v_status   text;
  v_reason   text;
  v_capacity int;
  v_booked   int;
  v_over     boolean := false;
  v_token    text;
  v_id       uuid;
  v_ref      text;
  v_name     text;
  v_services text;
begin
  -- ---- shape ----
  if p is null or jsonb_typeof(p) is distinct from 'object' then
    raise exception 'VALIDATION' using detail = 'body';
  end if;
  if p_source is null or p_source not in ('online', 'owner') then
    raise exception 'VALIDATION' using detail = 'source';
  end if;
  v_online := p_source = 'online';
  if v_online and coalesce(p_allow_over, false) then
    raise exception 'VALIDATION' using detail = 'allow_over';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k(key) where k.key <> all (c_fields)) then
    raise exception 'VALIDATION' using detail = 'unknown field';
  end if;

  -- ---- fields (same rules as the Zod schema) ----
  if jsonb_typeof(p -> 'service_ids') is distinct from 'array' then
    raise exception 'VALIDATION' using detail = 'service_ids';
  end if;
  begin
    select coalesce(array_agg(x::uuid), '{}') into v_service_ids from jsonb_array_elements_text(p -> 'service_ids') x;
  exception when invalid_text_representation then
    raise exception 'VALIDATION' using detail = 'service_ids';
  end;
  v_n := cardinality(v_service_ids);
  if v_n not between 1 and 5 or (select count(distinct x) from unnest(v_service_ids) x) <> v_n then
    raise exception 'VALIDATION' using detail = 'service_ids';
  end if;

  if coalesce(p ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'VALIDATION' using detail = 'date';
  end if;
  begin
    v_date := (p ->> 'date')::date;
  exception when others then
    raise exception 'VALIDATION' using detail = 'date';
  end;

  begin
    select * into v_window from public.booking_windows w where w.id = (p ->> 'window_id')::uuid and w.active;
  exception when invalid_text_representation then
    raise exception 'VALIDATION' using detail = 'window_id';
  end;
  if v_window.id is null then
    raise exception 'VALIDATION' using detail = 'window_id';
  end if;

  v_first := public.booking_clean_line(p ->> 'first_name');
  v_last  := public.booking_clean_line(p ->> 'last_name');
  v_make  := public.booking_clean_line(p ->> 'make');
  v_model := public.booking_clean_line(p ->> 'model');
  if v_first is null or char_length(v_first) > 80 then raise exception 'VALIDATION' using detail = 'first_name'; end if;
  if v_last  is null or char_length(v_last)  > 80 then raise exception 'VALIDATION' using detail = 'last_name';  end if;
  if v_make  is null or char_length(v_make)  > 60 then raise exception 'VALIDATION' using detail = 'make';       end if;
  if v_model is null or char_length(v_model) > 80 then raise exception 'VALIDATION' using detail = 'model';      end if;

  v_mobile := public.booking_normalise_mobile(p ->> 'mobile');
  if v_mobile is null then raise exception 'VALIDATION' using detail = 'mobile'; end if;

  v_email := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  if v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'VALIDATION' using detail = 'email';
  end if;

  v_rego := upper(regexp_replace(coalesce(p ->> 'rego', ''), '[^A-Za-z0-9]', '', 'g'));
  if v_rego !~ '^[A-Z0-9]{1,9}$' then raise exception 'VALIDATION' using detail = 'rego'; end if;

  v_state := upper(btrim(coalesce(p ->> 'rego_state', '')));
  if v_state not in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT') then
    raise exception 'VALIDATION' using detail = 'rego_state';
  end if;

  if jsonb_typeof(p -> 'year') = 'null' or not (p ? 'year') then
    v_year := null;
  else
    begin
      v_year := (p ->> 'year')::int;
    exception when others then
      raise exception 'VALIDATION' using detail = 'year';
    end;
    if v_year not between 1950 and 2100 then raise exception 'VALIDATION' using detail = 'year'; end if;
  end if;

  -- Notes keep line breaks; other control characters go
  v_notes := btrim(regexp_replace(coalesce(p ->> 'notes', ''), '[\x01-\x09\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
  if char_length(v_notes) > 1000 then raise exception 'VALIDATION' using detail = 'notes'; end if;

  -- ---- services: exist, active, bookable online (for online) ----
  select count(*) into v_n
    from public.booking_services s
   where s.id = any (v_service_ids) and s.active and (not v_online or s.online_bookable);
  if v_n <> cardinality(v_service_ids) then
    raise exception 'NOT_FOUND' using detail = 'service';
  end if;

  select * into v_set from public.booking_settings where id = 1;
  if v_online and not coalesce(v_set.online_enabled, false) then
    raise exception 'BOOKING_OFF';
  end if;

  -- ---- locks: mobile first, then date (fixed order, so no deadlocks) ----
  perform pg_advisory_xact_lock(hashtextextended('booking:mobile:' || v_mobile, 0));
  perform pg_advisory_xact_lock(hashtextextended('booking:date:' || v_date::text, 0));

  -- ---- day rules + capacity (counted after the lock) ----
  select a.status, a.reason, a.capacity, a.booked into v_status, v_reason, v_capacity, v_booked
    from public.booking_availability_at(v_date, v_date, v_online, now()) a;
  if v_status = 'closed' then
    raise exception '%', case v_reason
      when 'same_day'    then 'CUTOFF_PASSED'
      when 'cutoff'      then 'CUTOFF_PASSED'
      when 'horizon'     then 'OUTSIDE_HORIZON'
      when 'booking_off' then 'BOOKING_OFF'
      else 'CLOSED'
    end;
  end if;
  if v_status = 'full' then
    if coalesce(p_allow_over, false) then
      v_over := true;
    else
      raise exception 'FULL';
    end if;
  end if;

  -- ---- one active booking per rego per day ----
  if exists (select 1 from public.bookings b
              where b.rego = v_rego and b.drop_off_date = v_date and b.status in ('booked', 'arrived', 'completed')) then
    raise exception 'DUPLICATE_BOOKING' using detail = v_date::text;
  end if;

  -- ---- online: max active future bookings per mobile ----
  if v_online and (select count(*) from public.bookings b
                    where b.mobile = v_mobile and b.status = 'booked'
                      and b.drop_off_date >= (now() at time zone 'Australia/Sydney')::date)
                  >= coalesce(v_set.max_active_per_mobile, 3) then
    raise exception 'MOBILE_LIMIT';
  end if;

  -- ---- insert ----
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  begin
    insert into public.bookings (
      status, source, drop_off_date, window_id, window_start, window_end,
      first_name, last_name, mobile, email, rego, rego_state, make, model, year,
      customer_notes, over_capacity, manage_token_hash
    ) values (
      'booked', p_source, v_date, v_window.id, v_window.start_time, v_window.end_time,
      v_first, v_last, v_mobile, v_email, v_rego, v_state, v_make, v_model, v_year,
      v_notes, v_over, extensions.digest(v_token, 'sha256')
    )
    returning id, reference_no into v_id, v_ref;
  exception when unique_violation then
    raise exception 'DUPLICATE_BOOKING' using detail = v_date::text;
  end;

  insert into public.booking_items (booking_id, service_id, name_snapshot, price_type_snapshot, price_cents_snapshot)
  select v_id, s.id, s.name, s.price_type, s.price_cents
    from public.booking_services s where s.id = any (v_service_ids);

  insert into public.booking_events (booking_id, at, actor, action, details)
  values (v_id, clock_timestamp(), case when v_online then 'customer' else 'owner' end, 'created',
          jsonb_build_object('source', p_source));
  if v_over then
    insert into public.booking_events (booking_id, at, actor, action, details)
    values (v_id, clock_timestamp(), 'owner', 'overbooked',
            jsonb_build_object('capacity', v_capacity, 'booked_before', v_booked));
  end if;

  insert into public.booking_tokens (booking_id, token, expires_on) values (v_id, v_token, v_date + 7);

  -- ---- confirmation SMS (sent by the dispatcher, T3). Never fails the booking. ----
  if coalesce(v_set.sms_enabled, true) and coalesce(p_send_sms, true) then
    begin
      select left(coalesce(public.booking_sms_safe(g.business_name), ''), 40) into v_name from public.settings g where g.id = 1;
      select left(string_agg(s.name, ', ' order by s.sort_order, s.name), 200) into v_services
        from public.booking_services s where s.id = any (v_service_ids);
      insert into public.sms_outbox (booking_id, template, to_mobile, body, dedupe_key)
      values (
        v_id, 'confirmation', v_mobile,
        format('Hi %s, you''re booked at %s for %s, drop off %s. %s. Manage: {manage_link}',
               coalesce(nullif(public.booking_sms_safe(v_first), ''), 'there'),
               coalesce(nullif(v_name, ''), 'Sai Motor Works'),
               public.booking_format_day(v_date),
               public.booking_format_window(v_window.start_time, v_window.end_time),
               v_services),
        v_id::text || ':confirmation'
      )
      on conflict (dedupe_key) do nothing;
    exception when others then
      -- An SMS problem never fails a booking (CLAUDE.md). Recorded without PII.
      insert into public.booking_events (booking_id, at, actor, action, details)
      values (v_id, clock_timestamp(), 'system', 'sms_retry', jsonb_build_object('error', 'confirmation not queued', 'sqlstate', sqlstate));
    end;
  end if;

  return jsonb_build_object(
    'id', v_id, 'reference_no', v_ref, 'token', v_token,
    'date', v_date, 'window_start', v_window.start_time, 'window_end', v_window.end_time
  );
end $$;

-- ---------------------------------------------------------------------
-- booking_public_info(): what the public booking page may see. service_role only.
-- ---------------------------------------------------------------------
create or replace function public.booking_public_info()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'online_enabled',   s.online_enabled,
    'business',         jsonb_build_object('name', coalesce(g.business_name, 'Sai Motor Works'),
                                           'phone', g.phone, 'address', g.address),
    'pickup_message',   s.pickup_message,
    'price_disclaimer', s.price_disclaimer,
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'description', v.description,
                                                              'price_type', v.price_type, 'price_cents', v.price_cents)
                                           order by v.sort_order, v.name)
                            from public.booking_services v where v.active and v.online_bookable), '[]'::jsonb),
    'windows',  coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'start_time', w.start_time, 'end_time', w.end_time)
                                           order by w.sort_order, w.start_time)
                            from public.booking_windows w where w.active), '[]'::jsonb),
    'hours',    (select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'is_open', h.is_open,
                                                     'open_time', h.open_time, 'close_time', h.close_time)
                                  order by h.weekday)
                   from public.booking_weekly_hours h)
  )
  from public.booking_settings s
  left join public.settings g on g.id = 1
  where s.id = 1;
$$;

revoke all on function public.booking_clean_line(text)                      from public, anon, authenticated;
revoke all on function public.booking_sms_safe(text)                        from public, anon, authenticated;
revoke all on function public.booking_normalise_mobile(text)                from public, anon, authenticated;
revoke all on function public.booking_format_day(date)                      from public, anon, authenticated;
revoke all on function public.booking_format_window(time, time)             from public, anon, authenticated;
revoke all on function public.booking_create(jsonb, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.booking_public_info()                         from public, anon, authenticated;
grant execute on function public.booking_create(jsonb, text, boolean, boolean) to service_role;
grant execute on function public.booking_public_info()                         to service_role;

-- =====================================================================
-- T3: SMS dispatch, reminders, retention
-- Flow: booking_* functions INSERT into sms_outbox (pending). The cron
-- dispatcher (and an after() kick from POST /api/booking) calls
-- booking_sms_claim → sends via the provider → booking_sms_result.
-- =====================================================================

-- When a row was claimed: rows stuck in 'sending' (dispatcher crashed) are re-queued after 10 minutes.
alter table public.sms_outbox add column if not exists claimed_at timestamptz;

-- ---------------------------------------------------------------------
-- booking_sms_claim(limit, ids?) → due rows, now 'sending', attempts + 1.
-- Before claiming, stale rows are set 'cancelled' (never sent):
--   SMS turned off in settings · confirmation/reminder/rescheduled whose booking
--   is gone or no longer 'booked' · 'cancelled' SMS whose booking was re-opened ·
--   reminder whose drop-off day isn't tomorrow any more · a {manage_link}
--   body whose token has expired.
-- for update skip locked: two dispatchers never get the same row.
-- p_ids: limit to these rows (tests only; the app passes null).
-- ---------------------------------------------------------------------
create or replace function public.booking_sms_claim(p_limit int, p_ids uuid[] default null)
returns table (id uuid, template text, to_mobile text, body text, token text, sender_id text, attempts int)
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_set   public.booking_settings%rowtype;
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  select * into v_set from public.booking_settings s where s.id = 1;

  -- Stuck in 'sending' > 10 min: back to pending (or failed after 3 tries)
  update public.sms_outbox o
     set status = case when o.attempts >= 3 then 'failed' else 'pending' end,
         last_error = case when o.attempts >= 3 then 'No result recorded' else o.last_error end,
         next_attempt_at = now()
   where o.status = 'sending' and o.claimed_at < now() - interval '10 minutes'
     and (p_ids is null or o.id = any (p_ids));

  -- Stale rows
  update public.sms_outbox o
     set status = 'cancelled',
         last_error = x.why
    from (
      select o2.id,
             case
               when not coalesce(v_set.sms_enabled, true) then 'SMS turned off in settings'
               when o2.template in ('confirmation', 'reminder', 'rescheduled')
                    and (b.id is null or b.status <> 'booked') then 'Booking is no longer booked'
               when o2.template = 'cancelled' and (b.id is null or b.status <> 'cancelled') then 'Booking is no longer cancelled'
               when o2.template = 'reminder' and b.drop_off_date <> v_today + 1
                    and b.drop_off_date <= v_today then 'Reminder is too late'
               when position('{manage_link}' in o2.body) > 0
                    and (t.token is null or t.expires_on < v_today) then 'Manage link has expired'
             end as why
        from public.sms_outbox o2
        left join public.bookings b on b.id = o2.booking_id
        left join public.booking_tokens t on t.booking_id = o2.booking_id
       where o2.status = 'pending' and o2.next_attempt_at <= now()
         and (p_ids is null or o2.id = any (p_ids))
    ) x
   where o.id = x.id and x.why is not null;

  return query
  with due as (
    select o.id
      from public.sms_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
       and (p_ids is null or o.id = any (p_ids))
     order by o.next_attempt_at, o.created_at
     limit greatest(coalesce(p_limit, 50), 0)
     for update skip locked
  ),
  claimed as (
    update public.sms_outbox o
       set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from due
     where o.id = due.id
    returning o.id, o.template, o.to_mobile, o.body, o.booking_id, o.attempts
  )
  select c.id, c.template, c.to_mobile, c.body, t.token,
         coalesce(v_set.sms_sender_id, 'SaiMotor'), c.attempts
    from claimed c
    left join public.booking_tokens t on t.booking_id = c.booking_id;
end $$;

-- ---------------------------------------------------------------------
-- booking_sms_result(id, ok, provider_id, error, retryable) → new status, or null if
-- the row wasn't 'sending' (results are recorded once).
-- 3 tries in all: a retryable failure waits 1 min after the 1st try, 5 min after
-- the 2nd; the 3rd failure (or any non-retryable one) → 'failed' (badge + owner retry, T4).
-- error: short, no PII (callers pass provider codes only); capped at 300 chars.
-- ---------------------------------------------------------------------
create or replace function public.booking_sms_result(p_id uuid, p_ok boolean, p_provider_id text, p_error text, p_retryable boolean default true)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_attempts int;
  v_status   text;
begin
  select o.attempts into v_attempts from public.sms_outbox o where o.id = p_id and o.status = 'sending' for update;
  if not found then return null; end if;

  if coalesce(p_ok, false) then
    v_status := 'sent';
    update public.sms_outbox
       set status = v_status, sent_at = now(), last_error = null,
           provider_message_id = left(public.booking_clean_line(p_provider_id), 100)
     where id = p_id;
  elsif coalesce(p_retryable, true) and v_attempts < 3 then
    v_status := 'pending';
    update public.sms_outbox
       set status = v_status,
           last_error = left(coalesce(public.booking_clean_line(p_error), 'Send failed'), 300),
           next_attempt_at = now() + case when v_attempts <= 1 then interval '1 minute' else interval '5 minutes' end
     where id = p_id;
  else
    v_status := 'failed';
    update public.sms_outbox
       set status = v_status, last_error = left(coalesce(public.booking_clean_line(p_error), 'Send failed'), 300)
     where id = p_id;
  end if;
  return v_status;
end $$;

-- ---------------------------------------------------------------------
-- booking_enqueue_reminders_at(now) → reminders queued.
-- From reminder_time (10:00 Sydney) on the day before drop-off, for 'booked'
-- bookings made before that time. Dedupe key {booking_id}:reminder:{date}, so running it
-- every 15 minutes never sends twice (a rescheduled booking gets one for its new date, T4). p_now is for tests (service_role only);
-- the cron calls booking_enqueue_reminders().
-- ---------------------------------------------------------------------
create or replace function public.booking_enqueue_reminders_at(p_now timestamptz)
returns int
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_set     public.booking_settings%rowtype;
  v_local   timestamp := p_now at time zone 'Australia/Sydney';
  v_today   date := (p_now at time zone 'Australia/Sydney')::date;
  v_cut     timestamptz;
  v_name    text;
  v_address text;
  v_n       int;
begin
  select * into v_set from public.booking_settings where id = 1;
  if not coalesce(v_set.sms_enabled, true) or v_local::time < coalesce(v_set.reminder_time, time '10:00') then
    return 0;
  end if;
  v_cut := (v_today + coalesce(v_set.reminder_time, time '10:00')) at time zone 'Australia/Sydney';

  select coalesce(nullif(public.booking_sms_safe(g.business_name), ''), 'Sai Motor Works'),
         left(public.booking_clean_line(g.address), 80)
    into v_name, v_address
    from public.settings g where g.id = 1;

  insert into public.sms_outbox (booking_id, template, to_mobile, body, dedupe_key)
  select b.id, 'reminder', b.mobile,
         format('Reminder: %s is booked at %s tomorrow, drop off %s.%s Manage: {manage_link}',
                b.rego, coalesce(v_name, 'Sai Motor Works'),
                public.booking_format_window(b.window_start, b.window_end),
                case when v_address is not null then ' ' || v_address || '.' else '' end),
         b.id::text || ':reminder:' || b.drop_off_date::text
    from public.bookings b
   where b.status = 'booked'
     and b.drop_off_date = v_today + 1
     and b.created_at < v_cut
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.booking_enqueue_reminders()
returns int
language sql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
  select public.booking_enqueue_reminders_at(now());
$$;

-- ---------------------------------------------------------------------
-- booking_retention() → {outbox_deleted, tokens_deleted}. Daily cron.
-- sms_outbox rows older than 2 years (BUSINESS_RULES §14); manage tokens past expiry.
-- ---------------------------------------------------------------------
create or replace function public.booking_retention()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_outbox int;
  v_tokens int;
begin
  delete from public.sms_outbox where created_at < now() - interval '2 years';
  get diagnostics v_outbox = row_count;
  delete from public.booking_tokens where expires_on < (now() at time zone 'Australia/Sydney')::date;
  get diagnostics v_tokens = row_count;
  return jsonb_build_object('outbox_deleted', v_outbox, 'tokens_deleted', v_tokens);
end $$;

revoke all on function public.booking_sms_claim(int, uuid[])                        from public, anon, authenticated;
revoke all on function public.booking_sms_result(uuid, boolean, text, text, boolean) from public, anon, authenticated;
revoke all on function public.booking_enqueue_reminders_at(timestamptz)             from public, anon, authenticated;
revoke all on function public.booking_enqueue_reminders()                           from public, anon, authenticated;
revoke all on function public.booking_retention()                                   from public, anon, authenticated;
grant execute on function public.booking_sms_claim(int, uuid[])                        to service_role;
grant execute on function public.booking_sms_result(uuid, boolean, text, text, boolean) to service_role;
grant execute on function public.booking_enqueue_reminders_at(timestamptz)             to service_role;
grant execute on function public.booking_enqueue_reminders()                           to service_role;
grant execute on function public.booking_retention()                                   to service_role;

-- =====================================================================
-- T4: owner actions from the dashboard (BUSINESS_RULES §7, API_SPEC §2)
-- All: SECURITY DEFINER, owner (authenticated) only; the server's service role
-- and anon can't call them. Errors as booking_create: message = API code,
-- detail = field / date / transition. Each change is a booking_events row.
-- Locks: mobile, then date (same order as booking_create) whenever a booking
-- takes a spot on a day.
-- =====================================================================

-- Business name for SMS bodies (internal).
create or replace function public.booking_sms_business_name()
returns text language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select coalesce(nullif((select public.booking_sms_safe(g.business_name) from public.settings g where g.id = 1), ''),
                  'Sai Motor Works');
$$;

-- ---------------------------------------------------------------------
-- booking_owner_set_status(id, status) → {id, status}
--   forward: booked → arrived → completed; booked → no_show (on/after the day)
--   undo:    arrived → booked, completed → arrived, no_show → booked, cancelled → booked
--   Undo sends no SMS. Back to 'booked' removes any check-in link. Re-opening a
--   cancelled / no-show booking takes its spot back: same rego that day →
--   DUPLICATE_BOOKING; a full day is overbooked and flagged (owner action).
--   Cancelling goes through booking_owner_cancel.
-- ---------------------------------------------------------------------
create or replace function public.booking_owner_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_b        public.bookings%rowtype;
  v_today    date := (now() at time zone 'Australia/Sydney')::date;
  v_action   text;
  v_reopen   boolean;
  v_capacity int;
  v_booked   int;
  v_over     boolean := false;
begin
  if p_status is null or p_status not in ('booked', 'arrived', 'completed', 'cancelled', 'no_show') then
    raise exception 'VALIDATION' using detail = 'status';
  end if;
  select * into v_b from public.bookings b where b.id = p_id;
  if not found then raise exception 'NOT_FOUND' using detail = 'booking'; end if;

  v_reopen := v_b.status in ('cancelled', 'no_show') and p_status = 'booked';
  if v_reopen then
    perform pg_advisory_xact_lock(hashtextextended('booking:mobile:' || v_b.mobile, 0));
    perform pg_advisory_xact_lock(hashtextextended('booking:date:' || v_b.drop_off_date::text, 0));
  end if;
  select * into v_b from public.bookings b where b.id = p_id for update;

  v_action := case
    when v_b.status = 'booked'    and p_status = 'arrived'   then 'arrived'
    when v_b.status = 'arrived'   and p_status = 'completed' then 'completed'
    when v_b.status = 'booked'    and p_status = 'no_show'   then 'no_show'
    when v_b.status = 'arrived'   and p_status = 'booked'    then 'reverted'
    when v_b.status = 'completed' and p_status = 'arrived'   then 'reverted'
    when v_b.status = 'no_show'   and p_status = 'booked'    then 'reverted'
    when v_b.status = 'cancelled' and p_status = 'booked'    then 'reverted'
  end;
  if v_action is null then
    raise exception 'INVALID_TRANSITION' using detail = v_b.status || '>' || p_status;
  end if;
  if v_action = 'no_show' and v_b.drop_off_date > v_today then
    raise exception 'INVALID_TRANSITION' using detail = 'not_yet';
  end if;

  if v_reopen then
    if exists (select 1 from public.bookings b
                where b.rego = v_b.rego and b.drop_off_date = v_b.drop_off_date and b.id <> v_b.id
                  and b.status in ('booked', 'arrived', 'completed')) then
      raise exception 'DUPLICATE_BOOKING' using detail = v_b.drop_off_date::text;
    end if;
    select a.capacity, a.booked into v_capacity, v_booked
      from public.booking_availability_at(v_b.drop_off_date, v_b.drop_off_date, false, now()) a;
    v_over := v_booked >= v_capacity;
  end if;

  begin
    update public.bookings
       set status        = p_status,
           cancelled_at  = null,
           checkin_id    = case when p_status = 'booked' then null else checkin_id end,
           over_capacity = over_capacity or v_over
     where id = p_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_BOOKING' using detail = v_b.drop_off_date::text;
  end;

  insert into public.booking_events (booking_id, at, actor, action, details)
  values (p_id, clock_timestamp(), 'owner', v_action,
          case when v_action = 'reverted'
               then jsonb_strip_nulls(jsonb_build_object(
                      'from', v_b.status, 'to', p_status,
                      'unlinked_checkin', case when p_status = 'booked' and v_b.checkin_id is not null then true end))
               else '{}'::jsonb end);
  if v_over then
    insert into public.booking_events (booking_id, at, actor, action, details)
    values (p_id, clock_timestamp(), 'owner', 'overbooked', jsonb_build_object('capacity', v_capacity, 'booked_before', v_booked));
  end if;

  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------
-- booking_owner_cancel(id, notify) → {id, status}. Only 'booked' bookings.
-- notify (and SMS on in settings): 'cancelled' SMS; its {booking_page} is filled
-- in at send time. Dedupe {id}:cancelled:{n} (n-th cancellation, after undo).
-- The steps live in booking_cancel_core (T7), shared with the customer's link.
-- ---------------------------------------------------------------------
create or replace function public.booking_owner_cancel(p_id uuid, p_notify boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  return public.booking_cancel_core(p_id, 'owner', coalesce(p_notify, false));
end $$;

-- ---------------------------------------------------------------------
-- booking_owner_reschedule(id, date, window_id, allow_over, notify) → {id, status, date}
--   Only 'booked'. Owner rules: no cutoff/horizon, today allowed, not past or
--   closed days; a full day needs allow_over (flagged + 'overbooked' event).
--   Same link: the token's expiry moves to the new date + 7 (a new token if the
--   old one was already removed). Unsent confirmation / reminder / rescheduled
--   SMS for the old date are cancelled. notify: 'rescheduled' SMS,
--   dedupe {id}:rescheduled:{n}. Steps in booking_reschedule_core (T7).
-- ---------------------------------------------------------------------
create or replace function public.booking_owner_reschedule(p_id uuid, p_date date, p_window_id uuid, p_allow_over boolean, p_notify boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  return public.booking_reschedule_core(p_id, p_date, p_window_id, false, coalesce(p_allow_over, false),
                                        coalesce(p_notify, false), 'owner');
end $$;

-- ---------------------------------------------------------------------
-- booking_link_checkin(id, checkin_id | null) → {id, status, checkin_id}
--   Link: booking booked/arrived/completed; a booked one becomes arrived.
--   A check-in linked to another booking → VALIDATION (detail checkin_id).
--   null unlinks (status unchanged). checkins.booking_id comes in T6.
-- ---------------------------------------------------------------------
create or replace function public.booking_link_checkin(p_id uuid, p_checkin_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_b      public.bookings%rowtype;
  v_status text;
begin
  select * into v_b from public.bookings b where b.id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'booking'; end if;

  if p_checkin_id is null then
    if v_b.checkin_id is not null then
      update public.bookings set checkin_id = null where id = p_id;
      insert into public.booking_events (booking_id, at, actor, action, details)
      values (p_id, clock_timestamp(), 'owner', 'linked_checkin', jsonb_build_object('checkin_id', null));
    end if;
    return jsonb_build_object('id', p_id, 'status', v_b.status, 'checkin_id', null);
  end if;

  if v_b.status not in ('booked', 'arrived', 'completed') then
    raise exception 'INVALID_TRANSITION' using detail = v_b.status || '>linked';
  end if;
  if not exists (select 1 from public.checkins c where c.id = p_checkin_id) then
    raise exception 'NOT_FOUND' using detail = 'checkin';
  end if;
  if exists (select 1 from public.bookings b where b.checkin_id = p_checkin_id and b.id <> p_id) then
    raise exception 'VALIDATION' using detail = 'checkin_id';
  end if;

  v_status := case when v_b.status = 'booked' then 'arrived' else v_b.status end;
  begin
    update public.bookings set checkin_id = p_checkin_id, status = v_status where id = p_id;
  exception when unique_violation then
    raise exception 'VALIDATION' using detail = 'checkin_id';
  end;

  insert into public.booking_events (booking_id, at, actor, action, details)
  values (p_id, clock_timestamp(), 'owner', 'linked_checkin', jsonb_build_object('checkin_id', p_checkin_id));
  if v_b.status = 'booked' then
    insert into public.booking_events (booking_id, at, actor, action, details)
    values (p_id, clock_timestamp(), 'owner', 'arrived', jsonb_build_object('via', 'checkin'));
  end if;

  return jsonb_build_object('id', p_id, 'status', v_status, 'checkin_id', p_checkin_id);
end $$;

-- ---------------------------------------------------------------------
-- booking_retry_sms(outbox_id) → {id, status}. Only 'failed' rows: back to
-- pending with 3 fresh tries. The dispatcher still cancels it if it has gone
-- stale (e.g. a confirmation for a cancelled booking).
-- ---------------------------------------------------------------------
create or replace function public.booking_retry_sms(p_outbox_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_o public.sms_outbox%rowtype;
begin
  select * into v_o from public.sms_outbox o where o.id = p_outbox_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'sms'; end if;
  if v_o.status <> 'failed' then
    raise exception 'INVALID_TRANSITION' using detail = v_o.status || '>retry';
  end if;

  update public.sms_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), claimed_at = null
   where id = p_outbox_id;
  if v_o.booking_id is not null then
    insert into public.booking_events (booking_id, at, actor, action, details)
    values (v_o.booking_id, clock_timestamp(), 'owner', 'sms_retry', jsonb_build_object('template', v_o.template));
  end if;
  return jsonb_build_object('id', p_outbox_id, 'status', 'pending');
end $$;

revoke all on function public.booking_sms_business_name()                                    from public, anon, authenticated, service_role;
revoke all on function public.booking_owner_set_status(uuid, text)                           from public, anon, authenticated, service_role;
revoke all on function public.booking_owner_cancel(uuid, boolean)                            from public, anon, authenticated, service_role;
revoke all on function public.booking_owner_reschedule(uuid, date, uuid, boolean, boolean)   from public, anon, authenticated, service_role;
revoke all on function public.booking_link_checkin(uuid, uuid)                               from public, anon, authenticated, service_role;
revoke all on function public.booking_retry_sms(uuid)                                        from public, anon, authenticated, service_role;
grant execute on function public.booking_owner_set_status(uuid, text)                         to authenticated;
grant execute on function public.booking_owner_cancel(uuid, boolean)                          to authenticated;
grant execute on function public.booking_owner_reschedule(uuid, date, uuid, boolean, boolean) to authenticated;
grant execute on function public.booking_link_checkin(uuid, uuid)                             to authenticated;
grant execute on function public.booking_retry_sms(uuid)                                      to authenticated;

-- =====================================================================
-- T5: phone quick-add + send booking link (BUSINESS_RULES §12, API_SPEC §2)
-- Owner (authenticated) only, like T4.
-- =====================================================================

-- ---------------------------------------------------------------------
-- booking_owner_create(p, allow_over, send_sms) → {id, reference_no, date}
--   booking_create with source 'owner' (today allowed, no cutoff/horizon, full
--   day only with allow_over). Saved as read (the owner made it). The manage
--   token is never returned to the browser: the confirmation SMS carries it.
-- ---------------------------------------------------------------------
create or replace function public.booking_owner_create(p jsonb, p_allow_over boolean, p_send_sms boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v jsonb;
begin
  v := public.booking_create(p, 'owner', coalesce(p_allow_over, false), coalesce(p_send_sms, true));
  update public.bookings set is_read = true where id = (v ->> 'id')::uuid;
  return jsonb_build_object('id', v -> 'id', 'reference_no', v -> 'reference_no', 'date', v -> 'date');
end $$;

-- ---------------------------------------------------------------------
-- booking_customer_lookup(mobile) → {firstName, lastName, email, vehicles[], noShows} or null
--   From earlier bookings and kiosk check-ins with that mobile (check-in phones
--   are free text, so both sides are normalised). Name from the newest record,
--   email from the newest that has one, up to 5 cars (newest first, once each).
-- ---------------------------------------------------------------------
create or replace function public.booking_customer_lookup(p_mobile text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_mobile text := public.booking_normalise_mobile(p_mobile);
  v        jsonb;
begin
  if v_mobile is null then raise exception 'VALIDATION' using detail = 'mobile'; end if;

  with src as (
    select b.created_at, b.first_name, b.last_name, b.email, b.rego, b.rego_state as state, b.make, b.model, b.year
      from public.bookings b
     where b.mobile = v_mobile
    union all
    select c.created_at, c.first_name, c.last_name, c.email,
           upper(regexp_replace(c.rego, '[^A-Za-z0-9]', '', 'g')), null, c.make, c.model, c.year
      from public.checkins c
     where public.booking_normalise_mobile(c.phone) = v_mobile
  ),
  cars as (
    select distinct on (s.rego) s.rego,
           (select s2.state from src s2 where s2.rego = s.rego and s2.state is not null
             order by s2.created_at desc limit 1) as state,
           s.make, s.model, s.year, s.created_at
      from src s
     where s.rego <> ''
     order by s.rego, s.created_at desc
  )
  select jsonb_build_object(
           'firstName', l.first_name,
           'lastName',  l.last_name,
           'email',     (select s.email from src s where s.email is not null order by s.created_at desc limit 1),
           'vehicles',  coalesce((select jsonb_agg(jsonb_build_object('rego', c.rego, 'state', c.state, 'make', c.make,
                                                                       'model', c.model, 'year', c.year)
                                                    order by c.created_at desc)
                                     from (select * from cars order by created_at desc limit 5) c), '[]'::jsonb),
           'noShows',   (select count(*) from public.bookings b where b.mobile = v_mobile and b.status = 'no_show'))
    into v
    from (select * from src order by created_at desc limit 1) l;

  return v; -- null when nothing matched
end $$;

-- ---------------------------------------------------------------------
-- booking_send_link(mobile) → {queued: true}. Option B: 'booking_link' SMS with
-- {booking_page} (filled in at send time). Max 5 per mobile per Sydney day
-- (advisory lock on the mobile, so parallel sends can't pass it) → RATE_LIMITED.
-- SMS off in settings → VALIDATION (detail sms_off).
-- ---------------------------------------------------------------------
create or replace function public.booking_send_link(p_mobile text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  c_limit constant int := 5;
  v_mobile text := public.booking_normalise_mobile(p_mobile);
  v_set    public.booking_settings%rowtype;
  v_today  date := (now() at time zone 'Australia/Sydney')::date;
  v_n      int;
begin
  if v_mobile is null then raise exception 'VALIDATION' using detail = 'mobile'; end if;
  select * into v_set from public.booking_settings where id = 1;
  if not coalesce(v_set.sms_enabled, true) then raise exception 'VALIDATION' using detail = 'sms_off'; end if;

  perform pg_advisory_xact_lock(hashtextextended('booking:link:' || v_mobile, 0));
  select count(*) into v_n
    from public.sms_outbox o
   where o.template = 'booking_link' and o.to_mobile = v_mobile
     and o.created_at >= (v_today::timestamp at time zone 'Australia/Sydney');
  if v_n >= c_limit then raise exception 'RATE_LIMITED'; end if;

  insert into public.sms_outbox (template, to_mobile, body, dedupe_key)
  values ('booking_link', v_mobile,
          format('Hi, book your service with %s here: {booking_page}', public.booking_sms_business_name()),
          'link:' || v_mobile || ':' || v_today::text || ':' || (v_n + 1));
  return jsonb_build_object('queued', true);
end $$;

revoke all on function public.booking_owner_create(jsonb, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.booking_customer_lookup(text)                 from public, anon, authenticated, service_role;
revoke all on function public.booking_send_link(text)                       from public, anon, authenticated, service_role;
grant execute on function public.booking_owner_create(jsonb, boolean, boolean) to authenticated;
grant execute on function public.booking_customer_lookup(text)                 to authenticated;
grant execute on function public.booking_send_link(text)                       to authenticated;

-- =====================================================================
-- T6: kiosk check-ins ↔ bookings + ready SMS (BUSINESS_RULES §7–8, §10)
-- The link lives only in bookings.checkin_id (unique, since T1): checkins
-- gets no new column (owner decision 2026-11-06). The triggers below are
-- the only change on checkins, and they never raise: the kiosk and job
-- saves must keep working whatever happens to bookings.
-- =====================================================================

-- Fault switch for the "a trigger error never blocks the kiosk" tests. Only the
-- server key can write it; always empty in production.
create table if not exists public.booking_test_faults (
  name text primary key check (name in ('checkin_link', 'checkin_complete'))
);
alter table public.booking_test_faults enable row level security;
revoke all on public.booking_test_faults from public, anon, authenticated, service_role;
grant select, insert, delete on public.booking_test_faults to service_role;

create or replace function public.booking_fault(p_name text)
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from public.booking_test_faults f where f.name = p_name);
$$;

-- '17:00' → '5pm', '16:30' → '4:30pm'
create or replace function public.booking_format_time(t time)
returns text language sql immutable security invoker set search_path = pg_catalog, pg_temp as $$
  select to_char(t, 'FMHH12') || case when extract(minute from t) <> 0 then to_char(t, ':MI') else '' end
         || lower(to_char(t, 'am'));
$$;

-- ---------------------------------------------------------------------
-- booking_queue_ready(booking, checkin, mobile, first, rego, resend) → outbox id (internal)
--   Dedupe ready:{checkin_id or booking_id}:{n}. A linked booking + check-in
--   share the check-in's key, and earlier rows under either id count, so a car
--   never gets two by accident: a ready SMS that is queued or sent already →
--   INVALID_TRANSITION (detail already_sent) unless resend.
-- ---------------------------------------------------------------------
create or replace function public.booking_queue_ready(p_booking_id uuid, p_checkin_id uuid, p_mobile text,
                                                      p_first text, p_rego text, p_resend boolean)
returns uuid
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_base  text := coalesce(p_checkin_id, p_booking_id)::text;
  v_keys  text[] := array_remove(array[p_checkin_id::text, p_booking_id::text], null);
  v_live  int;
  v_n     int;
  v_open  boolean;
  v_close time;
  v_id    uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('booking:ready:' || v_base, 0));

  select count(*) filter (where o.status not in ('cancelled', 'failed'))
    into v_live
    from public.sms_outbox o
   where o.template = 'ready' and split_part(o.dedupe_key, ':', 2) = any (v_keys);
  if v_live > 0 and not coalesce(p_resend, false) then
    raise exception 'INVALID_TRANSITION' using detail = 'already_sent';
  end if;
  select count(*) + 1 into v_n from public.sms_outbox o where o.dedupe_key like 'ready:' || v_base || ':%';

  select d.is_open, d.close_time into v_open, v_close
    from public.booking_day((now() at time zone 'Australia/Sydney')::date) d;

  insert into public.sms_outbox (booking_id, checkin_id, template, to_mobile, body, dedupe_key)
  values (p_booking_id, p_checkin_id, 'ready', p_mobile,
          format('Hi %s, your %s is ready for pickup at %s.',
                 coalesce(nullif(public.booking_sms_safe(p_first), ''), 'there'),
                 coalesce(nullif(public.booking_sms_safe(p_rego), ''), 'car'),
                 public.booking_sms_business_name())
          || case when v_open then format(' We''re open until %s.', public.booking_format_time(v_close)) else '' end,
          'ready:' || v_base || ':' || v_n)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- booking_send_ready_sms(id, resend) → {id}: the Send ready SMS button on a booking.
--   Booking arrived or completed (any ready_sms_mode). SMS off → VALIDATION sms_off.
-- ---------------------------------------------------------------------
create or replace function public.booking_send_ready_sms(p_id uuid, p_resend boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_b   public.bookings%rowtype;
  v_set public.booking_settings%rowtype;
begin
  select * into v_b from public.bookings b where b.id = p_id;
  if not found then raise exception 'NOT_FOUND' using detail = 'booking'; end if;
  if v_b.status not in ('arrived', 'completed') then
    raise exception 'INVALID_TRANSITION' using detail = v_b.status || '>ready';
  end if;
  select * into v_set from public.booking_settings where id = 1;
  if not coalesce(v_set.sms_enabled, true) then raise exception 'VALIDATION' using detail = 'sms_off'; end if;
  return jsonb_build_object('id',
    public.booking_queue_ready(v_b.id, v_b.checkin_id, v_b.mobile, v_b.first_name, v_b.rego, p_resend));
end $$;

-- ---------------------------------------------------------------------
-- booking_checkin_ready_sms(checkin_id, resend) → {id}: the button on every
-- check-in drawer. Linked to a booking → as booking_send_ready_sms. Walk-in →
-- the check-in's first name and phone; not an Australian mobile →
-- VALIDATION (detail not_mobile). Cancelled check-in → INVALID_TRANSITION.
-- ---------------------------------------------------------------------
create or replace function public.booking_checkin_ready_sms(p_checkin_id uuid, p_resend boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_c       public.checkins%rowtype;
  v_booking uuid;
  v_mobile  text;
  v_set     public.booking_settings%rowtype;
begin
  select * into v_c from public.checkins c where c.id = p_checkin_id;
  if not found then raise exception 'NOT_FOUND' using detail = 'checkin'; end if;
  if v_c.status = 'cancelled' then raise exception 'INVALID_TRANSITION' using detail = 'cancelled>ready'; end if;

  select b.id into v_booking from public.bookings b where b.checkin_id = p_checkin_id;
  if v_booking is not null then
    return public.booking_send_ready_sms(v_booking, p_resend);
  end if;

  v_mobile := public.booking_normalise_mobile(v_c.phone);
  if v_mobile is null then raise exception 'VALIDATION' using detail = 'not_mobile'; end if;
  select * into v_set from public.booking_settings where id = 1;
  if not coalesce(v_set.sms_enabled, true) then raise exception 'VALIDATION' using detail = 'sms_off'; end if;
  return jsonb_build_object('id',
    public.booking_queue_ready(null, v_c.id, v_mobile, v_c.first_name, v_c.rego, p_resend));
end $$;

-- ---------------------------------------------------------------------
-- Trigger: new kiosk check-in → today's (Sydney) 'booked' booking, same rego
-- first, else same mobile (both normalised); earliest made wins. That booking
-- becomes 'arrived' and linked. Never raises (warning only, no PII).
-- ---------------------------------------------------------------------
create or replace function public.booking_checkin_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id     uuid;
  v_today  date;
  v_rego   text;
  v_mobile text;
begin
  begin
    if public.booking_fault('checkin_link') then raise exception 'test fault'; end if;
    v_today  := (coalesce(new.created_at, now()) at time zone 'Australia/Sydney')::date;
    v_rego   := upper(regexp_replace(coalesce(new.rego, ''), '[^A-Za-z0-9]', '', 'g'));
    v_mobile := public.booking_normalise_mobile(new.phone);

    select b.id into v_id
      from public.bookings b
     where b.drop_off_date = v_today and b.status = 'booked' and b.checkin_id is null
       and ((v_rego <> '' and b.rego = v_rego) or (v_mobile is not null and b.mobile = v_mobile))
     order by (b.rego = v_rego) desc, b.created_at
     limit 1
       for update skip locked;

    if v_id is not null then
      update public.bookings set status = 'arrived', checkin_id = new.id where id = v_id;
      insert into public.booking_events (booking_id, at, actor, action, details)
      values (v_id, clock_timestamp(), 'system', 'linked_checkin', jsonb_build_object('checkin_id', new.id, 'via', 'kiosk')),
             (v_id, clock_timestamp() + interval '1 microsecond', 'system', 'arrived', jsonb_build_object('via', 'kiosk'));
    end if;
  exception when others then
    raise warning 'booking: check-in link skipped (%)', sqlstate;
  end;
  return null;
end $$;

drop trigger if exists checkins_link_booking on public.checkins;
create trigger checkins_link_booking
  after insert on public.checkins
  for each row execute function public.booking_checkin_link_trigger();

-- ---------------------------------------------------------------------
-- Trigger: check-in becomes 'completed' (usually via its job) → the linked
-- 'arrived' booking becomes 'completed'. Only in ready_sms_mode 'on_complete'
-- (off by default): queue one ready SMS, never a second automatically.
-- Never raises.
-- ---------------------------------------------------------------------
create or replace function public.booking_checkin_complete_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_b   public.bookings%rowtype;
  v_set public.booking_settings%rowtype;
begin
  if new.status is not distinct from old.status or new.status <> 'completed' then return null; end if;
  begin
    if public.booking_fault('checkin_complete') then raise exception 'test fault'; end if;
    select * into v_b from public.bookings b where b.checkin_id = new.id for update;
    if not found or v_b.status not in ('arrived', 'completed') then return null; end if;

    if v_b.status = 'arrived' then
      update public.bookings set status = 'completed' where id = v_b.id;
      insert into public.booking_events (booking_id, at, actor, action, details)
      values (v_b.id, clock_timestamp(), 'system', 'completed', jsonb_build_object('via', 'checkin'));
    end if;

    select * into v_set from public.booking_settings where id = 1;
    if coalesce(v_set.ready_sms_mode, 'manual') = 'on_complete' and coalesce(v_set.sms_enabled, true)
       and not exists (select 1 from public.sms_outbox o
                        where o.template = 'ready'
                          and split_part(o.dedupe_key, ':', 2) in (new.id::text, v_b.id::text)) then
      perform public.booking_queue_ready(v_b.id, new.id, v_b.mobile, v_b.first_name, v_b.rego, false);
    end if;
  exception when others then
    raise warning 'booking: check-in completion skipped (%)', sqlstate;
  end;
  return null;
end $$;

drop trigger if exists checkins_complete_booking on public.checkins;
create trigger checkins_complete_booking
  after update of status on public.checkins
  for each row execute function public.booking_checkin_complete_trigger();

revoke all on function public.booking_fault(text)                                          from public, anon, authenticated, service_role;
revoke all on function public.booking_format_time(time)                                    from public, anon, authenticated, service_role;
revoke all on function public.booking_queue_ready(uuid, uuid, text, text, text, boolean)   from public, anon, authenticated, service_role;
revoke all on function public.booking_send_ready_sms(uuid, boolean)                        from public, anon, authenticated, service_role;
revoke all on function public.booking_checkin_ready_sms(uuid, boolean)                     from public, anon, authenticated, service_role;
revoke all on function public.booking_checkin_link_trigger()                               from public, anon, authenticated, service_role;
revoke all on function public.booking_checkin_complete_trigger()                           from public, anon, authenticated, service_role;
grant execute on function public.booking_send_ready_sms(uuid, boolean)    to authenticated;
grant execute on function public.booking_checkin_ready_sms(uuid, boolean) to authenticated;

-- =====================================================================
-- T7: the customer's manage link /b/{token} (BUSINESS_RULES §9, API_SPEC §1)
-- booking_*_by_token: service_role only (the /api/booking/manage route
-- handlers and the /b page). The cores hold the cancel / reschedule steps
-- shared with the owner's functions; nobody can call them directly.
-- Customer rules: only 'booked', until cancel_cutoff_time (17:00) the day
-- before drop-off (Sydney time); a new day must pass the online rules.
-- A customer change sets is_read = false so the owner sees it as unread.
-- =====================================================================

-- Sydney wall-clock time the customer can change a booking until (internal).
create or replace function public.booking_change_until(d date)
returns timestamp language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select (d - 1) + coalesce((select s.cancel_cutoff_time from public.booking_settings s where s.id = 1), time '17:00');
$$;

create or replace function public.booking_can_change(p_status text, d date)
returns boolean language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select p_status = 'booked' and (now() at time zone 'Australia/Sydney') < public.booking_change_until(d);
$$;

-- Token → booking id, or NOT_FOUND (bad format, no match, or past drop-off + 7 days).
create or replace function public.booking_token_booking(p_token text)
returns uuid language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'NOT_FOUND' using detail = 'token';
  end if;
  select b.id into v_id from public.bookings b
   where b.manage_token_hash = extensions.digest(p_token, 'sha256')
     and b.drop_off_date + 7 >= (now() at time zone 'Australia/Sydney')::date;
  if v_id is null then raise exception 'NOT_FOUND' using detail = 'token'; end if;
  return v_id;
end $$;

-- What the manage page shows (SECURITY: no surname, mobile, email or notes).
create or replace function public.booking_manage_view(p_id uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'reference_no', b.reference_no,
    'first_name',   b.first_name,
    'rego',         b.rego,
    'make',         b.make,
    'model',        b.model,
    'services',     coalesce((select jsonb_agg(i.name_snapshot order by i.name_snapshot)
                                from public.booking_items i where i.booking_id = b.id), '[]'::jsonb),
    'date',         b.drop_off_date,
    'window_start', left(b.window_start::text, 5),
    'window_end',   left(b.window_end::text, 5),
    'status',       b.status,
    'can_change',   public.booking_can_change(b.status, b.drop_off_date),
    'change_until', to_char(public.booking_change_until(b.drop_off_date), 'YYYY-MM-DD"T"HH24:MI'),
    'phone',        (select nullif(btrim(g.phone), '') from public.settings g where g.id = 1))
  from public.bookings b where b.id = p_id;
$$;

-- ---------------------------------------------------------------------
-- booking_cancel_core(id, actor, notify) → {id, status}. Only 'booked'.
-- ---------------------------------------------------------------------
create or replace function public.booking_cancel_core(p_id uuid, p_actor text, p_notify boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_b   public.bookings%rowtype;
  v_set public.booking_settings%rowtype;
  v_n   int;
begin
  select * into v_b from public.bookings b where b.id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'booking'; end if;
  if v_b.status <> 'booked' then
    raise exception 'INVALID_TRANSITION' using detail = v_b.status || '>cancelled';
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(),
         is_read = case when p_actor = 'customer' then false else is_read end
   where id = p_id;
  insert into public.booking_events (booking_id, at, actor, action, details)
  values (p_id, clock_timestamp(), p_actor, 'cancelled', jsonb_build_object('notify', p_notify));

  select * into v_set from public.booking_settings where id = 1;
  if p_notify and coalesce(v_set.sms_enabled, true) then
    begin
      select count(*) into v_n from public.booking_events e where e.booking_id = p_id and e.action = 'cancelled';
      insert into public.sms_outbox (booking_id, template, to_mobile, body, dedupe_key)
      values (p_id, 'cancelled', v_b.mobile,
              format('Your booking for %s at %s is cancelled. To rebook: {booking_page}',
                     public.booking_format_day(v_b.drop_off_date), public.booking_sms_business_name()),
              p_id::text || ':cancelled:' || v_n)
      on conflict (dedupe_key) do nothing;
    exception when others then
      insert into public.booking_events (booking_id, at, actor, action, details)
      values (p_id, clock_timestamp(), 'system', 'sms_retry', jsonb_build_object('error', 'cancellation not queued', 'sqlstate', sqlstate));
    end;
  end if;

  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- ---------------------------------------------------------------------
-- booking_reschedule_core(id, date, window_id, online, allow_over, notify, actor)
--   → {id, status, date}. Only 'booked'. Locks: mobile, then the new date.
--   online (customer): the booking's own cutoff (CUTOFF_PASSED, detail
--   'booking'), the online day rules for the new date (same day / cutoff →
--   CUTOFF_PASSED detail 'date', horizon → OUTSIDE_HORIZON, booking off →
--   BOOKING_OFF, closed → CLOSED), no overbooking, and the same day + window
--   → INVALID_TRANSITION 'unchanged'.
--   owner: closed / past days → CLOSED (detail = reason); full → FULL unless allow_over.
-- ---------------------------------------------------------------------
create or replace function public.booking_reschedule_core(p_id uuid, p_date date, p_window_id uuid, p_online boolean,
                                                          p_allow_over boolean, p_notify boolean, p_actor text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_b        public.bookings%rowtype;
  v_window   public.booking_windows%rowtype;
  v_set      public.booking_settings%rowtype;
  v_status   text;
  v_reason   text;
  v_capacity int;
  v_booked   int;
  v_over     boolean := false;
  v_token    text;
  v_n        int;
begin
  if p_date is null then raise exception 'VALIDATION' using detail = 'date'; end if;
  select * into v_window from public.booking_windows w where w.id = p_window_id and w.active;
  if not found then raise exception 'VALIDATION' using detail = 'window_id'; end if;

  select * into v_b from public.bookings b where b.id = p_id;
  if not found then raise exception 'NOT_FOUND' using detail = 'booking'; end if;

  perform pg_advisory_xact_lock(hashtextextended('booking:mobile:' || v_b.mobile, 0));
  perform pg_advisory_xact_lock(hashtextextended('booking:date:' || p_date::text, 0));
  select * into v_b from public.bookings b where b.id = p_id for update;
  if v_b.status <> 'booked' then
    raise exception 'INVALID_TRANSITION' using detail = v_b.status || '>rescheduled';
  end if;
  if p_online then
    if not public.booking_can_change(v_b.status, v_b.drop_off_date) then
      raise exception 'CUTOFF_PASSED' using detail = 'booking';
    end if;
    if p_date = v_b.drop_off_date and v_window.id = v_b.window_id then
      raise exception 'INVALID_TRANSITION' using detail = 'unchanged';
    end if;
  end if;

  select a.status, a.reason, a.capacity, a.booked into v_status, v_reason, v_capacity, v_booked
    from public.booking_availability_at(p_date, p_date, p_online, now()) a;
  if v_status = 'closed' then
    if p_online and v_reason in ('same_day', 'cutoff') then raise exception 'CUTOFF_PASSED' using detail = 'date'; end if;
    if p_online and v_reason = 'horizon' then raise exception 'OUTSIDE_HORIZON'; end if;
    if p_online and v_reason = 'booking_off' then raise exception 'BOOKING_OFF'; end if;
    raise exception 'CLOSED' using detail = v_reason;
  end if;
  -- Moving within the same day doesn't take another spot
  if p_date <> v_b.drop_off_date and v_status = 'full' then
    if p_allow_over and not p_online then v_over := true; else raise exception 'FULL'; end if;
  end if;

  if exists (select 1 from public.bookings b
              where b.rego = v_b.rego and b.drop_off_date = p_date and b.id <> p_id
                and b.status in ('booked', 'arrived', 'completed')) then
    raise exception 'DUPLICATE_BOOKING' using detail = p_date::text;
  end if;

  begin
    update public.bookings
       set drop_off_date = p_date, window_id = v_window.id,
           window_start = v_window.start_time, window_end = v_window.end_time,
           over_capacity = case when p_date = v_b.drop_off_date then over_capacity else v_over end,
           is_read = case when p_actor = 'customer' then false else is_read end
     where id = p_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_BOOKING' using detail = p_date::text;
  end;

  update public.booking_tokens set expires_on = p_date + 7 where booking_id = p_id;
  if not found then
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    insert into public.booking_tokens (booking_id, token, expires_on) values (p_id, v_token, p_date + 7);
    update public.bookings set manage_token_hash = extensions.digest(v_token, 'sha256') where id = p_id;
  end if;

  update public.sms_outbox o
     set status = 'cancelled', last_error = 'Booking was rescheduled'
   where o.booking_id = p_id and o.status = 'pending' and o.template in ('confirmation', 'reminder', 'rescheduled');

  insert into public.booking_events (booking_id, at, actor, action, details)
  values (p_id, clock_timestamp(), p_actor, 'rescheduled',
          jsonb_build_object('from', v_b.drop_off_date, 'to', p_date, 'notify', p_notify));
  if v_over then
    insert into public.booking_events (booking_id, at, actor, action, details)
    values (p_id, clock_timestamp(), p_actor, 'overbooked', jsonb_build_object('capacity', v_capacity, 'booked_before', v_booked));
  end if;

  select * into v_set from public.booking_settings where id = 1;
  if p_notify and coalesce(v_set.sms_enabled, true) then
    begin
      select count(*) into v_n from public.booking_events e where e.booking_id = p_id and e.action = 'rescheduled';
      insert into public.sms_outbox (booking_id, template, to_mobile, body, dedupe_key)
      values (p_id, 'rescheduled', v_b.mobile,
              format('Your booking at %s is now %s, drop off %s. Manage: {manage_link}',
                     public.booking_sms_business_name(), public.booking_format_day(p_date),
                     public.booking_format_window(v_window.start_time, v_window.end_time)),
              p_id::text || ':rescheduled:' || v_n)
      on conflict (dedupe_key) do nothing;
    exception when others then
      insert into public.booking_events (booking_id, at, actor, action, details)
      values (p_id, clock_timestamp(), 'system', 'sms_retry', jsonb_build_object('error', 'rescheduled not queued', 'sqlstate', sqlstate));
    end;
  end if;

  return jsonb_build_object('id', p_id, 'status', 'booked', 'date', p_date);
end $$;

-- ---------------------------------------------------------------------
-- The customer's three calls (service_role). Each returns the manage view.
-- ---------------------------------------------------------------------
create or replace function public.booking_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select public.booking_manage_view(public.booking_token_booking(p_token));
$$;

create or replace function public.booking_cancel_by_token(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid := public.booking_token_booking(p_token);
  v_b  public.bookings%rowtype;
begin
  select * into v_b from public.bookings b where b.id = v_id for update;
  if v_b.status <> 'booked' then
    raise exception 'INVALID_TRANSITION' using detail = v_b.status || '>cancelled';
  end if;
  if not public.booking_can_change(v_b.status, v_b.drop_off_date) then
    raise exception 'CUTOFF_PASSED' using detail = 'booking';
  end if;
  perform public.booking_cancel_core(v_id, 'customer', true);
  return public.booking_manage_view(v_id);
end $$;

create or replace function public.booking_reschedule_by_token(p_token text, p_date date, p_window_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid := public.booking_token_booking(p_token);
begin
  perform public.booking_reschedule_core(v_id, p_date, p_window_id, true, false, true, 'customer');
  return public.booking_manage_view(v_id);
end $$;

revoke all on function public.booking_change_until(date)                                         from public, anon, authenticated, service_role;
revoke all on function public.booking_can_change(text, date)                                     from public, anon, authenticated, service_role;
revoke all on function public.booking_token_booking(text)                                        from public, anon, authenticated, service_role;
revoke all on function public.booking_manage_view(uuid)                                          from public, anon, authenticated, service_role;
revoke all on function public.booking_cancel_core(uuid, text, boolean)                           from public, anon, authenticated, service_role;
revoke all on function public.booking_reschedule_core(uuid, date, uuid, boolean, boolean, boolean, text)
                                                                                                 from public, anon, authenticated, service_role;
revoke all on function public.booking_by_token(text)                                             from public, anon, authenticated, service_role;
revoke all on function public.booking_cancel_by_token(text)                                      from public, anon, authenticated, service_role;
revoke all on function public.booking_reschedule_by_token(text, date, uuid)                      from public, anon, authenticated, service_role;
grant execute on function public.booking_by_token(text)                        to service_role;
grant execute on function public.booking_cancel_by_token(text)                 to service_role;
grant execute on function public.booking_reschedule_by_token(text, date, uuid) to service_role;

-- =====================================================================
-- T8: Online Booking settings (BUSINESS_RULES §1, API_SPEC §2)
-- The owner already edits settings, services, hours, windows and overrides
-- through RLS + column grants (above). T8 adds:
--   * an open day must have a capacity (else it would just show "full"):
--     open weekdays need capacity ≥ 1; an open override states its own
--   * booking_on_date(date): the active bookings on a day, so the Settings
--     tab can list them before the owner closes that day
-- =====================================================================
do $$ begin
  alter table public.booking_weekly_hours drop constraint if exists booking_weekly_hours_open_capacity_check;
  alter table public.booking_weekly_hours add constraint booking_weekly_hours_open_capacity_check
    check (not is_open or coalesce(capacity_cars, 0) >= 1);  -- null would pass a plain check
  alter table public.booking_date_overrides drop constraint if exists booking_date_overrides_open_capacity_check;
  alter table public.booking_date_overrides add constraint booking_date_overrides_open_capacity_check
    check (not is_open or coalesce(capacity_cars, 0) >= 1);  -- null would pass a plain check
end $$;

-- SECURITY INVOKER: RLS applies (the owner reads all bookings anyway).
create or replace function public.booking_on_date(p_date date)
returns table (id uuid, reference_no text, first_name text, last_name text, rego text, status text, window_start time)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select b.id, b.reference_no, b.first_name, b.last_name, b.rego, b.status, b.window_start
    from public.bookings b
   where b.drop_off_date = p_date and b.status in ('booked', 'arrived', 'completed')
   order by b.window_start, b.created_at;
$$;

revoke all on function public.booking_on_date(date) from public, anon, authenticated, service_role;
grant execute on function public.booking_on_date(date) to authenticated;
