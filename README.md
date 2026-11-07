# Customer Check-in – Hunter Valley Smash & Repair

A front-counter iPad check-in for a smash repair shop, plus a real-time owner dashboard.

- **`/kiosk`**: customers enter their details, vehicle and repair details, and sign. They get a reference number (`HVS-1001`…).
- **`/dashboard`**: the owner sees every check-in the moment it's submitted. They can search, filter, change status, copy details, add notes, print a check-in sheet and export CSV.
- **`/login`**: owner sign-in (Supabase Auth). A PIN locks the dashboard after idle and is needed to leave the kiosk.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Realtime, Storage) · Zod · Vercel.

## Branding

Everything that identifies the business is in **[`config/business.ts`](config/business.ts)**: name, short name, tagline, location, contact defaults, reference prefix, logo path, theme colours and kiosk wording. The root layout turns the colours into CSS variables, so Tailwind classes like `bg-primary` follow them.

Logo and icons are generated from `design/logo-source.jpg`:

```bash
node design/make-icons.mjs design/logo-source.jpg   # writes public/logo.png, icons, favicon
```

Two places can't import the config file:
- The migration repeats the reference prefix (`'HVS-'`).
- The email edge function reads the name from its `BUSINESS_NAME` secret.

## Kiosk form

| Section | Fields |
|---|---|
| Customer (required) | Full name, email, phone (Australian mobile or landline) |
| Vehicle | Make *, model *, year (optional, 1950 – next year) |
| Job (optional) | Job type: Insurance / Private. Insurance company and claim number appear only for Insurance. Damage description (max 500 characters, with a counter) |
| Signature (required) | Finger / Apple Pencil signature pad |

Validation runs in three places, all with the same rules:
1. **In the browser**, with `checkinFormSchema` in `src/lib/validation.ts`. Errors show inline.
2. **In `POST /api/checkin`**, with `checkinRequestSchema`, which is the same schema plus the signature. It's `.strict()`, so unknown fields are rejected. The signature must be a real PNG of 512 KB or less.
3. **In the database.** `kiosk_submit_checkin` and the table's `CHECK` constraints check everything again.

Phone numbers are stored as digits only (`0403343004`) and shown formatted (`0403 343 004`, `02 4932 4551`). Switching from Insurance to Private clears the insurer and claim number, and the server and database drop them too unless the job is Insurance.

After a successful submit, a thank-you screen shows the reference number and resets after 5 seconds (adjustable in Settings → Kiosk).

## 1. Supabase setup (new project)

1. Create a project at <https://supabase.com> (Region: **Sydney – ap-southeast-2**).
2. **SQL Editor → New query**: paste all of [`supabase/migrations/0001_checkin.sql`](supabase/migrations/0001_checkin.sql) and click **Run**. Alternatively, run `supabase db push`. It creates:
   - `checkins`, with CHECK constraints on every field, an `HVS-` reference sequence and an `updated_at` trigger.
   - `settings` (one row), `settings_signal`, `pin_guard`, and the `kiosk_settings` view (no PIN, contact details or ABN).
   - `kiosk_submit_checkin()`: the kiosk's only way in. It checks the signature was uploaded and returns only the reference number.
   - `verify_pin()` / `set_pin_hash()` (bcrypt, 5 wrong attempts → 5-minute lockout) and `archive_completed_checkins()`.
   - RLS and grants:
     - **anon** can only call `kiosk_submit_checkin` / `verify_pin`, read `kiosk_settings`, and upload a signature.
     - **authenticated** (the owner) reads everything. Of the check-in fields, they can only update status, notes, read and archived.
   - A private `signatures` storage bucket (PNG, 512 KB).
   - Realtime on `checkins`, `settings` and `settings_signal`.
3. **Authentication → Users → Add user**: create the owner's login (tick *Auto confirm user*).
4. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
5. **Authentication → URL Configuration**:
   - Set **Site URL** to the live address.
   - Add `https://<your-domain>/login/reset` and `http://localhost:3000/login/reset` to **Redirect URLs**.
6. **Project Settings → API**: copy the Project URL and the `anon` public key.

## 2. Local development

```bash
npm install
cp .env.example .env.local   # paste the Project URL and anon key
npm run dev
```

## 3. First login and PIN

1. Sign in at `/login`.
2. In **Settings → Business Details**, fill in owner name, ABN, phone, email, address and hours. Blank fields use the defaults from `config/business.ts`.
3. In **Settings → Security**, set a 4–6 digit PIN and choose the auto-lock time.

## 4. Deploy to Vercel

1. Import the repo.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then deploy.
3. Make sure the Supabase Site URL and Redirect URLs use the Vercel domain.

Never put the `service_role` key in this app or in Vercel.

## 5. Front-counter iPad (Guided Access)

1. On the iPad, open Safari at `https://<your-domain>/kiosk`, then **Share → Add to Home Screen**. Always launch it from that icon.
2. **Settings → Display & Brightness → Auto-Lock → Never** (keep the iPad charging).
3. **Settings → Accessibility → Guided Access → On**, then set a passcode.
4. Open the icon, triple-click the top button, choose **Guided Access**, turn off Sleep/Wake and Volume buttons, then tap **Start**.

The app itself blocks zoom, long-press, pull-to-refresh and the back swipe, and keeps the screen awake. Staff leave the kiosk through **Staff Portal → PIN**.

## 6. Dashboard

- **Real-time list.** A new check-in slides in with a chime, a toast and an optional browser notification. The bell shows unread check-ins.
- **Each row shows:**
  - Name, phone and email.
  - Vehicle, with an **Insurance / Private** badge (no badge if blank).
  - Insurer and claim number, only when given.
  - The start of the damage description.
- **Detail view:**
  - Tap-to-call and email links.
  - A **copy button** on every field: name, phone, email, make, model, year, job type, insurer, claim number and damage. It copies the clean value (e.g. `0403343004`), flashes a green tick and shows a "Copied" toast. It falls back to `execCommand('copy')` if the Clipboard API is blocked.
  - **Copy all details** copies everything as formatted text.
  - Signature, status, internal notes (autosave), archive, customer history (by phone) and **Print check-in sheet**.
- **Search** covers name, phone, email, make, model, insurer, claim number and reference. Filters: status and date range.

## 7. Data

- **Export CSV** (Settings → Data): formula-like cells are escaped.
- **Auto-archive** completed check-ins after N months (runs when the dashboard opens).
- **Delete a customer's records** for privacy requests: this removes the rows and their signature images.

## 8. Email alert on each new check-in (optional)

Code: [`supabase/functions/notify-checkin`](supabase/functions/notify-checkin/index.ts) (Resend; without an API key it only logs).

```bash
supabase functions deploy notify-checkin --no-verify-jwt
supabase secrets set WEBHOOK_SECRET=<long-random-string> RESEND_API_KEY=re_xxx \
  BUSINESS_NAME="Hunter Valley Smash & Repair" \
  ALERT_FROM_EMAIL="Check-in <alerts@your-verified-domain.com.au>" \
  DASHBOARD_URL=https://<your-domain>/dashboard
```

Then set up a database webhook:
1. In **Database → Webhooks**, create a hook on table `checkins`, event **Insert**, type **Edge Function** → `notify-checkin`.
2. Add the header `x-webhook-secret: <same string>`.
3. Turn on **Settings → Notifications → Email alert**.

## Project structure

```
config/business.ts            branding (name, logo, colours, wording)
design/                       logo master + icon generator
supabase/migrations/          the single database migration
supabase/functions/           email alert edge function
src/app/kiosk/                kiosk form
src/app/api/checkin/route.ts  kiosk submit (validation + signature upload)
src/app/dashboard/            owner dashboard, detail, print, history, settings
src/components/copy-button.tsx    reusable <CopyButton value label />
src/components/kiosk/signature-pad.tsx
src/lib/validation.ts         shared Zod schemas (client + server)
src/lib/data.ts               all Supabase calls
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route types + `tsc` |
| `npm test` | Unit tests (no network) |
| `npm run test:db` / `npm run test:e2e` | Against the **staging** Supabase only (see `tests/support/env-guard.ts`) |
