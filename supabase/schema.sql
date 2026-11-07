-- =====================================================================
-- Sai Motor Works – Digital Customer Check-in
-- Run this whole file in Supabase → SQL Editor. Safe to re-run: it also
-- upgrades a database created from an earlier version of this file.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Status enum
-- ---------------------------------------------------------------------
do $$ begin
  create type public.checkin_status as enum ('new', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Reference numbers: SMW-1001, SMW-1002, …
-- ---------------------------------------------------------------------
create sequence if not exists public.checkin_ref_seq start with 1001;

-- ---------------------------------------------------------------------
-- checkins
-- ---------------------------------------------------------------------
create table if not exists public.checkins (
  id                 uuid primary key default gen_random_uuid(),
  reference_no       text not null unique default ('SMW-' || nextval('public.checkin_ref_seq')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  status             public.checkin_status not null default 'new',

  first_name         text not null check (char_length(first_name) between 1 and 80),
  last_name          text not null check (char_length(last_name) between 1 and 80),
  phone              text not null check (char_length(phone) between 8 and 20),
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  make               text not null check (char_length(make) between 1 and 60),
  model              text not null check (char_length(model) between 1 and 80),
  year               int  check (year between 1950 and 2100),
  rego               text not null check (char_length(rego) between 1 and 7),
  colour             text,
  odometer_km        int  check (odometer_km >= 0 and odometer_km < 2000000),

  signature_path     text,
  signed_at          timestamptz,
  internal_notes     text default '',
  is_read            boolean not null default false,
  is_archived        boolean not null default false,
  returning_customer boolean not null default false
);

-- Upgrades for databases created by the first version of this file
alter table public.checkins alter column email drop not null;
alter table public.checkins add column if not exists is_read            boolean not null default false;
alter table public.checkins add column if not exists is_archived        boolean not null default false;
alter table public.checkins add column if not exists returning_customer boolean not null default false;
do $$ begin
  alter table public.checkins drop constraint if exists checkins_email_check;
  alter table public.checkins add constraint checkins_email_check
    check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
end $$;

create index if not exists checkins_created_at_idx on public.checkins (created_at desc);
create index if not exists checkins_status_idx     on public.checkins (status);
create index if not exists checkins_rego_idx       on public.checkins (rego);
create index if not exists checkins_phone_idx      on public.checkins (phone);

-- updated_at trigger (shared by checkins and settings)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists checkins_set_updated_at on public.checkins;
create trigger checkins_set_updated_at
  before update on public.checkins
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- settings (single row, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                      int primary key default 1 check (id = 1),
  business_name           text default 'Sai Motor Works',
  owner_name              text,
  abn                     text,
  phone                   text,
  email                   text,
  address                 text default 'Rutherford NSW',
  opening_hours           text,
  logo_path               text,
  pin_hash                text,
  auto_lock_minutes       int  not null default 15 check (auto_lock_minutes in (0, 5, 15, 30)),  -- 0 = never
  kiosk_enabled           boolean not null default true,
  kiosk_paused_message    text default 'Check-in is currently unavailable – please see the front counter.',
  kiosk_title             text default 'Vehicle Check-in Form',
  kiosk_subtitle          text default 'Please provide your contact details and vehicle information.',
  consent_text            text default 'By submitting this form, you confirm that the details provided are accurate and authorise Sai Motor Works to carry out an inspection of your vehicle.',
  show_year               boolean not null default true,
  show_colour             boolean not null default true,
  show_odometer           boolean not null default true,
  email_required          boolean not null default true,
  quick_makes             text[] not null default '{Toyota,Ford,Mazda,Hyundai,Holden,Volkswagen,Subaru,Kia,Nissan,BMW}',
  thank_you_reset_seconds int  not null default 8 check (thank_you_reset_seconds between 3 and 120),
  idle_timeout_minutes    int  not null default 3 check (idle_timeout_minutes between 1 and 60),
  sound_enabled           boolean not null default true,
  chime                   text not null default 'chime-1',
  browser_notifications   boolean not null default false,
  email_alerts            boolean not null default false,
  archive_after_months    int check (archive_after_months is null or archive_after_months between 1 and 120), -- null = never
  updated_at              timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Signatures are no longer collected: update the default wording unless the owner customised it
alter table public.settings alter column kiosk_subtitle set default
  'Please provide your contact details and vehicle information.';
update public.settings
   set kiosk_subtitle = 'Please provide your contact details and vehicle information.'
 where id = 1
   and kiosk_subtitle = 'Please provide your contact details and vehicle information, then sign below.';
alter table public.settings alter column consent_text set default
  'By submitting this form, you confirm that the details provided are accurate and authorise Sai Motor Works to carry out an inspection of your vehicle.';
update public.settings
   set consent_text = 'By submitting this form, you confirm that the details provided are accurate and authorise Sai Motor Works to carry out an inspection of your vehicle.'
 where id = 1
   and consent_text = 'By signing, you confirm that the details provided are accurate and authorise Sai Motor Works to carry out an inspection of your vehicle.';

-- Staff job sheet (/jobs): employee names for the dropdown + one shared staff PIN (bcrypt)
alter table public.settings add column if not exists staff_names    text[] not null default '{}';
alter table public.settings add column if not exists staff_pin_hash text;

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- settings_signal: a one-row table the kiosk (anon) can watch over
-- Realtime. It carries no data – only "settings changed at <time>" – so
-- the kiosk knows to re-read the kiosk_settings view without a reload.
-- ---------------------------------------------------------------------
create table if not exists public.settings_signal (
  id         int primary key default 1 check (id = 1),
  changed_at timestamptz not null default now()
);
insert into public.settings_signal (id) values (1) on conflict (id) do nothing;

create or replace function public.bump_settings_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.settings_signal set changed_at = now() where id = 1;
  return null;
end $$;

drop trigger if exists settings_bump_signal on public.settings;
create trigger settings_bump_signal
  after update on public.settings
  for each statement execute function public.bump_settings_signal();

-- ---------------------------------------------------------------------
-- kiosk_settings view: only what the public kiosk needs.
-- Never exposes pin_hash, contact details or ABN.
-- (Runs with the view owner's rights so anon can read it without having
-- any access to the settings table itself.)
-- ---------------------------------------------------------------------
drop view if exists public.kiosk_settings;
create view public.kiosk_settings as
  select business_name, logo_path,
         kiosk_enabled, kiosk_paused_message, kiosk_title, kiosk_subtitle, consent_text,
         show_year, show_colour, show_odometer, email_required, quick_makes,
         thank_you_reset_seconds, idle_timeout_minutes,
         (pin_hash is not null) as pin_set,
         (staff_pin_hash is not null) as staff_pin_set,
         updated_at
  from public.settings
  where id = 1;

-- ---------------------------------------------------------------------
-- PIN: bcrypt hash only. Verified in the database with pgcrypto crypt().
-- 5 failed attempts → 5-minute lockout.
-- ---------------------------------------------------------------------
create table if not exists public.pin_guard (
  id              int primary key default 1 check (id = 1),
  failed_attempts int not null default 0,
  locked_until    timestamptz
);
insert into public.pin_guard (id) values (1) on conflict (id) do nothing;

create or replace function public.verify_pin(pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_guard public.pin_guard%rowtype;
  v_ok    boolean;
  v_fails int;
begin
  select * into v_guard from public.pin_guard where id = 1 for update;
  if v_guard.locked_until is not null and v_guard.locked_until > now() then
    raise exception 'Too many incorrect PIN attempts. Try again in % min.',
      ceil(extract(epoch from v_guard.locked_until - now()) / 60)::int
      using errcode = 'P0001';
  end if;

  select pin_hash into v_hash from public.settings where id = 1;
  v_ok := v_hash is not null and pin ~ '^\d{4,6}$' and crypt(pin, v_hash) = v_hash;

  if v_ok then
    update public.pin_guard set failed_attempts = 0, locked_until = null where id = 1;
  else
    v_fails := v_guard.failed_attempts + 1;
    if v_fails >= 5 then
      update public.pin_guard set failed_attempts = 0, locked_until = now() + interval '5 minutes' where id = 1;
    else
      update public.pin_guard set failed_attempts = v_fails, locked_until = null where id = 1;
    end if;
  end if;
  return v_ok;
end $$;

-- The dashboard hashes the new PIN with bcrypt in the browser and sends
-- only the hash. Owner-only.
create or replace function public.set_pin_hash(new_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_hash !~ '^\$2[abxy]\$\d\d\$[./A-Za-z0-9]{53}$' then
    raise exception 'Invalid PIN hash';
  end if;
  update public.settings set pin_hash = new_hash where id = 1;
  update public.pin_guard set failed_attempts = 0, locked_until = null where id = 1;
end $$;

-- ---------------------------------------------------------------------
-- Kiosk submit function.
-- Inserts one row and returns ONLY the new reference number, so the kiosk
-- can show "SMW-1042" without being able to read the table.
-- ---------------------------------------------------------------------
drop function if exists public.kiosk_submit_checkin(uuid, text, text, text, text, text, text, int, text, text, int, text, timestamptz);
create or replace function public.kiosk_submit_checkin(
  p_id uuid,
  p_first_name text, p_last_name text, p_phone text, p_email text,
  p_make text, p_model text, p_year int, p_rego text, p_colour text,
  p_odometer_km int, p_signature_path text, p_signed_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref       text;
  v_settings  public.settings%rowtype;
  v_phone     text := trim(p_phone);
  v_rego      text := upper(regexp_replace(coalesce(p_rego, ''), '[^A-Za-z0-9]', '', 'g'));
  v_email     text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_returning boolean;
begin
  select * into v_settings from public.settings where id = 1;
  if not coalesce(v_settings.kiosk_enabled, true) then
    raise exception 'Check-in is currently paused';
  end if;
  -- (Signatures are no longer collected; p_signature_path is kept so older kiosks keep working)
  if coalesce(v_settings.email_required, true) and v_email is null then
    raise exception 'Email address is required';
  end if;

  select exists (
    select 1 from public.checkins
    where rego = v_rego
       or regexp_replace(phone, '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')
  ) into v_returning;

  insert into public.checkins (
    id, first_name, last_name, phone, email,
    make, model, year, rego, colour, odometer_km,
    signature_path, signed_at, status, returning_customer
  ) values (
    coalesce(p_id, gen_random_uuid()),
    trim(p_first_name), trim(p_last_name), v_phone, v_email,
    trim(p_make), trim(p_model),
    case when v_settings.show_year then p_year end,
    v_rego,
    case when v_settings.show_colour then nullif(trim(coalesce(p_colour, '')), '') end,
    case when v_settings.show_odometer then p_odometer_km end,
    nullif(p_signature_path, ''), coalesce(p_signed_at, now()), 'new', v_returning
  )
  returning reference_no into v_ref;

  return v_ref;
end $$;

-- ---------------------------------------------------------------------
-- Auto-archive completed jobs older than settings.archive_after_months.
-- Called by the dashboard on load (and optionally by pg_cron, see README).
-- ---------------------------------------------------------------------
create or replace function public.archive_completed_checkins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_months int;
  v_count  int;
begin
  select archive_after_months into v_months from public.settings where id = 1;
  if v_months is null then return 0; end if;
  update public.checkins
     set is_archived = true
   where status = 'completed'
     and not is_archived
     and updated_at < now() - make_interval(months => v_months);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security & grants
--   checkins : anon INSERT only (via kiosk_submit_checkin);
--              authenticated SELECT, UPDATE, DELETE
--   settings : authenticated SELECT + UPDATE (pin_hash is never readable)
--   anon reads only the kiosk_settings view and settings_signal
-- ---------------------------------------------------------------------
alter table public.checkins        enable row level security;
alter table public.settings        enable row level security;
alter table public.settings_signal enable row level security;
alter table public.pin_guard       enable row level security;

drop policy if exists "kiosk can insert"   on public.checkins;
drop policy if exists "staff can read"     on public.checkins;
drop policy if exists "staff can update"   on public.checkins;
drop policy if exists "staff can delete"   on public.checkins;

create policy "kiosk can insert" on public.checkins
  for insert to anon
  with check (status = 'new' and coalesce(internal_notes, '') = '');
create policy "staff can read" on public.checkins
  for select to authenticated using (true);
create policy "staff can update" on public.checkins
  for update to authenticated using (true) with check (true);
create policy "staff can delete" on public.checkins
  for delete to authenticated using (true);

revoke all on public.checkins from anon, authenticated;
grant insert (id, first_name, last_name, phone, email, make, model, year, rego,
              colour, odometer_km, signature_path, signed_at)
  on public.checkins to anon;
grant select, update, delete on public.checkins to authenticated;
revoke all on sequence public.checkin_ref_seq from anon, authenticated;
grant usage on sequence public.checkin_ref_seq to anon;

drop policy if exists "owner reads settings"   on public.settings;
drop policy if exists "owner updates settings" on public.settings;
create policy "owner reads settings" on public.settings
  for select to authenticated using (id = 1);
create policy "owner updates settings" on public.settings
  for update to authenticated using (id = 1) with check (id = 1);

revoke all on public.settings from anon, authenticated;
grant select (id, business_name, owner_name, abn, phone, email, address, opening_hours, logo_path,
              auto_lock_minutes, kiosk_enabled, kiosk_paused_message, kiosk_title, kiosk_subtitle,
              consent_text, show_year, show_colour, show_odometer, email_required, quick_makes,
              thank_you_reset_seconds, idle_timeout_minutes, sound_enabled, chime,
              browser_notifications, email_alerts, archive_after_months, staff_names, updated_at)
  on public.settings to authenticated;
grant update (business_name, owner_name, abn, phone, email, address, opening_hours, logo_path,
              auto_lock_minutes, kiosk_enabled, kiosk_paused_message, kiosk_title, kiosk_subtitle,
              consent_text, show_year, show_colour, show_odometer, email_required, quick_makes,
              thank_you_reset_seconds, idle_timeout_minutes, sound_enabled, chime,
              browser_notifications, email_alerts, archive_after_months, staff_names)
  on public.settings to authenticated;

drop policy if exists "anyone reads settings signal" on public.settings_signal;
create policy "anyone reads settings signal" on public.settings_signal
  for select to anon, authenticated using (true);
revoke all on public.settings_signal from anon, authenticated;
grant select on public.settings_signal to anon, authenticated;

revoke all on public.pin_guard from anon, authenticated;

revoke all on public.kiosk_settings from anon, authenticated;
grant select on public.kiosk_settings to anon, authenticated;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default,
-- so revoke from them explicitly, then grant back only what each role needs.
revoke all on function public.verify_pin(text)                from public, anon, authenticated;
revoke all on function public.set_pin_hash(text)              from public, anon, authenticated;
revoke all on function public.kiosk_submit_checkin(uuid, text, text, text, text, text, text, int, text, text, int, text, timestamptz) from public, anon, authenticated;
revoke all on function public.archive_completed_checkins()    from public, anon, authenticated;
revoke all on function public.bump_settings_signal()          from public, anon, authenticated;
grant execute on function public.verify_pin(text)             to anon, authenticated;
grant execute on function public.set_pin_hash(text)           to authenticated;
grant execute on function public.kiosk_submit_checkin(uuid, text, text, text, text, text, text, int, text, text, int, text, timestamptz) to anon, authenticated;
grant execute on function public.archive_completed_checkins() to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
--   checkins        : INSERT/UPDATE to the signed-in owner (RLS applies)
--   settings        : owner dashboards on other devices
--   settings_signal : the kiosk
-- ---------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.checkins;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.settings_signal;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Storage
--   signatures : private. Holds signatures from before they were dropped
--                from the kiosk; owner reads (signed URLs) and deletes
--                (privacy requests). Nobody can upload any more.
--   branding   : public read (logo); owner uploads/replaces/deletes.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 524288, array['image/png'])
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/svg+xml'];

drop policy if exists "kiosk uploads signatures" on storage.objects;
drop policy if exists "staff read signatures"    on storage.objects;
drop policy if exists "staff delete signatures"  on storage.objects;
drop policy if exists "owner reads branding"     on storage.objects;
drop policy if exists "owner uploads branding"   on storage.objects;
drop policy if exists "owner updates branding"   on storage.objects;
drop policy if exists "owner deletes branding"   on storage.objects;

create policy "staff read signatures" on storage.objects
  for select to authenticated using (bucket_id = 'signatures');
create policy "staff delete signatures" on storage.objects
  for delete to authenticated using (bucket_id = 'signatures');

-- (Public URLs work without a policy; this lets the owner replace/list files.)
create policy "owner reads branding" on storage.objects
  for select to authenticated using (bucket_id = 'branding');
create policy "owner uploads branding" on storage.objects
  for insert to authenticated with check (bucket_id = 'branding');
create policy "owner updates branding" on storage.objects
  for update to authenticated using (bucket_id = 'branding');
create policy "owner deletes branding" on storage.objects
  for delete to authenticated using (bucket_id = 'branding');

-- =====================================================================
-- JOBS – the workshop job sheet
--   Staff (no login) fill it in on /jobs after entering the shared staff
--   PIN; the owner sees and completes jobs on the dashboard.
--   Staff never get table access: they go through staff_* functions that
--   check the PIN every time. Prices, times and invoice details are
--   owner-only columns.
-- =====================================================================
create sequence if not exists public.job_ref_seq start with 1001;

create table if not exists public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  job_no             text not null unique default ('JOB-' || nextval('public.job_ref_seq')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  status             public.checkin_status not null default 'new',
  employee_name      text not null check (char_length(employee_name) between 1 and 80),

  -- Job details
  customer_name      text check (customer_name is null or char_length(customer_name) between 1 and 120),
  phone              text check (phone is null or char_length(phone) <= 20),
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address            text check (address is null or char_length(address) <= 200),

  -- Vehicle details
  rego               text not null check (char_length(rego) between 1 and 9),
  make               text not null check (char_length(make) between 1 and 60),
  model              text check (model is null or char_length(model) <= 80),
  vehicle_type       text check (vehicle_type is null or char_length(vehicle_type) <= 60),
  vin                text check (vin is null or char_length(vin) <= 17),
  year               int  check (year between 1950 and 2100),
  colour             text check (colour is null or char_length(colour) <= 40),
  odometer           text check (odometer is null or char_length(odometer) <= 20),   -- KMs
  hours              text check (hours is null or char_length(hours) <= 20),         -- hours the job took: "0.5", "1", "1.5"…

  -- Work
  work_items         text[] not null default '{}',                                  -- "Work carried out" lines
  faults             text,                                                           -- additional faults found
  parts              jsonb not null default '[]'::jsonb
                     check (jsonb_typeof(parts) = 'array'),                          -- [{description, qty, price}]

  -- Owner only
  time_in            timestamptz,
  time_out           timestamptz,
  labour_total       numeric(10, 2) check (labour_total is null or labour_total >= 0),
  po_number          text,
  tax_invoice_number text,
  invoice_sent_on    date,
  owner_notes        text,
  is_read            boolean not null default false
);

-- Upgrades: staff no longer enter customer details (they come from the linked
-- check-in), and hours have their own field
alter table public.jobs alter column customer_name drop not null;
alter table public.jobs add column if not exists hours text check (hours is null or char_length(hours) <= 20);

create index if not exists jobs_created_at_idx on public.jobs (created_at desc);
create index if not exists jobs_status_idx     on public.jobs (status);
create index if not exists jobs_rego_idx       on public.jobs (rego);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Staff PIN lockout (separate from the owner PIN): 5 wrong → 5 minutes
create table if not exists public.staff_pin_guard (
  id              int primary key default 1 check (id = 1),
  failed_attempts int not null default 0,
  locked_until    timestamptz
);
insert into public.staff_pin_guard (id) values (1) on conflict (id) do nothing;

-- true = correct PIN, false = wrong (counted). Raises only for lockout / not set up.
-- Callers must not raise after a false result, or the failed-attempt count would
-- be rolled back and the lockout could be bypassed.
drop function if exists public.check_staff_pin(text);
create or replace function public.check_staff_pin(pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_guard public.staff_pin_guard%rowtype;
  v_fails int;
begin
  select * into v_guard from public.staff_pin_guard where id = 1 for update;
  if v_guard.locked_until is not null and v_guard.locked_until > now() then
    raise exception 'Too many incorrect PIN attempts. Try again in % min.',
      ceil(extract(epoch from v_guard.locked_until - now()) / 60)::int;
  end if;

  select staff_pin_hash into v_hash from public.settings where id = 1;
  if v_hash is null then
    raise exception 'The staff PIN has not been set up yet. Ask the owner (Settings → Staff).';
  end if;

  if pin ~ '^\d{4,6}$' and crypt(pin, v_hash) = v_hash then
    update public.staff_pin_guard set failed_attempts = 0, locked_until = null where id = 1;
    return true;
  end if;

  v_fails := v_guard.failed_attempts + 1;
  if v_fails >= 5 then
    update public.staff_pin_guard set failed_attempts = 0, locked_until = now() + interval '5 minutes' where id = 1;
  else
    update public.staff_pin_guard set failed_attempts = v_fails where id = 1;
  end if;
  return false;
end $$;

-- The staff page unlocks with this: checks the PIN and returns the employee names.
create or replace function public.staff_unlock(pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_names text[];
begin
  if not public.check_staff_pin(pin) then
    return jsonb_build_object('ok', false, 'error', 'Incorrect PIN');
  end if;
  select staff_names into v_names from public.settings where id = 1;
  return jsonb_build_object('ok', true, 'staff_names', to_jsonb(coalesce(v_names, '{}')));
end $$;

-- Staff submit a job. The PIN is re-checked; owner-only fields are ignored.
-- Returns the job number, or null when the PIN is wrong.
create or replace function public.staff_submit_job(pin text, job jsonb)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ref   text;
  v_names text[];
  v_name  text := trim(job->>'employee_name');
  v_parts jsonb;
  v_checkin uuid;
begin
  if not public.check_staff_pin(pin) then
    return null;
  end if;

  select staff_names into v_names from public.settings where id = 1;
  if v_name is null or not (v_name = any (v_names)) then
    raise exception 'Please choose your name from the list.';
  end if;
  if coalesce(trim(job->>'model'), '') = '' then
    raise exception 'Please enter the vehicle model.';
  end if;
  if coalesce(trim(job->>'odometer'), '') = '' then
    raise exception 'Please enter the KMs.';
  end if;

  -- Job started from an assigned car: it must be assigned to this mechanic
  if coalesce(job->>'checkin_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select id into v_checkin from public.checkins
     where id = (job->>'checkin_id')::uuid and assigned_to = v_name;
    if v_checkin is null then
      raise exception 'This car isn''t assigned to you any more – please refresh your list.';
    end if;
  end if;

  -- Keep only description + qty from each part; prices are owner-only
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', left(trim(p->>'description'), 120),
           'qty', greatest(0, least(9999, coalesce(nullif(p->>'qty', '')::numeric, 1))))), '[]'::jsonb)
    into v_parts
    from jsonb_array_elements(coalesce(job->'parts', '[]'::jsonb)) p
   where coalesce(trim(p->>'description'), '') <> '';

  insert into public.jobs (
    employee_name, customer_name, phone, email, address,
    rego, make, model, vehicle_type, vin, year, colour, odometer, hours,
    work_items, faults, parts, checkin_id
  ) values (
    v_name,
    nullif(trim(job->>'customer_name'), ''),
    nullif(trim(job->>'phone'), ''),
    nullif(lower(trim(job->>'email')), ''),
    nullif(trim(job->>'address'), ''),
    upper(regexp_replace(coalesce(job->>'rego', ''), '[^A-Za-z0-9]', '', 'g')),
    trim(job->>'make'),
    nullif(trim(job->>'model'), ''),
    nullif(trim(job->>'vehicle_type'), ''),
    nullif(upper(trim(job->>'vin')), ''),
    nullif(job->>'year', '')::int,
    nullif(trim(job->>'colour'), ''),
    nullif(trim(job->>'odometer'), ''),
    -- Hours taken: half-hour steps from 0.5 to 12, anything else is dropped
    -- (nested so the number check only runs on values that passed the format check)
    case when trim(job->>'hours') ~ '^\d{1,2}(\.5)?$' then
      case when (trim(job->>'hours'))::numeric between 0.5 and 12 then trim(job->>'hours') end
    end,
    coalesce(array(select left(trim(x), 200) from jsonb_array_elements_text(coalesce(job->'work_items', '[]'::jsonb)) x
                   where trim(x) <> ''), '{}'),
    nullif(trim(job->>'faults'), ''),
    v_parts,
    v_checkin   -- null → linked automatically by rego
  )
  returning job_no into v_ref;
  return v_ref;
end $$;

-- Owner sets the staff PIN (bcrypt hash made in the browser)
create or replace function public.set_staff_pin_hash(new_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_hash !~ '^\$2[abxy]\$\d\d\$[./A-Za-z0-9]{53}$' then
    raise exception 'Invalid PIN hash';
  end if;
  update public.settings set staff_pin_hash = new_hash where id = 1;
  update public.staff_pin_guard set failed_attempts = 0, locked_until = null where id = 1;
end $$;

alter table public.jobs            enable row level security;
alter table public.staff_pin_guard enable row level security;

drop policy if exists "owner reads jobs"   on public.jobs;
drop policy if exists "owner adds jobs"    on public.jobs;
drop policy if exists "owner updates jobs" on public.jobs;
drop policy if exists "owner deletes jobs" on public.jobs;
create policy "owner reads jobs"   on public.jobs for select to authenticated using (true);
create policy "owner adds jobs"    on public.jobs for insert to authenticated with check (true);
create policy "owner updates jobs" on public.jobs for update to authenticated using (true) with check (true);
create policy "owner deletes jobs" on public.jobs for delete to authenticated using (true);

revoke all on public.jobs from anon, authenticated;
grant select, insert, update, delete on public.jobs to authenticated;
revoke all on sequence public.job_ref_seq from anon, authenticated;
grant usage on sequence public.job_ref_seq to authenticated;
revoke all on public.staff_pin_guard from anon, authenticated;

revoke all on function public.check_staff_pin(text)         from public, anon, authenticated;
revoke all on function public.staff_unlock(text)            from public, anon, authenticated;
revoke all on function public.staff_submit_job(text, jsonb) from public, anon, authenticated;
revoke all on function public.set_staff_pin_hash(text)      from public, anon, authenticated;
grant execute on function public.staff_unlock(text)            to anon, authenticated;
grant execute on function public.staff_submit_job(text, jsonb) to anon, authenticated;
grant execute on function public.set_staff_pin_hash(text)      to authenticated;

do $$ begin alter publication supabase_realtime add table public.jobs;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Link jobs ↔ check-ins
--   A new job is linked to the latest open check-in for the same rego
--   from the last 7 days. The linked check-in then follows the job:
--     job New / In Progress → check-in In Progress
--     job Completed         → check-in Completed
--     job Cancelled         → check-in Cancelled
--   The owner can change or remove the link on the job page.
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists checkin_id uuid references public.checkins (id) on delete set null;
create index if not exists jobs_checkin_id_idx on public.jobs (checkin_id);

create or replace function public.link_job_to_checkin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.checkin_id is null then
    select id into new.checkin_id
      from public.checkins
     where rego = new.rego
       and status in ('new', 'in_progress')
       and not is_archived
       and created_at > now() - interval '7 days'
     order by created_at desc
     limit 1;
  end if;

  -- Staff don't enter customer details: take them from the linked check-in
  if new.checkin_id is not null then
    select coalesce(new.customer_name, nullif(trim(c.first_name || ' ' || c.last_name), '')),
           coalesce(new.phone, c.phone),
           coalesce(new.email, c.email)
      into new.customer_name, new.phone, new.email
      from public.checkins c
     where c.id = new.checkin_id;
  end if;
  return new;
end $$;

drop trigger if exists jobs_link_checkin on public.jobs;
create trigger jobs_link_checkin
  before insert on public.jobs
  for each row execute function public.link_job_to_checkin();

create or replace function public.sync_checkin_status_from_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.checkin_id is null then return null; end if;
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.checkin_id is not distinct from old.checkin_id then
    return null;
  end if;
  update public.checkins
     set status = case new.status
                    when 'completed' then 'completed'::public.checkin_status
                    when 'cancelled' then 'cancelled'::public.checkin_status
                    else 'in_progress'::public.checkin_status
                  end
   where id = new.checkin_id;
  return null;
end $$;

drop trigger if exists jobs_sync_checkin_status on public.jobs;
create trigger jobs_sync_checkin_status
  after insert or update of status, checkin_id on public.jobs
  for each row execute function public.sync_checkin_status_from_job();

revoke all on function public.link_job_to_checkin()          from public, anon, authenticated;
revoke all on function public.sync_checkin_status_from_job() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Assigning work to mechanics
--   The owner assigns a check-in (a car) to a mechanic from the Staff
--   list, with optional instructions. On /jobs the mechanic sees the cars
--   assigned to them that don't have a job sheet yet, and starts the job
--   sheet from one (linked to that check-in). Existing jobs are reassigned
--   by changing jobs.employee_name on the dashboard.
-- ---------------------------------------------------------------------
alter table public.checkins add column if not exists assigned_to   text check (assigned_to is null or char_length(assigned_to) between 1 and 80);
alter table public.checkins add column if not exists assigned_note text check (assigned_note is null or char_length(assigned_note) <= 500);
alter table public.checkins add column if not exists assigned_at   timestamptz;
create index if not exists checkins_assigned_to_idx on public.checkins (assigned_to) where assigned_to is not null;

create or replace function public.set_assigned_at()
returns trigger language plpgsql as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists checkins_set_assigned_at on public.checkins;
create trigger checkins_set_assigned_at
  before update of assigned_to on public.checkins
  for each row execute function public.set_assigned_at();

-- The mechanic's "Assigned to you" list: open, assigned cars with no job sheet yet.
-- Only car details and the owner's instructions – no customer contact details.
create or replace function public.staff_assignments(pin text, employee_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_items jsonb;
begin
  if not public.check_staff_pin(pin) then
    return jsonb_build_object('ok', false, 'error', 'Incorrect PIN');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'checkin_id', c.id,
           'reference_no', c.reference_no,
           'rego', c.rego,
           'make', c.make,
           'model', c.model,
           'year', c.year,
           'colour', c.colour,
           'odometer_km', c.odometer_km,
           'note', c.assigned_note,
           'assigned_at', c.assigned_at,
           'checked_in_at', c.created_at
         ) order by c.assigned_at nulls last, c.created_at), '[]'::jsonb)
    into v_items
    from public.checkins c
   where c.assigned_to = trim(employee_name)
     and c.status in ('new', 'in_progress')
     and not c.is_archived
     and not exists (select 1 from public.jobs j where j.checkin_id = c.id);

  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

revoke all on function public.set_assigned_at()               from public, anon, authenticated;
revoke all on function public.staff_assignments(text, text)   from public, anon, authenticated;
grant execute on function public.staff_assignments(text, text) to anon, authenticated;
