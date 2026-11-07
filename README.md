# Sai Motor Works – Digital Customer Check-in

Replaces the paper check-in form at the front counter with:

| Route | Who uses it | What it does |
|---|---|---|
| `/` | Anyone | Portal: Customer iPad Form, Owner Dashboard, Staff Login |
| `/kiosk` | Customers (front iPad) | Touch-friendly check-in form (contact + vehicle details, no signature) |
| `/jobs` | Workshop staff | Staff Job Sheet: shared staff PIN, then the job form (work carried out, faults, parts) |
| `/login` | Owner | Email + password sign-in, "Forgot password?" |
| `/login/reset` | Owner | Landing page for the password-reset email |
| `/dashboard` | Owner | Live check-in list, search, status/date filters, detail drawer |
| `/dashboard/[id]` | Owner | Check-in detail as a full page |
| `/dashboard/[id]/print` | Owner | A4 job sheet (opens the print dialog) |
| `/dashboard/history/[rego]` | Owner | Every visit for one vehicle |
| `/dashboard/jobs` | Owner | Running and past workshop jobs |
| `/dashboard/jobs/new`, `/dashboard/jobs/[id]` | Owner | Create / complete a job: times, prices, labour, invoice details |
| `/dashboard/jobs/[id]/print` | Owner | A4 job sheet in the paper form's layout |
| `/dashboard/settings` | Owner | Business Details · Security · Kiosk · Staff · Notifications · Data |

`/dashboard/*` is protected by `src/proxy.ts` (Next.js 16's renamed middleware): no session → redirect to `/login`. The real protection is Row Level Security in the database.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Radix/shadcn-style components · lucide-react · zod · bcryptjs · Supabase (Postgres, Storage, Realtime, Auth) · sonner toasts.

There is no demo or offline mode: the app needs a Supabase project. Without the two environment variables it shows a "Setup required" screen.

---

## 1. Supabase setup

1. Create a project at <https://supabase.com> (Region: **Sydney – ap-southeast-2**).
2. **SQL Editor → New query** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. It is safe to re-run, and it upgrades a database made from an earlier version. It creates:
   - `checkins` table (`SMW-1001…` reference sequence, `updated_at` trigger, indexes on created_at/status/rego/phone)
   - `settings` single-row table with defaults, and the public `kiosk_settings` view (no PIN, contact details or ABN)
   - `verify_pin()` (bcrypt via pgcrypto, 5 wrong attempts → 5-minute lockout) and `set_pin_hash()`
   - `kiosk_submit_checkin()` – the kiosk's only way in; returns just the reference number
   - `archive_completed_checkins()` for auto-archive
   - RLS: **anon = insert only** (through the function), **authenticated = select/update/delete**; anon has no access to `settings`
   - Storage buckets: private `signatures` (only for older check-ins – the kiosk no longer collects signatures), public-read `branding` (logo)
   - Realtime on `checkins`, `settings` and `settings_signal` (lets the kiosk pick up settings changes)
3. **Authentication → Users → Add user**: create the owner's login (email + password, tick *Auto confirm user*).
4. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up", so only the owner account can log in.
5. **Authentication → URL Configuration**: set **Site URL** to your live address (e.g. `https://checkin.saimotorworks.com.au`) and add `https://<your-domain>/login/reset` (and `http://localhost:3000/login/reset` for local testing) to **Redirect URLs**. This makes "Forgot password" emails link back to the app.
6. **Project Settings → API**: copy the Project URL and the `anon` public key.

## 2. Local development

```bash
npm install
cp .env.example .env.local   # paste the Project URL and anon key
npm run dev
```

Open <http://localhost:3000>.

## 3. First login and setting the PIN

1. Go to `/login` and sign in with the owner account from step 1.3.
2. Open **Settings (gear icon) → Business Details**: fill in business name, ABN, phone, email, address and hours. These print on job sheets.
3. **Settings → Security → Set up a PIN**: since no PIN exists yet, confirm with your password, then enter a 4–6 digit PIN twice.
   The PIN is hashed with bcrypt in the browser and only the hash is sent to the database (`set_pin_hash`). Checking a PIN (`verify_pin`) sends the digits over HTTPS to the database, which compares them against the hash; the PIN is never stored in plain text.
4. Choose the **Auto-lock** timeout (5 / 15 / 30 min / never). When it locks, the PIN unlocks it, or use "Use password instead". 5 wrong PINs sign you out completely.

The same PIN is needed to leave the kiosk through its "Staff Portal" link.

## 4. Logo

The logo is already in place:

| File | Used for |
|---|---|
| `design/logo.webp` | Master artwork (transparent background) |
| `public/logo.png` | Dark backgrounds: portal, kiosk header, thank-you, paused screen, dashboard header, lock screen |
| `public/logo-on-light.png` | White backgrounds: printed job sheet (lettering recoloured navy) |
| `src/app/favicon.ico`, `src/app/icon.png`, `src/app/apple-icon.png`, `public/icon-192.png`, `public/icon-512.png` | Favicon, home-screen and notification icons (spanner + car mark on navy) |

Everything goes through one component, `src/components/logo.tsx`. It uses, in order:
1. the logo uploaded in **Settings → Business Details** (Supabase Storage `branding` bucket, PNG/SVG/JPG up to 2 MB)
2. `/public/logo.png` (or `logo-on-light.png` on white)
3. the text "Sai Motor Works"

**Changing the built-in logo:** replace `design/logo.webp` (keep a transparent background), then regenerate the variants and icons (needs Python with Pillow):

```bash
pip install pillow
python3 design/make-icons.py design/logo.webp public
cp public/favicon.ico src/app/favicon.ico && cp public/apple-icon.png src/app/apple-icon.png && cp public/icon-512.png src/app/icon.png
```

`make-icons.py` crops the spanner/car mark using pixel positions for the current artwork; adjust the crop box in the script for a different logo.

## 5. Deploy to Vercel

1. Push this folder to GitHub.
2. Vercel → **Add New Project** → import the repo (framework is detected as Next.js).
3. Add environment variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` → **Deploy**.
4. Make sure the Supabase **Site URL** and **Redirect URLs** (step 1.5) use the Vercel domain.

Never put the `service_role` key in this app or in Vercel.

## 6. Front-counter iPad (Guided Access)

A web page can't stop someone pressing Home or swiping up – only iPadOS can. So the kiosk is locked down in two layers:

**What the app does by itself on `/kiosk`:** opens without browser bars when launched from the Home Screen (web app manifest, `start_url: /kiosk`), asks for full screen on the first tap when opened in a normal browser, blocks pinch/double-tap zoom, long-press menus, pull-to-refresh and the back swipe, and keeps the screen awake. Staff leave only through **Staff Portal → PIN**.

**What locks the iPad itself – do this once:**

1. On the iPad, open **Safari** → `https://<your-domain>/kiosk`.
2. Tap **Share → Add to Home Screen** → name it "Check-in" → **Add**. Always open it from this icon: it starts on the kiosk with no address bar, tabs or back button.
3. **Settings → Display & Brightness → Auto-Lock → Never** (keep the iPad on its charger).
4. **Settings → Accessibility → Guided Access** → turn **on**.
   - **Passcode Settings → Set Guided Access Passcode** (a code only staff know). Optionally enable Face ID / Touch ID.
   - **Display Auto-Lock → Never.**
5. Open the **Check-in** icon, then **triple-click the top (or Home) button** → **Guided Access**.
   - Tap **Options**: turn **off** *Sleep/Wake Button*, *Volume Buttons* and *Time Limit*; keep *Touch* and *Keyboards* **on**.
   - Tap **Start**. Swipe-up, Home, notifications, Control Center and app switching are now disabled.
6. To exit: triple-click → enter the Guided Access passcode → **End**.

Optional: Guided Access can also block the Staff Portal button – on the Guided Access setup screen, circle it with your finger to make it untouchable. Staff then use triple-click + passcode instead.

Kiosk behaviour (all adjustable in **Settings → Kiosk**, applied live without reloading the iPad):
- Welcome title/subtitle, consent wording, quick-select make chips (add, remove, drag to reorder).
- Show/hide Year, Colour, Odometer; Email required or optional.
- Thank-you screen with reference number (`SMW-1001`…), resets after 8 s by default.
- After 3 min idle (default) a 15-second "Are you still there?" prompt appears, then the form clears.
- **Reset** clears everything after a confirmation.
- **Accept check-ins** off → full-screen "Check-in is currently unavailable…" message (editable).
- **Staff Portal** asks for the owner PIN (5 wrong → 5-minute lockout). If no PIN is set yet it goes to the staff login.
- The kiosk can only insert check-ins; it never reads anyone's records.

## 7. Dashboard

- **Header:** logo, Owner Dashboard badge, Live / Reconnecting… indicator, bell with unread count (opens a list; opening a record marks it read), Refresh, Open iPad Kiosk, Settings, Lock, Logout.
- **Real-time:** a new check-in slides in at the top with a highlight, chimes (Settings → Notifications: on/off + 3 chimes), shows a toast `New check-in: First Last – REGO`, and a browser notification if enabled. After a dropped connection it reconnects and re-syncs.
  Browsers only play sound after you've clicked the page once.
- **Filters:** stat cards and status pills, search (name, phone, email, rego, make, model, reference), date range (Today / This Week / This Month / Custom), Show archived.
- **Returning customer** badge when the rego or mobile matches an earlier check-in.
- **Detail:** tap-to-call / email, signature + signed time (older check-ins only), status (instant), internal notes (autosave + "Saved"), Archive, View vehicle history, Print Job Sheet.
- **Job sheet:** A4 with logo, business name/ABN/address/phone/email from Settings, reference, date, customer, vehicle, signature (older check-ins) and ruled technician-notes lines.

## 8. Workshop jobs (Staff Job Sheet)

Replaces the paper job sheet.

**Set up once (owner):** Dashboard → **Settings → Staff**
1. Add each employee's name (they pick it from a dropdown on the job sheet).
2. Set the **staff PIN** – one shared 4–6 digit PIN for the team, different from the owner PIN.

**Staff (on a workshop tablet or PC):** open `/jobs` (or the **Staff Job Sheet** card on the portal) → enter the staff PIN → fill in:
- your name (dropdown)
- vehicle details: rego, make, **model**, **KMs** (required), type, VIN, year, colour
- work carried out: tap the common jobs at the top (Logbook Service, Brake Pads – Front, Pink Slip Inspection…) or type lines, then pick **Hours taken** (30 min to 12 hours in half-hour steps)
- additional faults found
- parts used: tap the common parts at the top (Engine Oil, Oil Filter, Air Filter…) or add your own, then set the quantity

Staff don't enter customer details. When the job links to a check-in (see below), the customer's name, phone and email are copied from it; the owner can add or edit them on the dashboard. The quick-pick lists are in `src/lib/jobs.ts` (`COMMON_WORK`, `COMMON_PARTS`).

→ **Save Job Sheet**. Staff can't see prices, times, invoice numbers or other jobs. The sheet re-locks after 15 minutes idle; 5 wrong PINs lock it for 5 minutes.

**Owner:** Dashboard → **Jobs** (left-hand menu, or the tabs on an iPad/phone).
- New job sheets appear instantly with a toast and chime; the badge shows unread jobs.
- Filter by Running / New / In Progress / Completed / Cancelled, by employee, or search.
- Open a job to edit anything and add the owner-only details: status, time in/out (total hours is worked out from these; otherwise the staff's "Hours taken" is used), price of each part, labour, PO number, tax invoice number, date invoice sent, owner notes. Totals are calculated.
- **Print** gives an A4 sheet in the same layout as the paper form. **New job** lets the owner create one directly.

**Assigning work to a mechanic.**
- *From a check-in:* open it on the dashboard → **Assign mechanic** → pick the mechanic (from Settings → Staff), add instructions if you like ("Logbook service, quote rear tyres") → **Assign**. The check-in list shows a chip with their name; **Unassign** takes it back.
- *On the Staff Job Sheet:* after the staff PIN, each person taps their name and sees **Assigned to you** – rego, make/model and your instructions (no customer contact details). Tapping a car opens the job sheet already filled with the car details and linked to that check-in; once saved, it drops off their list. They can still start a blank sheet.
- *Existing jobs:* change the **Mechanic** dropdown in the job page header. A linked check-in's assignment follows.
- Only the assigned mechanic can save a job sheet against an assigned car (checked in the database).

**Jobs ↔ check-ins.** When a job is saved (by staff or the owner), it is linked automatically to the most recent check-in for the same rego from the last 7 days that isn't Completed or Cancelled. That check-in then follows the job:

| Job status | Linked check-in becomes |
|---|---|
| New / In Progress | In Progress |
| Completed | Completed |
| Cancelled | Cancelled |

The job page shows the linked check-in (with **Open check-in**) and a dropdown to link a different one or unlink; the check-in shows a job chip in the list and a **Workshop job** section in its detail. The link is one-way: changing a check-in's status by hand doesn't change the job. Jobs saved before this was added aren't linked – link them from the job page if needed.

Security: staff have no access to the `jobs` table. They can only call `staff_unlock` / `staff_submit_job`, which check the staff PIN every time, ignore any price fields and only accept names from the Staff list.

## 9. Data

- **Export CSV** (Settings → Data): date range + status, archived included. Cells that look like formulas are escaped.
- **Auto-archive** completed jobs after N months. Runs when the dashboard opens. To also run it nightly, enable the `pg_cron` extension and run:
  ```sql
  select cron.schedule('archive-completed', '0 3 * * *', 'select public.archive_completed_checkins()');
  ```
- **Delete a customer's records** for privacy requests: search, tick records, confirm twice (type `DELETE`). Removes the rows and their signature images.

## 10. Email alert on each new check-in (optional)

Code: [`supabase/functions/notify-checkin`](supabase/functions/notify-checkin/index.ts). Uses [Resend](https://resend.com); without an API key it only logs.

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy notify-checkin --no-verify-jwt
supabase secrets set WEBHOOK_SECRET=<long-random-string> RESEND_API_KEY=re_xxx \
  ALERT_FROM_EMAIL="Sai Motor Works <alerts@your-verified-domain.com.au>" \
  DASHBOARD_URL=https://<your-domain>/dashboard
```

Then in Supabase → **Database → Webhooks → Create a new hook**: table `checkins`, event **Insert**, type **Supabase Edge Functions** → `notify-checkin`, add HTTP header `x-webhook-secret: <same long-random-string>`.
Finally turn on **Settings → Notifications → Email alert for each check-in**. Alerts go to the business email in Business Details.

## 11. Notes on the spec

- There was no `/design` folder of mock-ups, so the existing screens are the visual reference and new screens (settings, lock screen, PIN pad, history, print, paused) use the same tokens in `src/app/globals.css` (Tailwind v4 uses CSS `@theme` tokens instead of `tailwind.config.ts`).
- Status is stored as a Postgres enum (`checkin_status`) rather than `text` + check; same values.
- `checkins.returning_customer` is an extra column, set by the database at insert time.
- Kiosk settings sync uses a tiny `settings_signal` table, because a view can't be watched over Realtime and anon must not read `settings`.
- Form validation uses zod schemas (`src/lib/validation.ts`) with controlled inputs; react-hook-form was not needed.
- The check-in detail opens in a drawer from the list and also has its own page (`/dashboard/[id]`).

## 12. Project structure

```
src/
  proxy.ts                      Redirects /dashboard/* to /login without a session
  app/                          Each client screen is client-page.tsx behind a thin server page.tsx
    page.tsx                    Portal
    kiosk/kiosk-form.tsx        Customer check-in form
    jobs/                       Staff Job Sheet (staff PIN gate + form)
    login/, login/reset/        Owner login, password reset
    dashboard/layout.tsx        Wraps every dashboard page in DashboardShell
    dashboard/page.tsx          Overview + list + drawer
    dashboard/[id]/…            Detail page, print job sheet
    dashboard/history/[rego]/   Vehicle history
    dashboard/jobs/             Jobs list, new job, job detail, print
    dashboard/settings/         Tabbed settings
  components/
    logo.tsx, brand-provider.tsx   Logo + live public settings
    brand.tsx                   Status pill, NSW plate
    pin-pad.tsx, make-select.tsx, checkin-drawer.tsx
    dashboard/                  Shell (auth, auto-lock, realtime), side menu, header, lock screen, detail
    jobs/                       Job form (staff + owner modes), owner editor
    settings/                   One component per tab
    ui/                         Button, Input, Select, Switch, Modal, Sheet…
  lib/
    data.ts                     All Supabase access (the data layer)
    supabase.ts                 Browser client
    validation.ts, settings.ts, types.ts, csv.ts, chime.ts, utils.ts
supabase/
  schema.sql                    Tables, RLS, functions, storage, realtime
  functions/notify-checkin/     Email alert Edge Function
design/
  logo.webp, make-icons.py      Master logo + icon generator
```

## Scripts

```bash
npm run dev     # local development
npm run build   # production build
npm run start   # serve the production build
npm run lint
```
