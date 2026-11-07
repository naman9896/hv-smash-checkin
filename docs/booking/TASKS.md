# Booking — Tasks (7 days)

> Status: DRAFT 2026-11-02, owner answers applied 2026-11-03. One task per session. Each task: re-read the rules it touches → write failing tests → implement → run tests, lint, typecheck → try it in the browser → update docs → tick → commit.
> Target: owner trial on **day 6**, go-live **day 7**. If time runs short, cut in this order: T7 rescheduling online (keep cancel) → owner undo actions → B2 "send link" (owner asked for it, so cut it last).
> Before writing code, read the Next.js 16 docs in `node_modules/next/dist/docs/` (see AGENTS.md): this Next version has breaking changes.

## Day 1
- [x] **T0 Guardrails** (done 2026-11-05, PR #1 on `naman9896/sai-motor-checkin`)
  - Vitest (unit + DB integration) and Playwright (E2E) set up; `npm test`, `npm run typecheck`, `npm run test:e2e` scripts
  - Test database: a separate **staging Supabase project** (Sydney), chosen 2026-11-03. Never the production project
    - Set up by Naman: create the project, run `schema.sql` then `booking.sql`, turn sign-ups off, create one test owner user
    - Keys in `.env.test.local` (git-ignored, never pasted in chat): `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, test owner email/password
    - Test setup refuses to run if the URL matches the production project ref; tests clean up only rows they created (unique test regos/mobiles)
    - Vercel preview deployments point at staging; production env stays on the live project
    - Two GitHub repos: `mine` = `naman9896/sai-motor-checkin` (dev + CI), `origin` = `labmotors/saimotorworks-jobs` (owner's, deployed). Staging keys are GitHub secrets **only in `naman9896`**
    - The DB/E2E test job has `if: github.repository == 'naman9896/sai-motor-checkin'`, so the same workflow file skips it on the owner's repo; lint, typecheck, unit tests and audit (no secrets) run on both
  - GitHub Actions: lint, typecheck, unit tests, `npm audit --audit-level=high`, Semgrep CE (static analysis), Gitleaks (secret scanning, full history). Dependabot (alerts + security updates + `dependabot.yml`)
    - Changed 2026-11-05: both repos are private without GitHub Code Security / Secret Protection, so CodeQL and GitHub secret scanning aren't available; Semgrep CE + Gitleaks run inside CI instead
  - `.env.example` gets the new variable names (no values)
  - AC: CI is green on an empty test
- [x] **T1 Booking schema + availability** (done 2026-11-05; 63 DB tests green on staging: `tests/db/booking-availability.test.ts`, `booking-access.test.ts`. Adds `booking_availability_at(…, p_now)` for tests; `checkins.booking_id` moved to T6)
  - `supabase/booking.sql`: tables, seeds (services, hours, window, NSW holidays 2026–27), `booking_day`, `booking_availability`, grants, RLS, Realtime
  - Tests:
    - closed Sunday, holiday closed, override opens a holiday
    - capacity 10 → full after 10 active bookings; cancelled/no-show free a spot
    - horizon, 17:00 cutoff for tomorrow, DST day
    - anon has no access to any booking table or function

## Day 2
- [x] **T2 Create booking (DB + public route + page)** (done 2026-11-05; 96 DB + 9 E2E tests green on staging. Tokens kept in service-role-only `booking_tokens`, SMS bodies use `{manage_link}`. BotID / WAF stay in T9)
  - `booking_create` with advisory lock and token; `POST /api/booking`, `GET /api/booking/info`, `/availability`; Zod schemas
  - `/book` multi-step mobile form: services → day → vehicle → contact → "anything else?" → review → **Book** / **Add another service**. Progress bar, big tap targets, inline errors, existing make dropdown. A closed day with `callUs` shows "Not available online." + "Call the workshop" / {phone} as a `tel:` link (phone from `settings.phone`: 1300 017 205; hide the call option if it's empty); other closed days just show unavailable
  - Confirmation SMS **queued** (sent in T3)
  - `GET /api/booking/availability` maps `booking_availability` down to `{date, status}` (+ "few left"); never return `note`, `capacity` or `booked` publicly. Booking code checks `status`, not `spots_left`
  - Tests:
    - race: 10 parallel requests for 1 spot → 1 success, 9 `FULL`
    - duplicate rego/day
    - mobile limit
    - unknown or inactive service
    - unknown fields rejected
    - E2E happy path on a phone viewport

## Day 3
- [x] **T3 SMS dispatch + reminders**
  - Fill `{manage_link}` at send time from `PUBLIC_BASE_URL` + `booking_tokens.token` (decided in T2); `booking_retention()` also deletes `booking_tokens` past `expires_on`
  - Set `CRON_SECRET` (≥ 16 chars, e.g. `openssl rand -hex 32`) in Vercel production + preview; Vercel Cron sends it automatically
  - Vercel Hobby allows only daily crons: `vercel.json` has retention only. Set up the external scheduler (dispatch every minute, reminders every 15 min, `Authorization: Bearer <CRON_SECRET>`) before go-live (API_SPEC §3)
  - **Manage link in `sms_outbox.body`** (review 2026-11-05): don't leave the raw token at rest. Scrub the link once a row is final, or render it at send time; add a test
  - Provider interface, ClickSend + log providers, `/api/booking/cron/dispatch`, `/reminders`, `/retention`, `vercel.json` cron (retention) + external scheduler (dispatch, reminders), `after()` kick from `POST /api/booking`
  - Tests:
    - retries (3 tries, then `failed`)
    - dedupe (reminder never sent twice)
    - stale row cancelled (reminder for a cancelled booking)
    - cron 401 without secret
    - no real SMS when `SMS_MODE=log`
    - reminder timing in Sydney time, including DST

## Day 4
- [x] **T4 Dashboard Bookings tab**
  - Side/mobile nav item with unread badge + chime on new online booking (reuse check-in patterns)
  - Day view (Today / Tomorrow / pick date): reference, customer, rego, services, status, SMS status, "Not arrived" after 17:00
  - Booking detail: notes, cancel, reschedule (owner may overbook), mark arrived / no-show / completed, undo, link check-in, retry SMS
  - Tests: RLS (owner sees all, anon nothing); status transition rules; column grants (owner can't edit status directly)
  - Done 2026-11-06: owner rules recorded in BUSINESS_RULES §7; reminder dedupe now per date; `{booking_page}` placeholder for the cancellation SMS
- [x] **T5 Phone quick-add (+ B2 send link)**
  - From T4: owner-made bookings are saved `is_read = true` (done in `booking_owner_create`)
  - Quick-add sheet optimised for phone: mobile → lookup pre-fill → services → day with spots left → save (SMS on by default)
  - B2 "Send booking link" (owner confirmed)
  - Tests: pre-fill from booking and from check-in, overbook flag, same-day allowed, send-link limit

## Day 5
- [x] **T6 Check-in ↔ booking link + ready SMS**
  - Triggers on `checkins`: match today's booking by rego, then mobile → `arrived`; check-in `completed` → booking `completed` + `ready` SMS only in `on_complete` mode (off by default); **Send ready SMS** button on the booking and on every check-in drawer, walk-ins included (asks before resending)
  - Booking badge on the check-in detail drawer
  - Decided 2026-11-06: link stored only in `bookings.checkin_id` (no `checkins.booking_id`); `booking_test_faults` (service role only) proves the triggers never block the kiosk
  - Tests:
    - rego match, mobile match, no match
    - two bookings → earliest
    - **a trigger error never blocks a kiosk submit**
    - default `manual`: job completed → **no** SMS; `on_complete`: exactly once
    - walk-in button: valid mobile → queued; landline / bad phone → "Not a mobile number"; cancelled check-in → rejected
    - second press → needs `resend`; linked booking + check-in never double-send
- [x] **T7 Manage page** (done 2026-11-06; 203 DB + 40 E2E green on staging. Owner cancel/reschedule now wrap shared cores; customer changes mark the booking unread; headers in `next.config.ts`. A well-formed unknown token shows not-found with HTTP 200 + noindex on the page (streaming), real 404 from the API; rate limit is the WAF rule in T9)
  - `/b/[token]`: view, cancel, reschedule before cutoff; after cutoff show the phone number
  - Add a "Change or cancel" link (the `manageUrl` from `POST /api/booking`) to the `/book` confirmation screen (left out in T2 so it doesn't 404 before this page exists)
  - Tests: bad/expired token → 404, cutoff, reschedule into a full day, minimal fields only, `no-referrer`

## Day 6
- [x] **T8 Booking settings + no-shows** (done 2026-11-07; 220 DB + 44 E2E green on staging. Open days must have a capacity: check constraints + form, so the T1 "override falls back to the weekday capacity" test now expects a stated capacity; hours still fall back. `booking_on_date` lists a day's bookings before closing it. No-show count also on the day list)
  - New Settings tab "Online Booking": on/off, services and prices, weekly hours + capacity, window, closed dates (warns about existing bookings; per date "Show my phone number to customers" toggle, off by default), cutoffs, reminder time, sender ID, ready-SMS mode (default button only)
  - No-show count shown on bookings
  - Opening a closed weekday (e.g. Sunday) needs a capacity, else the day shows full
  - Tests: validation (open < close, sender ID format), closing a date with bookings lists them
- [ ] **Owner trial** on the preview deployment with `SMS_MODE=log` (or live to the owner's own mobile only)

## Day 7
- [ ] **T9 Hardening + go-live**
  - Security headers (`frame-ancestors`), BotID, Vercel WAF rules, check the kiosk still works
  - Run `references/security-checklist.md`; adversarial pass:
    - anon key against every booking object
    - token guessing
    - SMS pumping
    - race
    - trigger failure
  - Confirm Supabase sign-ups **and anonymous sign-ins** are disabled (`GET /auth/v1/settings`: `disable_signup: true`, `external.anonymous_users: false`), only the owner's account exists, and backups are on
  - ClickSend live keys in production; test SMS to the owner
  - "Book now" on saimotorworks.com.au (owner's own Next.js site; decided 2026-11-06):
    - Booking app on a subdomain (e.g. `book.saimotorworks.com.au`): CNAME → Vercel, add the domain in Vercel, set `PUBLIC_BASE_URL` to it
    - Main site: a "Book a service" link to `…/book` (recommended); optionally a "Book online" page with an `<iframe src="…/book">` (only `/book` is frameable)
    - Multi-zone rewrites (`saimotorworks.com.au/book`) only if the same domain matters: needs `assetPrefix` + API rewrites, and WAF/BotID would see the main site's server
  - External scheduler (cron-job.org) for dispatch + reminders (API_SPEC §3)
  - Write `docs/booking/LAUNCH_REPORT.md`
