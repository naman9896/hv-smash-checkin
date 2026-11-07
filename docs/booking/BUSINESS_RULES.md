# Booking — Business Rules

> Status: owner answers applied 2026-11-03 (proposal sign-off table). The contract: enforced in the database/server, not only the UI.
> `CONFIRMED` = owner/user agreed · `PROPOSED` = in the proposal, owner left it blank · `TBD` = unknown.
> All values below are **settings** the owner can change (`booking_settings` etc.) unless marked fixed.

## 1. Time and hours
- Timezone **Australia/Sydney** (fixed). Timestamps stored UTC; drop-off days stored as local `date`. Test the DST changeover days. `CONFIRMED`
- Trading hours: Mon–Fri 08:30–17:00, Sat 08:30–16:00, Sun closed. `CONFIRMED`
- Closed on NSW public holidays (seeded list); owner can open any of them or close any other date (e.g. Christmas shutdown). `CONFIRMED`
- **"Call us" on owner-closed days** (owner, 2026-11-05): when the owner closes a date himself, he chooses per date whether customers see his phone number on `/book` ("Not available online." then "Call the workshop" / **{phone}** as a tap-to-call link; phone = `settings.phone`, currently **1300 017 205** per the owner). Off by default. Never shown for public holidays, Sundays (weekly closed days) or full days. The owner's reason for closing stays private. `CONFIRMED`

## 2. Booking model
- Customers book a **drop-off day**, not a work time. `CONFIRMED`
- Drop-off window **08:30–09:30** (one window). `CONFIRMED`
- Pickup message: "From 3pm, we'll SMS you when it's ready." `CONFIRMED`
- Customers never choose a mechanic; the owner assigns after check-in (existing flow). `CONFIRMED`
- **No "I'll wait" option.** Owner: not required. `CONFIRMED`
- One or more services per booking. `CONFIRMED`

## 3. Services
| Service | Price shown | Status |
|---|---|---|
| Basic service | From $160 | `CONFIRMED` |
| Logbook service | Price on inspection | `CONFIRMED` |
| Brakes | Price on inspection | `CONFIRMED` |
| Tyres | Price on inspection | `CONFIRMED` |
| Pink slip (e-Safety check) | Price on inspection (owner: no price shown) | `CONFIRMED` |
| Diagnostics / warning light | Price on inspection | `CONFIRMED` |
| Air-con | Price on inspection | `CONFIRMED` |
| General repair (describe the problem) | Price on inspection | `CONFIRMED` |

- Price types: `fixed` ($X), `from` (from $X), `quote` (price on inspection). Cents, AUD, GST-inclusive.
- Prices are indicative; no payment in this version. The booking page shows: "Final price depends on your vehicle and the work needed. We'll contact you before doing any extra work."
- Services are never hard-deleted once used (deactivate instead).

## 4. Capacity
- Capacity = **cars per drop-off day**: **10 Mon–Fri, 8 Sat** `CONFIRMED`. Owner changes it in Settings → Online Booking (per weekday, plus per-date override). An open day must have a capacity of at least 1 (T8: the form asks "How many cars?" and the DB refuses 0).
- A day is **full** when active bookings (`booked`, `arrived`, `completed`) ≥ capacity. `cancelled` and `no_show` free the spot.
- Online bookings cannot exceed capacity. The **owner** can overbook (phone/walk-in) with an explicit "over capacity" confirmation; recorded on the booking.
- Walk-ins without a booking don't count against capacity (they use the kiosk as today). `PROPOSED`

## 5. Booking limits (online)
- Up to **30 days** ahead. `CONFIRMED`
- No same-day online bookings. Booking for **tomorrow** closes at **17:00 today**. `CONFIRMED`
- One active booking per rego per day. Max **3** active future bookings per mobile number (abuse limit).
- Owner bookings: same-day allowed, cutoffs ignored, horizon ignored.

## 6. Over-capacity race
Two customers must never both get the last spot. `create_booking` / `reschedule` take a transaction-scoped advisory lock on the drop-off date, count, then insert. Test: race 10 parallel requests for 1 spot (capacity set low in the test) → exactly 1 succeeds, 9 get `FULL`.

## 7. Booking status
`booked → arrived → completed`, plus `cancelled` and `no_show`.

| Change | Who / what | Side effect |
|---|---|---|
| (new) → booked | Customer online, owner | Confirmation SMS |
| booked → cancelled | Customer (before cutoff), owner (any time) | Cancellation SMS (owner may untick "notify") |
| booked → booked (new date) | Customer (before cutoff), owner | Rescheduled SMS |
| booked → arrived | **Trigger** when a kiosk check-in matches (§8), or owner "Mark arrived" / link check-in manually | — |
| arrived → completed | **Trigger** when the linked check-in becomes `completed` (via its job), or owner | None by default: the owner sends the ready SMS with the **Send ready SMS** button (§10) |
| booked → no_show | Owner, on/after the drop-off day | — |
| Undo (any → booked/arrived) | Owner only | No SMS; recorded in booking events |
- Linked check-in becomes `cancelled` → booking unchanged; owner decides.
- **Owner rules (decided 2026-11-06, T4):**
  - Owner cancel and reschedule work only on `booked` bookings. Once a car has arrived, undo "arrived" first (so a car in the workshop never gets a "cancelled" SMS).
  - Undo is one step back: arrived → booked, completed → arrived, no_show → booked, cancelled → booked. No SMS.
  - Re-opening a cancelled / no-show booking takes its spot back: the same rego already booked that day → refused; a day that has since filled → allowed and flagged overbooked.
  - Undo back to `booked` also removes the check-in link (fixes a wrong link in one step).
  - No-show only on or after the drop-off day. "Mark arrived" any day (early drop-offs). Linking a check-in to a `booked` booking marks it arrived.
  - Rescheduling cancels unsent confirmation / reminder / rescheduled SMS for the old date; the reminder is once per booking per date.

## 8. Matching kiosk check-ins to bookings
- On every new check-in, find a booking with `drop_off_date = today (Sydney)`, status `booked`, and the **same rego** (normalised: uppercase, letters/digits only) — else the **same mobile** (digits only, `+61`/`0` normalised). If several match, take the earliest created.
- Match → `bookings.checkin_id` set (the only link; `checkins` has no booking column), booking → `arrived`. Rego beats mobile.
- No match → nothing happens (walk-in). Owner can link manually from the booking or the check-in.
- Bookings not arrived by 17:00 on their day show as **"Not arrived"** on the dashboard; owner marks `no_show` or reschedules. No automatic action.

## 9. Cancellation and rescheduling (customer)
- Via the private link in the SMS, until **17:00 the day before** drop-off. After that the page says "Please call us on {phone}". `CONFIRMED`
- Reschedule uses the same rules as a new online booking. The link stays the same.
- The page shows only first name, rego, make/model, services, date, window and status. Cancelled bookings still open (as "Booking cancelled" + "Book again") until drop-off + 7 days.
- A customer cancel or reschedule marks the booking unread, so it shows in the owner's Bookings badge (decided 2026-11-06, T7); the history says "Customer cancelled from their link".
- No fees. Staff see the customer's previous no-show count (by mobile): on the day list ("1 no-show before"), the booking page and quick add. `CONFIRMED`

## 10. SMS
| Template | When | Draft text |
|---|---|---|
| `confirmation` | On booking | "Hi {first}, you're booked at Sai Motor Works for {Day D Mon}, drop off {8:30–9:30am}. {services}. Manage: {link}" |
| `reminder` | **10:00** day before, for `booked` bookings made before that time | "Reminder: {rego} is booked at Sai Motor Works tomorrow, drop off {window}. {address}. Manage: {link}" |
| `ready` | Owner presses **Send ready SMS** (booking or check-in, incl. walk-ins) | "Hi {first}, your {rego} is ready for pickup at Sai Motor Works. We're open until {close}." |
| `cancelled` | Booking cancelled (if notify) | "Your booking for {date} at Sai Motor Works is cancelled. To rebook: {booking page}" |
| `rescheduled` | Date changed | "Your booking at Sai Motor Works is now {date}, drop off {window}. Manage: {link}" |
| `booking_link` | Owner "Send booking link" (Option B, `CONFIRMED`) | "Hi, book your service with Sai Motor Works here: {booking page}" |

- Sender ID **"SaiMotor"** (≤ 11 chars). `CONFIRMED`
- No SMS for delays or waiting on parts. `CONFIRMED`
- A booking made for tomorrow after 10:00 gets no reminder (the confirmation is recent).
- Each template sent at most once per booking per event (dedupe key), except `rescheduled` (once per change).
- Customer fields put into SMS are sanitised (control chars removed, length-capped).
- Failure: up to 3 attempts in all. A retryable failure (network, provider 429/5xx) waits 1 min after the 1st try and 5 min after the 2nd; the 3rd failure, or any non-retryable one (e.g. invalid number), → `failed` + warning badge on the booking; owner can retry. (T3: the "30 min" step from the first draft doesn't fit a 3-attempt cap, so it is unused.)
- Stale SMS are cancelled, not sent: SMS turned off in Settings; confirmation/reminder/rescheduled for a booking no longer `booked`; a reminder whose drop-off day has come; a link SMS whose token has expired.
- Transactional only, no marketing (Spam Act 2003).
- Never send real SMS outside production (`SMS_MODE=log`).
- **Ready SMS is button-only** (`ready_sms_mode = manual`, default). Marking the job Completed sends nothing; the owner presses **Send ready SMS** when the car is really ready. `CONFIRMED`
- The button is on the booking detail **and** on the check-in drawer, so it works for **walk-ins** with no booking too. A walk-in uses the check-in's first name and phone; if that phone isn't an Australian mobile (`04…`/`+614…` after normalising), the button is disabled with "Not a mobile number". `CONFIRMED`
- If a ready SMS was already sent for that car, the button asks "Send again?" (each resend gets its own dedupe key).
- Setting `on_complete` (owner can switch it on later) also sends it automatically when a linked booking's check-in becomes `completed`.

## 11. Customer and vehicle details at booking
- Required: first name, last name, Australian mobile (`04xx xxx xxx`, stored E.164 `+614…`), rego (≤ 9, normalised), state, make, model. `CONFIRMED`
- Optional: email, year, notes ("Anything we should know?", ≤ 1000 chars).
- Make uses the existing make dropdown (`src/lib/vehicle-makes.ts`).

## 12. Phone bookings (owner)
- **Quick add** from the owner's phone: type mobile → if a previous booking or check-in has that mobile, name + vehicle pre-fill → choose services and day (shows spots left) → save → confirmation SMS (owner can untick). `CONFIRMED (need)`
- **Send booking link** (Option B): owner enters a mobile → `booking_link` SMS. Max 5 per mobile per day. `CONFIRMED` (owner wants both quick-add and send link)

## 13. Edge cases
- Owner closes a date that has bookings → warning lists them; owner cancels/reschedules each (SMS sent).
- Job runs over to the next day → booking stays `arrived`; capacity counts only its original day.
- Wrong mobile → SMS fails → warning on the booking.
- Customer books twice for the same rego/day → rejected with a friendly message and the existing booking's date.

## 14. Data retention
- Bookings kept like check-ins (existing archive/delete tools extended to bookings). Customer deletion request → owner deletes their bookings.
- `sms_outbox` rows kept 2 years, then deleted by the daily cron.
