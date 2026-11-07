# Booking — API Spec

> Status: DRAFT 2026-11-02. **If it is not in this file, it should not exist.**
> Two kinds of entry point:
> - **Route handlers** (`src/app/api/booking/**`, server only, `import "server-only"`). They use the service-role client from `src/lib/booking/server.ts`. These serve the public and cron.
> - **Owner RPCs**, called from the dashboard with the existing browser client (`getSupabase()`), protected by the `authenticated` grant + RLS.

## Conventions
- Input validated with **Zod `.strict()`** in the route handler (shared schemas in `src/lib/booking/schemas.ts`), and again in the DB function (types, lengths, regex).
- Errors: `{ error: { code, message } }`. Codes: `VALIDATION` 400 · `NOT_FOUND` 404 (bad or expired token, unknown service) · `FULL` 409 · `DUPLICATE_BOOKING` 409 · `CLOSED` 422 · `CUTOFF_PASSED` 422 · `OUTSIDE_HORIZON` 422 · `MOBILE_LIMIT` 422 · `INVALID_TRANSITION` 422 · `RATE_LIMITED` 429 · `BOOKING_OFF` 503.
- Messages are friendly and shown to the customer; no stack traces or SQL.
- Dates `YYYY-MM-DD` (Sydney); times `HH:MM`.
- Tokens only in the URL path `/b/{token}` (43-char base64url). That page sends `Referrer-Policy: no-referrer`.

## 1. Public (no login) — route handlers
| Method | Path | Checks | Input | Output | Errors |
|---|---|---|---|---|---|
| GET | `/api/booking/info` | `online_enabled` | — | `{business{name,phone,address}, services[{id,name,description,priceType,priceCents}], windows[{id,start,end}], pickupMessage, priceDisclaimer, hours[]}` | 503 `BOOKING_OFF` (body also has `business` so the page can show the phone) |
| GET | `/api/booking/availability?from&to` | range ≤ 31 days, inside horizon | `AvailabilityQuery` | `days[{date, status: open\|full\|closed, spotsLeft, callUs}]` (spotsLeft only as "few left" when ≤ 2 — exact counts not needed publicly; `callUs` from `call_us`, the phone itself comes from `/info`. Never the override reason) | 400 |
| POST | `/api/booking` | BotID check · rate limit (Vercel WAF: 5/min/IP; DB: mobile limit) · all BUSINESS_RULES §4–5 · advisory lock | `PublicCreateBooking {serviceIds[1..5], date, windowId, customer{firstName,lastName,mobile,email?}, vehicle{rego,state,make,model,year?}, notes?}` | 201 `{referenceNo, date, window{start,end}, manageUrl}`; confirmation SMS queued (dispatch kick via `after()` added in T3). Body ≤ 10 KB. `VALIDATION` errors carry `issues[{path, message}]` for inline errors. Unknown DB errors → 500 `SERVER_ERROR`, no details | 400, 409 FULL / DUPLICATE_BOOKING (message names the existing date), 422, 429, 503 |
| GET | `/api/booking/manage/{token}` | token format (43-char base64url, else 404 without a DB call), hash match, not older than drop-off + 7 days | — | `{referenceNo, firstName, rego, make, model, services[], date, window{start,end}, status, canChange, changeUntil, business{phone}}` (`changeUntil` = Sydney `YYYY-MM-DDTHH:MM`, 17:00 the day before; added T7 so the page can say "until 5pm Thursday 19 November") | 404, 429 |
| POST | `/api/booking/manage/{token}/cancel` | status `booked`; before cancel cutoff | — | same view as GET; `cancelled` SMS queued + dispatch kick; booking set unread for the owner | 404, 422 CUTOFF_PASSED / INVALID_TRANSITION, 429 |
| POST | `/api/booking/manage/{token}/reschedule` | status `booked`; before the booking's cutoff (`CUTOFF_PASSED`, "too late to change this booking"); new date passes all online rules (no overbooking); same day + window → `INVALID_TRANSITION`; lock | `Reschedule {date, windowId}` (strict, body ≤ 1 KB) | same view as GET; `rescheduled` SMS queued + dispatch kick; set unread | 400, 404, 409 FULL / DUPLICATE_BOOKING, 422, 429 |

All three send `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` (also set for `/b/*` and these routes in `next.config.ts`). 429 comes from the Vercel WAF rule (T9); there is no DB rate limit on these. Errors use link-specific messages (`manageErrorMessage`). The page `/b/[token]` reads the token behind Suspense, so a bad link shows "This link isn't valid" with HTTP 200 + noindex (Next streaming fixes the status); the API gives the real 404.

Pages: `/book` (multi-step form, the only frameable route), `/b/[token]` (manage page, server component calling the same server functions).

## 2. Owner (dashboard, `authenticated`) — RPC / table access
| Call | Checks | Input | Output |
|---|---|---|---|
| `select` bookings + items (by `drop_off_date` range / status / search) | RLS | — | rows (Realtime subscription for live updates + chime, like check-ins) |
| `update bookings set owner_notes / is_read` | column grants | — | row |
| `rpc booking_availability(from, to, false)` | — | dates | days with exact counts |
| `rpc booking_customer_lookup(mobile)` | mobile format (`VALIDATION`, detail `mobile`) | mobile (any format) | `{firstName, lastName, email, vehicles[{rego,state,make,model,year}], noShows}` or null. From bookings and kiosk check-ins with that mobile (check-in phones normalised); name from the newest, up to 5 cars (check-in cars have `state: null`) |
| `rpc booking_owner_create(p jsonb, allow_over bool, send_sms bool)` | same rules minus online cutoffs/horizon; capacity unless `allow_over`. Validated first in the browser with `PublicCreateBooking` | booking fields (`toDbInput`) | `{id, reference_no, date}`; saved `is_read = true` (no badge for the owner's own bookings); no token returned to the browser (the SMS carries it) |
| `rpc booking_owner_cancel(id, notify)` | status `booked` (BUSINESS_RULES §7 owner rules); notify → `cancelled` SMS with `{booking_page}` (filled at send time) | | `{id, status}` |
| `rpc booking_owner_reschedule(id, date, windowId, allow_over, notify)` | status `booked` | | booking |
| `rpc booking_owner_set_status(id, status)` | BUSINESS_RULES §7 table + owner rules; errors `INVALID_TRANSITION` (detail `from>to` or `not_yet`), `DUPLICATE_BOOKING` | `arrived`\|`completed`\|`no_show`\|`booked` (undo) | `{id, status}` |
| `rpc booking_link_checkin(id, checkinId \| null)` | booking booked/arrived/completed; check-in not linked to another booking (`VALIDATION`, detail `checkin_id`); null unlinks | | `{id, status, checkin_id}` |
| `rpc booking_send_ready_sms(id, resend bool)` | status `arrived` or `completed` (any `ready_sms_mode`); if a ready SMS was already sent, requires `resend = true` (else `INVALID_TRANSITION` detail `already_sent`; the UI then asks "Send again?"); SMS off → `VALIDATION` detail `sms_off` | | `{id}` (outbox row id) |
| `rpc booking_checkin_ready_sms(checkinId, resend bool)` | check-in not `cancelled`; phone normalises to `+614…` else `VALIDATION` ("Not a mobile number"); if linked to a booking, same as above; already sent → requires `resend` (detail `already_sent`); non-mobile → detail `not_mobile` | | `{id}` |
| `rpc booking_retry_sms(outboxId)` | status `failed` | | outbox row |
| `rpc booking_send_link(mobile)` | 5/mobile/Sydney day (advisory lock, `RATE_LIMITED`); not a mobile / SMS off → `VALIDATION` (detail `mobile` / `sms_off`) | mobile | `{queued: true}`; body has `{booking_page}`, dedupe `link:{mobile}:{date}:{n}` |
| Booking settings: `select/update booking_settings`, `insert/update booking_services`, `update booking_weekly_hours`, `insert/update/delete booking_windows`, `insert/update/delete booking_date_overrides` | RLS + check constraints (T8 adds: an open weekday / open override needs capacity ≥ 1); closing a date with bookings (or cutting its capacity below them) lists them first via `rpc booking_on_date(date)`; the owner then confirms or goes back. Forms validated in the browser with `src/lib/booking/settings.ts` (Zod `.strict()`), then by the DB | | rows |

Owner SMS sends are picked up by the cron dispatcher (≤ 1 min). If faster sending is wanted, add `POST /api/booking/sms/kick` (requires the owner's Supabase session, verified server-side) — `TBD`, not needed for v1.

## 3. System (cron) — route handlers
| Method | Path | Auth | Does |
|---|---|---|---|
| GET | `/api/booking/cron/dispatch` | `Authorization: Bearer ${CRON_SECRET}` (constant-time compare; a missing or < 16-char secret refuses everything) | Every minute: claim ≤ 50 due `pending` rows (stale ones cancelled in the DB), fill `{manage_link}` from `PUBLIC_BASE_URL` + token and `{booking_page}` with `PUBLIC_BASE_URL/book`, send via provider (5 at a time), record results. `{ok, result:{claimed, sent, failed}}`; 401 / 500 without details |
| GET | `/api/booking/cron/reminders` | `CRON_SECRET` | Every 15 min: if Sydney time ≥ `reminder_time`, `booking_enqueue_reminders()` (idempotent) |
| GET | `/api/booking/cron/retention` | `CRON_SECRET` | Daily 03:00: `booking_retention()` |

Schedules (Vercel is on the Hobby plan, which allows only daily cron jobs):
- **External scheduler** (e.g. cron-job.org) calls dispatch every minute and reminders every 15 min, as `GET https://<PUBLIC_BASE_URL>/api/booking/cron/...` with header `Authorization: Bearer <CRON_SECRET>`. Treat any non-200 as a failure and alert on it.
- **`vercel.json`**: retention only, `0 16 * * *` (UTC = 03:00 Sydney AEDT; Hobby runs it some time within that hour).
- If the project moves to Vercel Pro, dispatch and reminders can move back into `vercel.json` with the same routes.

## 4. SMS provider interface (`src/lib/booking/sms/`)
```ts
interface SmsProvider { send(to: string, body: string, senderId: string): Promise<{ ok: true; id: string } | { ok: false; error: string; retryable: boolean }> }
```
`clicksend.ts` (REST v3 `POST /v3/sms/send`, Basic auth `CLICKSEND_USERNAME:CLICKSEND_API_KEY`, 10 s timeout; 429/5xx/network → retryable, other 4xx and per-message errors like `INVALID_RECIPIENT` → not), `log.ts` (logs only length + id, never the mobile or text). `provider.ts`: `live` only when `SMS_MODE=live` **and** `NODE_ENV=production` **and** (`VERCEL_ENV` unset or `production`), so preview deployments can never send. `dispatch.ts` is pure (unit-tested), `run.ts` wires it to the DB. `POST /api/booking` also runs a 10-row dispatch in `after()`.
