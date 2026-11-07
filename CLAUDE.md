# CLAUDE.md — Sai Motor Works check-in + online booking

@AGENTS.md

## What this is
Sai Motor Works (Rutherford NSW) workshop app: customer kiosk check-in (`/kiosk`), staff job sheet with shared PIN (`/jobs`), owner dashboard (`/dashboard`). Being extended with an **online booking module** (customer booking page, owner Bookings tab, SMS confirmation/reminder/ready). See `README.md` for the existing app and `docs/booking/` for the booking module.

## Source of truth for booking work
Read before any booking task: `docs/booking/README.md`, `BUSINESS_RULES.md`, `DATA_MODEL.md`, `API_SPEC.md`, `SECURITY.md`, `TASKS.md`. If code and docs disagree, stop and ask.

## Stack
Next.js 16 (App Router; read `node_modules/next/dist/docs/` first, it has breaking changes, e.g. `proxy.ts` replaces middleware) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Realtime, Storage) · Zod · Vercel Pro. SMS: ClickSend.

## Commands
- Dev: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests (no network, no secrets; CI on both repos): `npm test` (`npm run test:watch` to watch)
- DB integration tests (staging Supabase, keys in `.env.test.local`): `npm run test:db`
- E2E (Playwright, boots the app on port 3100 with `NODE_ENV=test` so `.env.local` is never loaded): `npm run test:e2e`. First time: `npx playwright install chromium`
- `test:db` and `test:e2e` refuse to run unless `TEST_SUPABASE_*` point at staging (`tests/support/env-guard.ts`)
- DB: run `supabase/schema.sql`, then `supabase/booking.sql`, in the Supabase SQL editor (both idempotent)

## Booking module rules
- Keep it self-contained: `supabase/booking.sql`, `src/lib/booking/`, `src/components/booking/`, routes `/book`, `/b/[token]`, `/dashboard/bookings`, `/api/booking/*`. Don't edit `schema.sql` or existing tables, except the two `checkins` triggers in `booking.sql` (the booking link is `bookings.checkin_id`; no column on `checkins`).
- Anon gets no access to booking tables or functions. Public flows go through server route handlers that use the service-role client (`server-only`).
- Capacity and one-booking-per-rego-per-day are enforced in the DB (advisory lock + partial unique index).
- SMS only through `sms_outbox` and the dispatcher. An SMS failure never fails a booking. `SMS_MODE=log` outside production.
- Triggers on `checkins` must never raise: the kiosk must keep working.
- Zod `.strict()` on every input. No secrets in code. Never print or commit `.env*`. The service-role key never gets `NEXT_PUBLIC_`.
- Don't log mobiles, names, notes or manage tokens.
- Follow `schema.sql` conventions: `security definer` + fixed `search_path`, revoke-then-grant, check constraints.

## How to work
One task from `docs/booking/TASKS.md` per session. Tests first (including unhappy paths and access tests), then implement, then run everything and try it in the browser. Never claim it works without running it. Update the docs, tick the task, commit.

## Ask before touching
Grants/RLS, `security definer` functions, triggers on `checkins`/`jobs`, the service-role client, token logic, cron auth, `next.config.ts` headers, auth/PIN code, anything that deletes data.
