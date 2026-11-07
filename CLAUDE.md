# CLAUDE.md – Hunter Valley Smash & Repair check-in

@AGENTS.md

## What this is
Check-in-only app for a smash repair shop: customer iPad kiosk (`/kiosk`), real-time owner dashboard (`/dashboard`), owner auth (`/login`). See `README.md`.

## Stack
Next.js 16 (App Router; read `node_modules/next/dist/docs/` first, it has breaking changes, e.g. `proxy.ts` replaces middleware) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Realtime, Storage) · Zod · Vercel.

## Commands
- Dev: `npm run dev` · Build: `npm run build` · Lint: `npm run lint` · Typecheck: `npm run typecheck`
- Unit tests (no network): `npm test`
- DB / E2E tests (staging Supabase only, keys in `.env.test.local`): `npm run test:db`, `npm run test:e2e`
- DB: `supabase/migrations/0001_checkin.sql` builds a new project. Schema changes go in a new numbered migration.

## Rules
- Branding (name, logo, colours, wording) lives only in `config/business.ts`. Never hard-code the business name or colours in components.
- Kiosk validation is one Zod schema (`src/lib/validation.ts`) used by the form and `POST /api/checkin`. Change both by changing it, and keep the DB checks (`kiosk_submit_checkin`, CHECK constraints) in line.
- Zod `.strict()` on every input. Anon gets no read access to check-ins or signatures.
- No secrets in code. Never print or commit `.env*`. The service-role key is never used by the app.
- Don't log phones, emails, names, notes or claim numbers.
- SQL conventions: `security definer` + fixed `search_path`, revoke-then-grant, check constraints.

## Ask before touching
Grants/RLS, `security definer` functions, storage policies, auth/PIN code, `next.config.ts` headers, anything that deletes data.
