# Booking — Data Model

> Status: DRAFT 2026-11-02. All booking SQL lives in **`supabase/booking.sql`**: idempotent and safe to re-run like `schema.sql`, run **after** `schema.sql`.
> Conventions follow `schema.sql`: `security definer` functions with fixed `search_path`, explicit `revoke … from public, anon, authenticated` then narrow grants, RLS on every table, `updated_at` via `public.set_updated_at()`.

## 1. New tables

### booking_settings (single row, id = 1)
| Column | Type | Default |
|---|---|---|
| id | int PK check (id = 1) | 1 |
| online_enabled | bool | true (off → booking page shows "call us") |
| horizon_days | int 1–90 | 30 |
| online_cutoff_time | time | 17:00 (book for tomorrow until) |
| cancel_cutoff_time | time | 17:00 (day before) |
| reminder_time | time | 10:00 |
| pickup_message | text ≤ 200 | "From 3pm, we'll SMS you when it's ready." |
| price_disclaimer | text ≤ 300 | "Final price depends on your vehicle…" |
| sms_sender_id | text `^[A-Za-z0-9]{1,11}$` | 'SaiMotor' |
| sms_enabled | bool | true |
| ready_sms_mode | text `on_complete`\|`manual` | 'manual' (button only; the button works in both modes) |
| max_active_per_mobile | int | 3 |
| updated_at | timestamptz | now() |

Business name, phone and address come from the existing `settings` table.

### booking_services
| Column | Type | Constraints |
|---|---|---|
| id | uuid PK | |
| name | text 1–80 | unique |
| description | text ≤ 300 | |
| price_type | text | `fixed`\|`from`\|`quote` |
| price_cents | int ≥ 0 | null iff `quote` |
| online_bookable | bool | true |
| active | bool | true |
| sort_order | int | 0 |
| created_at, updated_at | timestamptz | |
Seeded with the services in BUSINESS_RULES §3.

### booking_weekly_hours
`weekday smallint PK (1=Mon … 7=Sun, ISO)`, `is_open bool`, `open_time time`, `close_time time` (both not null, open < close, kept even on closed days so an override that opens a closed weekday has hours to fall back on), `capacity_cars int ≥ 0`; an open weekday needs `capacity_cars ≥ 1` (T8 check constraint).
Seed: Mon–Fri 08:30–17:00 cap 10, Sat 08:30–16:00 cap 8, Sun closed.

### booking_windows
`id uuid PK`, `start_time`, `end_time` (start < end), `sort_order`, `active`. Seed 08:30–09:30.

### booking_date_overrides
`date date PK`, `is_open bool`, `open_time`, `close_time` (nullable), `capacity_cars int` (null only on closed overrides: an open override must state `capacity_cars ≥ 1`, T8 check constraint), `reason text ≤ 100` (owner only, never public), `show_phone bool` default false (closed overrides only, check constraint: show customers "call us", BUSINESS_RULES §1).

### booking_public_holidays
`date date PK`, `name text`. Seeded with NSW public holidays 2026–2027 from nsw.gov.au (checked 2026-11-05), including the additional days (Anzac: 27 Apr 2026, 26 Apr 2027; Boxing Day: 28 Dec 2026, 28 Dec 2027; Christmas: 27 Dec 2027). Bank Holiday (banks only) is not seeded.

**Effective day** (`booking_day(d)` SQL function): override → else holiday ⇒ closed → else weekly hours. Returns `day, is_open, open_time, close_time, capacity, source ('override'|'holiday'|'weekly'), note` (override reason or holiday name). Override nulls fall back to the weekday's values. Opening a closed weekday (e.g. a Sunday, capacity 0) needs a capacity: since T8 the DB refuses an open weekday or open override without one, and the Settings form asks first ("How many cars?").

### bookings
| Column | Type | Constraints / notes |
|---|---|---|
| id | uuid PK | |
| reference_no | text unique | `BKG-1001…` (own sequence) |
| status | text | `booked`\|`arrived`\|`completed`\|`cancelled`\|`no_show` |
| source | text | `online`\|`owner` |
| drop_off_date | date | not null |
| window_id | uuid FK booking_windows | |
| window_start, window_end | time | snapshot |
| first_name, last_name | text 1–80 | |
| mobile | text | E.164 `^\+614\d{8}$` |
| email | text | nullable, same check as checkins |
| rego | text | `^[A-Z0-9]{1,9}$` (normalised) |
| rego_state | text | `NSW`\|`VIC`\|`QLD`\|`SA`\|`WA`\|`TAS`\|`ACT`\|`NT` |
| make, model | text | 1–60 / 1–80 |
| year | int | 1950–2100, nullable |
| customer_notes | text ≤ 1000 | |
| owner_notes | text ≤ 2000 | owner only |
| over_capacity | bool | false |
| manage_token_hash | bytea unique | SHA-256 of a 32-byte random token (raw token never stored) |
| checkin_id | uuid FK checkins on delete set null | unique where not null |
| cancelled_at | timestamptz | set iff `status = 'cancelled'` (check constraint; undo must clear it) |
| is_read | bool | false (dashboard "new" badge, like checkins) |
| created_at, updated_at | timestamptz | |

Indexes / constraints:
- **One active booking per rego per day:** `unique (rego, drop_off_date) where status in ('booked','arrived','completed')`.
- `(drop_off_date, status)`, `(mobile)`, `(rego)`.
- Capacity is enforced in functions (§3), not by a constraint.

### booking_tokens (T2, decided 2026-11-05)
`booking_id uuid PK FK bookings on delete cascade`, `token text unique` (43-char base64url), `expires_on date` (drop-off + 7). The raw manage token, kept so the reminder / rescheduled SMS can carry the link. **service_role only** (select, insert, delete; no owner access, not on Realtime). SMS bodies hold a `{manage_link}` placeholder; the dispatcher (T3) fills it from `PUBLIC_BASE_URL` + this token at send time, so tokens never sit in `sms_outbox.body`. `bookings.manage_token_hash` stays the lookup for the manage page. Expired rows are deleted by `booking_retention()` (T3).

### booking_items
`booking_id uuid FK bookings on delete cascade`, `service_id uuid FK booking_services`, `name_snapshot`, `price_type_snapshot`, `price_cents_snapshot`. PK `(booking_id, service_id)`. ≥ 1 per booking (checked in functions).

### booking_events (append-only history)
`id`, `booking_id FK`, `at timestamptz`, `actor` (`customer`\|`owner`\|`system`), `action` (`created`, `cancelled`, `rescheduled`, `arrived`, `completed`, `no_show`, `reverted`, `overbooked`, `linked_checkin`, `sms_retry`), `details jsonb` (no PII beyond what's on the booking).

### sms_outbox
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid FK bookings on delete set null | null for `booking_link` and walk-in `ready` |
| checkin_id | uuid FK checkins on delete set null | set for `ready` sent from a check-in (walk-in or linked) |
| template | text | see BUSINESS_RULES §10 |
| to_mobile | text | E.164 |
| body | text ≤ 480 | rendered at enqueue |
| status | text | `pending`\|`sending`\|`sent`\|`failed`\|`cancelled` |
| attempts | int | 0–3 |
| next_attempt_at | timestamptz | |
| provider_message_id | text | |
| last_error | text ≤ 300 | no PII |
| dedupe_key | text unique | e.g. `{booking_id}:confirmation`, `{booking_id}:reminder:{date}`, `{booking_id}:cancelled:{n}`, `{booking_id}:rescheduled:{n}`, `ready:{checkin_id or booking_id}:{n}` (n = 1 for the first ready SMS, +1 per resend; a linked booking + check-in share one key so the car never gets two by accident) |
| created_at, sent_at | timestamptz | |
| claimed_at | timestamptz | set by claim; a row stuck in `sending` > 10 min is re-queued (T3) |

A pending row for a booking that is no longer in the right state (e.g. reminder for a cancelled booking) is set `cancelled` by the dispatcher.

## 2. Change to existing tables
- **None** (decided 2026-11-06, T6). The check-in ↔ booking link lives only in `bookings.checkin_id` (unique, `on delete set null`), so `checkins` gets no new column and the link can't get out of sync. Existing tables only get the two triggers in §4.

## 3. Functions (`security definer` unless marked invoker; `set search_path = pg_catalog, pg_temp` with every object schema-qualified, so a temp object can't shadow anything)
| Function | Granted to | Purpose |
|---|---|---|
| `booking_public_info()` | service_role | `{online_enabled, business{name,phone,address}, services[{id,name,description,price_type,price_cents}], windows[{id,start_time,end_time}], pickup_message, price_disclaimer, hours[]}`: active + online-bookable services only |
| `booking_clean_line`, `booking_sms_safe`, `booking_normalise_mobile`, `booking_format_day`, `booking_format_window` | none (internal) | Text clean-up (control chars; SMS also strips links, 40 chars), mobile → `+614…`, 'Thu 12 Nov', '8:30–9:30am' |
| `booking_availability(p_from date, p_to date, p_online bool)` | service_role, authenticated | Per day: open/closed/full, capacity, spots left. Applies horizon + cutoff when `p_online`. Returns `day, status ('open'\|'full'\|'closed'), reason, note, capacity, booked, spots_left, call_us` (`call_us` true only when an owner override closed the day with `show_phone`). `reason` (null unless closed): `past`, `booking_off`, `same_day`, `cutoff`, `horizon` (online rules, checked first), then `override`\|`holiday`\|`weekly`. `spots_left` is 0 on closed days. Range ≤ 92 days, else `22023`. Includes the owner's override `note` and exact counts, so public routes must map it down (API_SPEC §1) |
| `booking_availability_at(p_from, p_to, p_online, p_now timestamptz)` | service_role | **Invoker.** Same, with the clock passed in (tests). `booking_availability` = this with `now()`. "Today" and the cutoff use Sydney wall-clock time |
| `booking_day(d date)` | service_role | **Invoker.** Internal helper (above) |
| `booking_create(p jsonb, p_source text, p_allow_over bool, p_send_sms bool default true)` → `{id, reference_no, token, date, window_start, window_end}` | service_role (online); owner via wrapper `booking_owner_create` (T5) | `p` keys: `service_ids, date, window_id, first_name, last_name, mobile, email?, rego, rego_state, make, model, year?, notes?` (unknown keys → `VALIDATION`). Validates again, takes **advisory locks: mobile, then date** (fixed order), checks day rules + capacity via `booking_availability_at`, rego/day, mobile limit (online), inserts booking + items + events (`created`, plus `overbooked` when `allow_over` used) + `booking_tokens` row, **enqueues confirmation** with `{manage_link}` placeholder (a failure there is logged as an event, never fails the booking), returns the raw token once. Errors: exception message = API code (SQLSTATE `P0001`), detail = field name or existing booking date |
| `booking_by_token(p_token text)` → view | service_role | (T7) Format check, SHA-256 match on `manage_token_hash`, `drop_off_date + 7 ≥ today`, else `NOT_FOUND`. View: `reference_no, first_name, rego, make, model, services[], date, window_start, window_end ('HH:MM'), status, can_change, change_until, phone` — no surname, mobile, email or notes |
| `booking_cancel_by_token(p_token)` / `booking_reschedule_by_token(p_token, p_date, p_window_id)` → view | service_role | (T7) Customer actions: only `booked`, until `cancel_cutoff_time` the day before (`CUTOFF_PASSED` detail `booking`); reschedule uses the online day rules (`CUTOFF_PASSED` detail `date`, `OUTSIDE_HORIZON`, `BOOKING_OFF`, `CLOSED`, `FULL`, `DUPLICATE_BOOKING`; same day + window → `INVALID_TRANSITION` detail `unchanged`). Events with actor `customer`; SMS always queued (if SMS on); `is_read = false` |
| `booking_cancel_core(id, actor, notify)`, `booking_reschedule_core(id, date, window_id, online, allow_over, notify, actor)` | nobody (internal) | (T7) The shared steps behind the owner and customer functions: row lock / advisory locks (mobile, then date), event, token expiry move, stale SMS cancelled, SMS queued. `booking_owner_cancel` / `booking_owner_reschedule` are now thin wrappers. Helpers `booking_token_booking`, `booking_manage_view`, `booking_change_until`, `booking_can_change` are internal too |
| `booking_on_date(p_date date)` → `id, reference_no, first_name, last_name, rego, status, window_start` | authenticated (SECURITY INVOKER, RLS applies) | (T8) Active bookings (`booked`, `arrived`, `completed`) on a day, listed in Settings before the owner closes that day or cuts its capacity |
| `booking_owner_cancel(id, notify)`, `booking_owner_reschedule(id, date, window, allow_over, notify)`, `booking_owner_set_status(id, status)`, `booking_link_checkin(id, checkin_id)`, `booking_send_ready_sms(id, resend)`, `booking_checkin_ready_sms(checkin_id, resend)` (walk-ins; normalises `checkins.phone`, rejects non-mobiles) | authenticated | Owner actions; status rules from BUSINESS_RULES §7; events recorded. T4 built cancel, reschedule, set_status, link_checkin and `booking_retry_sms(outbox_id)` (authenticated only: anon and service_role can't call them); the ready-SMS ones came in T6 (§4). SMS dedupe: `{id}:cancelled:{n}`, `{id}:rescheduled:{n}` |
| `booking_owner_create(p, allow_over, send_sms)` → `{id, reference_no, date}` | authenticated | T5 quick add: `booking_create` with source `owner`, then `is_read = true` |
| `booking_send_link(p_mobile)` | authenticated | Option B; rate-limited 5/mobile/Sydney day (advisory lock on the mobile) |
| `booking_customer_lookup(p_mobile)` | authenticated | Quick-add pre-fill from latest booking or check-in with that mobile; previous no-show count |
| `booking_enqueue_reminders()` / `booking_enqueue_reminders_at(p_now)` | service_role | Cron every 15 min. Queues only once Sydney time ≥ `reminder_time`, for `booked` bookings tomorrow made before today's `reminder_time`; idempotent through `dedupe_key` `{id}:reminder:{date}` (T4: a rescheduled booking gets one for its new date). Body has `{manage_link}`. `_at` fixes the clock for tests |
| `booking_sms_claim(p_limit int, p_ids uuid[] default null)` → `id, template, to_mobile, body, token, sender_id, attempts` | service_role | Re-queues rows stuck in `sending` > 10 min, cancels stale rows (BUSINESS_RULES §10), then claims due rows (`for update skip locked`, status → `sending`, attempts + 1) with the manage token for `{manage_link}`. `p_ids` limits to given rows (tests only) |
| `booking_sms_result(id, ok, provider_id, error, retryable default true)` → new status | service_role | Only for rows in `sending`. ok → `sent`; retryable + attempts < 3 → `pending` (+1 min / +5 min); else `failed`. Error text cleaned, ≤ 300 chars, no PII |
| `booking_retention()` → `{outbox_deleted, tokens_deleted}` | service_role | Deletes `sms_outbox` rows > 2 years and `booking_tokens` past `expires_on` |

## 4. Triggers on existing tables
| Trigger | On | Does |
|---|---|---|
| `checkins_link_booking` | `after insert on checkins` | BUSINESS_RULES §8 match (today in Sydney, `booked`, unlinked; rego first, then mobile, both normalised; earliest made; `for update skip locked`) → `bookings.checkin_id` set, booking → `arrived`, events `linked_checkin` + `arrived` (actor `system`, via `kiosk`) |
| `checkins_complete_booking` | `after update of status on checkins` | Linked booking `arrived` and check-in → `completed` ⇒ booking `completed`; only if `ready_sms_mode = on_complete` (off by default), enqueue `ready` (dedupe) |
These are added in `booking.sql`; `schema.sql` is not edited. They must never raise (a booking problem must not break a kiosk check-in): wrap in `begin … exception when others then` + log to `booking_events`.

Testing the never-raise rule: `booking_test_faults(name)` (`checkin_link` | `checkin_complete`), **service_role only**, always empty in production. A row makes the matching trigger raise on purpose, so `tests/db/booking-checkin.test.ts` can prove the kiosk submit / check-in save still succeeds.

Ready SMS (T6): `booking_send_ready_sms(id, resend)` (booking `arrived`/`completed`) and `booking_checkin_ready_sms(checkin_id, resend)` (linked → as the booking; walk-in → check-in's first name + phone, non-mobile → `VALIDATION` detail `not_mobile`; cancelled → `INVALID_TRANSITION`). Both go through the internal `booking_queue_ready`: dedupe `ready:{checkin_id or booking_id}:{n}`, earlier rows under either id count, a queued/sent one → `INVALID_TRANSITION` detail `already_sent` unless `resend`. Body: "Hi {first}, your {rego} is ready for pickup at {business}. We're open until {close}." (the last sentence only when open today).

## 5. Access rules
The owner is the only Supabase Auth user (sign-ups disabled), so `authenticated` = owner, matching the existing app.

| Object | anon | authenticated (owner) | service_role (server routes) |
|---|---|---|---|
| booking_settings, booking_services, booking_weekly_hours, booking_windows, booking_date_overrides | none | select, insert, update (services: no delete) | via functions |
| booking_public_holidays | none | select | — |
| bookings, booking_items | none | select; update **only** `owner_notes`, `is_read` (column grants). Status/date changes only via functions | via functions |
| booking_events | none | select | via functions |
| sms_outbox | none | select | via functions |
| all `booking_*` functions | **none** | owner functions only (§3) | public + cron functions |

Anon has **no** grants on anything booking-related. The public page reaches the database only through server route handlers.

Implemented in T1 (`booking.sql`): every booking table revokes all from `public, anon, authenticated`, then grants `select` to `authenticated` plus the column-level `insert`/`update` listed above; `service_role` has all (incl. Supabase's default truncate/references/trigger) revoked, then gets `select, insert, update, delete` on the booking tables (`booking_events`: `select, insert` only, so it is append-only for every role; rows go only by cascade from `bookings`) and `usage` on `booking_ref_seq` (server code still goes through functions; DB tests seed rows directly). Tests: `tests/db/booking-access.test.ts`.

Realtime: add `bookings` and `sms_outbox` to `supabase_realtime` (owner dashboard live updates; RLS applies).
