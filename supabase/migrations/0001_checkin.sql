-- =====================================================================
-- Customer check-in: the whole database for a NEW Supabase project.
-- Run once (Supabase → SQL Editor, or `supabase db push`).
--
--   checkins         one row per kiosk check-in
--   settings         owner settings (one row)
--   settings_signal  lets the anon kiosk notice settings changes over Realtime
--   pin_guard        owner-PIN brute-force lockout
--   kiosk_settings   view: the only settings the kiosk can read
--   storage          `signatures` bucket (private)
--
-- Access:
--   anon (the kiosk / the /api/checkin route) can only call
--   kiosk_submit_checkin, verify_pin, read kiosk_settings + settings_signal,
--   and upload a signature PNG. It can never read check-ins or signatures.
--   authenticated (the owner) reads and manages everything.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Status enum
-- ---------------------------------------------------------------------
create type public.checkin_status as enum ('new', 'in_progress', 'completed', 'cancelled');

-- ---------------------------------------------------------------------
-- Reference numbers: HVS-1001, HVS-1002, … (prefix: config/business.ts)
-- ---------------------------------------------------------------------
create sequence public.checkin_ref_seq start with 1001;

-- ---------------------------------------------------------------------
-- checkins
-- ---------------------------------------------------------------------
create table public.checkins (
  id                  uuid primary key default gen_random_uuid(),
  reference_no        text not null unique default ('HVS-' || nextval('public.checkin_ref_seq')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  status              public.checkin_status not null default 'new',

  -- Customer
  customer_name       text not null check (char_length(customer_name) between 1 and 120),
  email               text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Digits only, national format: mobile 04/05…, landline 02/03/07/08…
  phone               text not null check (phone ~ '^0[2-578][0-9]{8}$'),

  -- Vehicle
  make                text not null check (char_length(make) between 1 and 60),
  model               text not null check (char_length(model) between 1 and 80),
  -- Upper bound (next year) is enforced in kiosk_submit_checkin; a CHECK can't use now()
  year                int  check (year between 1950 and 2200),

  -- Job
  job_type            text check (job_type in ('insurance', 'private')),
  insurance_company   text check (char_length(insurance_company) between 1 and 120),
  claim_number        text check (char_length(claim_number) between 1 and 60),
  damage_description  text check (char_length(damage_description) between 1 and 500),

  -- Signature: PNG in the private `signatures` bucket
  signature_path      text not null unique check (signature_path ~ '^[0-9a-f-]{36}\.png$'),
  signed_at           timestamptz not null default now(),

  -- Owner-only
  internal_notes      text not null default '' check (char_length(internal_notes) <= 5000),
  is_read             boolean not null default false,
  is_archived         boolean not null default false,
  returning_customer  boolean not null default false,

  -- Insurer and claim number only on insurance jobs
  constraint checkins_insurance_only check (
    job_type = 'insurance' or (insurance_company is null and claim_number is null)
  )
);

create index checkins_created_at_idx on public.checkins (created_at desc);
create index checkins_status_idx     on public.checkins (status);
create index checkins_phone_idx      on public.checkins (phone);
create index checkins_email_idx      on public.checkins (email);

-- updated_at trigger (shared by checkins and settings)
create function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger checkins_set_updated_at
  before update on public.checkins
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- settings (single row, id = 1)
-- Branding (name, logo, colours) lives in config/business.ts, not here.
-- Null text settings fall back to the defaults in that file.
-- ---------------------------------------------------------------------
create table public.settings (
  id                      int primary key default 1 check (id = 1),
  owner_name              text check (char_length(owner_name) <= 120),
  abn                     text check (abn ~ '^[0-9 ]{11,14}$'),
  phone                   text check (char_length(phone) <= 30),
  email                   text check (char_length(email) <= 254),
  address                 text check (char_length(address) <= 300),
  opening_hours           text check (char_length(opening_hours) <= 500),
  pin_hash                text,
  auto_lock_minutes       int  not null default 15 check (auto_lock_minutes in (0, 5, 15, 30)),  -- 0 = never
  kiosk_enabled           boolean not null default true,
  kiosk_paused_message    text check (char_length(kiosk_paused_message) <= 300),
  kiosk_title             text check (char_length(kiosk_title) <= 120),
  kiosk_subtitle          text check (char_length(kiosk_subtitle) <= 300),
  consent_text            text check (char_length(consent_text) <= 2000),
  thank_you_reset_seconds int  not null default 5 check (thank_you_reset_seconds between 3 and 120),
  idle_timeout_minutes    int  not null default 3 check (idle_timeout_minutes between 1 and 60),
  sound_enabled           boolean not null default true,
  chime                   text not null default 'chime-1' check (chime in ('chime-1', 'chime-2', 'chime-3')),
  browser_notifications   boolean not null default false,
  email_alerts            boolean not null default false,
  archive_after_months    int check (archive_after_months between 1 and 120), -- null = never
  updated_at              timestamptz not null default now()
);

insert into public.settings (id) values (1);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- settings_signal: a one-row table the kiosk (anon) watches over Realtime.
-- It carries no data, only "settings changed at <time>", so the kiosk
-- knows to re-read the kiosk_settings view.
-- ---------------------------------------------------------------------
create table public.settings_signal (
  id         int primary key default 1 check (id = 1),
  changed_at timestamptz not null default now()
);
insert into public.settings_signal (id) values (1);

create function public.bump_settings_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.settings_signal set changed_at = now() where id = 1;
  return null;
end $$;

create trigger settings_bump_signal
  after update on public.settings
  for each statement execute function public.bump_settings_signal();

-- ---------------------------------------------------------------------
-- kiosk_settings view: only what the public kiosk needs.
-- Never exposes pin_hash, contact details or ABN. Runs with the view
-- owner's rights so anon can read it without access to `settings`.
-- ---------------------------------------------------------------------
create view public.kiosk_settings as
  select kiosk_enabled, kiosk_paused_message, kiosk_title, kiosk_subtitle, consent_text,
         thank_you_reset_seconds, idle_timeout_minutes,
         (pin_hash is not null) as pin_set,
         updated_at
  from public.settings
  where id = 1;

-- ---------------------------------------------------------------------
-- Owner PIN: bcrypt hash only, verified with pgcrypto crypt().
-- 5 failed attempts → 5-minute lockout.
-- ---------------------------------------------------------------------
create table public.pin_guard (
  id              int primary key default 1 check (id = 1),
  failed_attempts int not null default 0,
  locked_until    timestamptz
);
insert into public.pin_guard (id) values (1);

create function public.verify_pin(pin text)
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

-- The dashboard hashes the new PIN with bcrypt in the browser and sends only the hash. Owner-only.
create function public.set_pin_hash(new_hash text)
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
-- Kiosk submit. Called by POST /api/checkin (anon key) after it has
-- validated the form and uploaded the signature to `signatures/<id>.png`.
-- Checks everything again (anyone holding the anon key can call it),
-- inserts one row and returns ONLY the reference number.
-- ---------------------------------------------------------------------
create function public.kiosk_submit_checkin(
  p_id                 uuid,
  p_customer_name      text,
  p_email              text,
  p_phone              text,
  p_make               text,
  p_model              text,
  p_year               int,
  p_job_type           text,
  p_insurance_company  text,
  p_claim_number       text,
  p_damage_description text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref       text;
  v_enabled   boolean;
  v_sig       text := p_id::text || '.png';
  v_phone     text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_job       text := nullif(trim(coalesce(p_job_type, '')), '');
  v_insurer   text := nullif(trim(coalesce(p_insurance_company, '')), '');
  v_claim     text := nullif(trim(coalesce(p_claim_number, '')), '');
  v_damage    text := nullif(trim(coalesce(p_damage_description, '')), '');
  v_returning boolean;
begin
  if p_id is null then
    raise exception 'Missing check-in id' using errcode = '22023';
  end if;

  select kiosk_enabled into v_enabled from public.settings where id = 1;
  if not coalesce(v_enabled, true) then
    raise exception 'Check-in is currently paused' using errcode = 'P0002';
  end if;

  -- +61 4xx… → 04xx…
  if v_phone ~ '^61[0-9]{9}$' then v_phone := '0' || substr(v_phone, 3); end if;

  if p_year is not null and (p_year < 1950 or p_year > extract(year from now())::int + 1) then
    raise exception 'Invalid year' using errcode = '22023';
  end if;
  if v_job is distinct from 'insurance' then
    v_insurer := null;
    v_claim := null;
  end if;

  -- The signature must already be uploaded, under this check-in's id
  if not exists (select 1 from storage.objects where bucket_id = 'signatures' and name = v_sig) then
    raise exception 'Signature missing' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.checkins where phone = v_phone or email = v_email
  ) into v_returning;

  -- Length/format checks are the table's CHECK constraints
  insert into public.checkins (
    id, customer_name, email, phone,
    make, model, year,
    job_type, insurance_company, claim_number, damage_description,
    signature_path, signed_at, status, returning_customer
  ) values (
    p_id, trim(p_customer_name), v_email, v_phone,
    trim(p_make), trim(p_model), p_year,
    v_job, v_insurer, v_claim, v_damage,
    v_sig, now(), 'new', v_returning
  )
  returning reference_no into v_ref;

  return v_ref;
end $$;

-- ---------------------------------------------------------------------
-- Auto-archive completed check-ins older than settings.archive_after_months.
-- Called by the dashboard on load.
-- ---------------------------------------------------------------------
create function public.archive_completed_checkins()
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
-- ---------------------------------------------------------------------
alter table public.checkins        enable row level security;
alter table public.settings        enable row level security;
alter table public.settings_signal enable row level security;
alter table public.pin_guard       enable row level security;

-- checkins: owner only. The kiosk inserts through kiosk_submit_checkin (security definer).
create policy "owner reads checkins"   on public.checkins for select to authenticated using (true);
create policy "owner updates checkins" on public.checkins for update to authenticated using (true) with check (true);
create policy "owner deletes checkins" on public.checkins for delete to authenticated using (true);

revoke all on public.checkins from anon, authenticated;
grant select, delete on public.checkins to authenticated;
-- The owner changes workflow fields only, never what the customer submitted
grant update (status, internal_notes, is_read, is_archived) on public.checkins to authenticated;
revoke all on sequence public.checkin_ref_seq from anon, authenticated;

create policy "owner reads settings" on public.settings
  for select to authenticated using (id = 1);
create policy "owner updates settings" on public.settings
  for update to authenticated using (id = 1) with check (id = 1);

revoke all on public.settings from anon, authenticated;
grant select (id, owner_name, abn, phone, email, address, opening_hours,
              auto_lock_minutes, kiosk_enabled, kiosk_paused_message, kiosk_title, kiosk_subtitle,
              consent_text, thank_you_reset_seconds, idle_timeout_minutes, sound_enabled, chime,
              browser_notifications, email_alerts, archive_after_months, updated_at)
  on public.settings to authenticated;
grant update (owner_name, abn, phone, email, address, opening_hours,
              auto_lock_minutes, kiosk_enabled, kiosk_paused_message, kiosk_title, kiosk_subtitle,
              consent_text, thank_you_reset_seconds, idle_timeout_minutes, sound_enabled, chime,
              browser_notifications, email_alerts, archive_after_months)
  on public.settings to authenticated;

create policy "anyone reads settings signal" on public.settings_signal
  for select to anon, authenticated using (true);
revoke all on public.settings_signal from anon, authenticated;
grant select on public.settings_signal to anon, authenticated;

revoke all on public.pin_guard from anon, authenticated;

revoke all on public.kiosk_settings from anon, authenticated;
grant select on public.kiosk_settings to anon, authenticated;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default,
-- so revoke from them explicitly, then grant back only what each role needs.
revoke all on function public.set_updated_at()                from public, anon, authenticated;
revoke all on function public.bump_settings_signal()          from public, anon, authenticated;
revoke all on function public.verify_pin(text)                from public, anon, authenticated;
revoke all on function public.set_pin_hash(text)              from public, anon, authenticated;
revoke all on function public.kiosk_submit_checkin(uuid, text, text, text, text, text, int, text, text, text, text) from public, anon, authenticated;
revoke all on function public.archive_completed_checkins()    from public, anon, authenticated;
grant execute on function public.verify_pin(text)             to anon, authenticated;
grant execute on function public.set_pin_hash(text)           to authenticated;
grant execute on function public.kiosk_submit_checkin(uuid, text, text, text, text, text, int, text, text, text, text) to anon;
grant execute on function public.archive_completed_checkins() to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
--   checkins        : live list for the signed-in owner (RLS applies)
--   settings        : owner dashboards on other devices
--   settings_signal : the kiosk
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.checkins;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.settings_signal;

-- ---------------------------------------------------------------------
-- Storage: `signatures` (private, PNG only, 512 KB max).
--   anon          : upload a new file named <uuid>.png. No read, no overwrite.
--   authenticated : read (signed URLs) and delete (privacy requests).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 524288, array['image/png']);

create policy "kiosk uploads signatures" on storage.objects
  for insert to anon
  with check (bucket_id = 'signatures' and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$');
create policy "owner reads signatures" on storage.objects
  for select to authenticated using (bucket_id = 'signatures');
create policy "owner deletes signatures" on storage.objects
  for delete to authenticated using (bucket_id = 'signatures');
