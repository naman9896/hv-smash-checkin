# Booking — Security

> Status: DRAFT 2026-11-02. Covers what booking adds. The existing app's model (owner = the only Supabase Auth user; kiosk/staff through `security definer` functions) is kept.

## 1. Who can do what
| Action | Public | Token holder | Mechanic (staff PIN) | Owner |
|---|---|---|---|---|
| See booking page, services, availability | ✅ | ✅ | ✅ | ✅ |
| Create online booking | ✅ (bot check, rate limit) | — | — | — |
| View / cancel / reschedule one booking | ❌ | ✅ that booking, before cutoff | ❌ | ✅ any |
| See bookings, customer details | ❌ | ❌ | ❌ | ✅ |
| Phone booking, overbook, send link | ❌ | ❌ | ❌ | ✅ |
| Status changes, link check-in, no-show, ready SMS | ❌ | ❌ | ❌ | ✅ |
| Booking settings, services, hours, capacity | ❌ | ❌ | ❌ | ✅ |

Mechanics get **no** booking access (the staff PIN functions are unchanged and don't expose bookings).

## 2. New secrets (server-only)
| Env var | Where | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (prod + preview), `.env.local` | **New to this app.** Used only in `src/lib/booking/server.ts` (`import "server-only"`). Never `NEXT_PUBLIC_`. |
| `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY` | Vercel production only | Preview/dev run `SMS_MODE=log` |
| `SMS_MODE` | all | `live` only in production |
| `CRON_SECRET` | Vercel + the external scheduler | Sent as a Bearer token by Vercel Cron (retention) and by the external scheduler (dispatch, reminders) |
| `PUBLIC_BASE_URL` | all | Used to build SMS links (never taken from the request `Host` header) |
| `BOOKING_TOKEN_PEPPER` | not used | Tokens are 256-bit random, so a plain SHA-256 is enough |

`.env.example` gets the names only. Rotation: rotate in Supabase/ClickSend → update Vercel → redeploy.

## 3. Threats and controls
| Threat | Control |
|---|---|
| Anon reads or edits bookings directly with the public anon key | No anon grants on any booking table or function. RLS on. Test: anon `select`/`rpc` on every booking object → denied. |
| Spam bookings / SMS pumping (attacker books with victims' numbers to burn SMS credit) | Vercel BotID on `POST /api/booking`; Vercel WAF rate limit (5/min/IP on booking + manage routes); DB limit 3 active bookings per mobile; 5 `booking_link` SMS per mobile per day; daily SMS cap alert (> 100/day, `PROPOSED`); AU mobiles only (`+614`) |
| Over-capacity race | Advisory lock + count inside the transaction; race test |
| Guessing manage links | 32 random bytes (`gen_random_bytes`); lookups use the SHA-256 on `bookings`; 404 for anything invalid; token expires 7 days after drop-off; rate-limited; `no-referrer` |
| Raw tokens at rest | Kept only in `booking_tokens` (decided 2026-11-05 so reminder/rescheduled SMS can carry the link): service_role only, no owner/anon grants, not on Realtime, deleted at drop-off + 7 days. Anyone with the service-role key could read them, but that key can already change any booking |
| Token leaks in logs | Route handlers never log paths under `/b/` or `/api/booking/manage/`; Vercel log drains filtered |
| Token stored in plain text in `sms_outbox.body` (owner-readable, on Realtime) | Resolved in T2: bodies store a `{manage_link}` placeholder; the dispatcher (T3) builds the link at send time from `PUBLIC_BASE_URL` + `booking_tokens`. Test: the confirmation body never contains the token |
| Manage page shows too much | Only first name, rego, make/model, services, date, status. No surname, mobile, email or notes |
| Owner actions forged by a mechanic on the shared computer | Bookings live under `/dashboard`, which needs the owner login, plus the existing PIN lock screen and auto-lock |
| Kiosk check-in broken by a booking bug | Booking triggers on `checkins` catch all errors and never raise |
| SMS injection / spoofed links | Templates built server-side; user fields stripped of control chars and URLs; capped length; links built from `PUBLIC_BASE_URL` |
| Clickjacking | `/book` → `Content-Security-Policy: frame-ancestors *`; every other route → `frame-ancestors 'none'` + `X-Frame-Options: DENY` (set in `next.config.ts` headers). Check the kiosk still works after adding these |
| Cron endpoints called by anyone | Bearer `CRON_SECRET`, constant-time compare, 401 otherwise |
| Someone gets a second Supabase Auth account → full access (because `authenticated` = owner, policies are `using (true)`) | Keep "Allow new users to sign up" **and anonymous sign-ins** off (anonymous users also get the `authenticated` role). Checked 2026-11-05 on staging + production via `/auth/v1/settings`: both off. Re-checked in the launch checklist. Torvio (multi-tenant) must replace `using (true)` with a real owner/tenant check |
| Personal data in errors/monitoring | No mobiles, names, notes or tokens in logs or error messages |

## 4. Personal data
- New data: name, mobile, optional email, rego/vehicle, notes for each booking. Purpose: managing the booking and sending booking SMS.
- Stored in the same Supabase project (Sydney). ClickSend (AU) receives the mobile + message text.
- Privacy policy link on `/book`: `TBD` (owner's website privacy page, or a simple page in this app).
- Deletion requests: owner deletes the customer's bookings (the existing Data tab is extended).

## 5. Needs careful human review before merge
`booking.sql` grants/revokes and every `security definer` function, the advisory-lock create/reschedule, token generation and lookup, the triggers on `checkins`, the service-role client, cron auth, the headers change in `next.config.ts`, and the ClickSend client.
