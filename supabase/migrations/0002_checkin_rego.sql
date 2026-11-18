-- =====================================================================
-- 0002: Car rego on check-ins (required for every new kiosk submission)
--
-- Stored upper case, letters and digits only, 1–9 characters ("ABC123").
-- The column is nullable only because check-ins made before this migration
-- have no rego; kiosk_submit_checkin requires it for every new row.
-- Keep in line with `rego` in src/lib/validation.ts.
-- =====================================================================

alter table public.checkins
  add column rego text check (rego ~ '^[A-Z0-9]{1,9}$');

create index checkins_rego_idx on public.checkins (rego);

-- The argument list changes, so drop the old function (and its grants) first
drop function public.kiosk_submit_checkin(uuid, text, text, text, text, text, int, text, text, text, text);

create function public.kiosk_submit_checkin(
  p_id                 uuid,
  p_customer_name      text,
  p_email              text,
  p_phone              text,
  p_rego               text,
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
  v_rego      text := upper(regexp_replace(coalesce(p_rego, ''), '[\s.\-]', '', 'g'));
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

  -- Required here (the column allows null only for older rows)
  if v_rego !~ '^[A-Z0-9]{1,9}$' then
    raise exception 'Invalid rego' using errcode = '22023';
  end if;

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
    rego, make, model, year,
    job_type, insurance_company, claim_number, damage_description,
    signature_path, signed_at, status, returning_customer
  ) values (
    p_id, trim(p_customer_name), v_email, v_phone,
    v_rego, trim(p_make), trim(p_model), p_year,
    v_job, v_insurer, v_claim, v_damage,
    v_sig, now(), 'new', v_returning
  )
  returning reference_no into v_ref;

  return v_ref;
end $$;

-- Supabase grants EXECUTE on new functions by default: revoke, then grant anon only
revoke all on function public.kiosk_submit_checkin(uuid, text, text, text, text, text, text, int, text, text, text, text) from public, anon, authenticated;
grant execute on function public.kiosk_submit_checkin(uuid, text, text, text, text, text, text, int, text, text, text, text) to anon;
