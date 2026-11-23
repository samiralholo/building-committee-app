# لجنة البناء — Building Committee App

A free, Arabic-first (RTL) PWA that replaces **the paper collection sheet in the building elevator**.
Residents open one public link (or scan a QR code in the elevator) and see, at a glance, who paid,
where the money went (with receipt photos) and the emergency numbers. No accounts, no passwords.
The volunteer admin records a payment with **1 tap** and opens a new month for all apartments with **1 click**.

**Stack (all free tier):** Angular 22 (standalone, zoneless, Signals, strict) · Tailwind CSS 4 · Angular PWA ·
Supabase (Postgres + RLS + Auth + Storage) · Vercel · GitHub Actions keep-alive.

> Project decisions, conventions and change log live in [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).
>
> **Live:** https://building-committee-app.vercel.app — residents: [`/b/al-yasmin-14`](https://building-committee-app.vercel.app/b/al-yasmin-14) · admin: [`/admin/login`](https://building-committee-app.vercel.app/admin/login)
>
> **Pilot status:** the Supabase project is already set up and linked through [`public-config.json`](public-config.json)
> (URL + browser-safe publishable key). Steps 1–2 and 5 below are only needed for a fresh project.

---

## 1. Create the free Supabase project (≈5 min)

1. Go to <https://supabase.com> → **New project** (Free plan). Pick a region close to your building.
2. Open **SQL Editor** → **New query** → paste all of [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql) → **Run**.
   This creates the 5 tables, Row Level Security, the public read-only function, and the `receipts` storage bucket.
3. **Turn off public signups** (pilot mode): **Authentication → Sign In / Providers → Email** →
   disable **“Allow new users to sign up”**. Only accounts you create by hand can log in.
4. Copy your keys from **Project Settings → API** (or the **Connect** button):
   - **Project URL** → `SUPABASE_URL`
   - **publishable key** (`sb_publishable_…`, or the legacy anon key) → `SUPABASE_ANON_KEY`, or put it in `public-config.json`
     (this key is meant to be public; the data is protected by RLS. **Never** use the `service_role` / secret key in the app.)

## 2. Create the first admin and link the building

1. **Authentication → Users → Add user → Create new user** — enter your email + a password, tick **Auto Confirm User**.
2. Optional sample data: **SQL Editor** → paste [`supabase/seed.sql`](supabase/seed.sql) → **Run**.
   It creates the pilot building `al-yasmin-14` (8 apartments, 2 months, 3 expenses) owned by the **first user** you created.
3. Want a different owner later? Run:
   ```sql
   update public.buildings
   set owner_id = (select id from auth.users where email = 'you@example.com')
   where slug = 'al-yasmin-14';
   ```
   No seed? Just log in at `/admin/login` — the app shows a short **“create your building”** form.

## 3. Run locally

```bash
pnpm install
cp .env.example .env      # then fill SUPABASE_URL and SUPABASE_ANON_KEY
pnpm start                # http://localhost:4200  →  /b/al-yasmin-14  and  /admin/login
pnpm build                # production build in dist/building-committee-app/browser
```

`scripts/set-env.mjs` generates `src/environments/environment.ts` from `.env` (local) or the
environment variables (Vercel). That generated file is git-ignored.

## 4. Deploy to Vercel (≈2 min)

1. <https://vercel.com/new> → **Import** this GitHub repository.
2. Leave the framework preset as is — `vercel.json` already sets the install/build commands, the output folder, and the SPA fallback rewrite.
3. Environment variables are optional: `public-config.json` already holds the URL, publishable key and
   `defaultBuildingSlug`. Set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `DEFAULT_BUILDING_SLUG` only to override them.
4. **Deploy**. Your resident link is `https://<your-app>.vercel.app/b/<slug>`.
5. In the app: **الإعدادات → طباعة ورقة المصعد** prints a QR poster for the elevator.

## 5. Keep the free database awake (GitHub Actions)

Free Supabase projects pause after 7 days without traffic. `.github/workflows/supabase-keepalive.yml`
pings the database every 4 days (a read-only `keepalive_ping()` call).

It works out of the box with `public-config.json`. To use a different project without editing that file, add
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_ANON_KEY` | your anon / publishable key |

Then **Actions → Supabase keep-alive → Run workflow** once to check it turns green.

---

## What’s inside

| Route | Who | What |
| --- | --- | --- |
| `/` | everyone | 2-line intro + enter building code; auto-opens `DEFAULT_BUILDING_SLUG` or the last building visited |
| `/b/:slug` | residents (no login) | fund balance, pinned announcement, payments per month with status colors, apartment history drawer, expenses with receipt lightbox, emergency call/WhatsApp buttons. Works offline with the last saved copy. |
| `/admin/login` | admin | email + password (signup hidden while `ENABLE_PUBLIC_SIGNUP=false`) |
| `/admin` | admin | KPIs, **create month (1 click)**, copy WhatsApp report, export Excel (CSV, UTF‑8 BOM) |
| `/admin/payments` | admin | **1-tap “تم الدفع”**, partial / exempt / notes, WhatsApp reminder |
| `/admin/expenses` | admin | add/edit/delete, receipt photo compressed in the browser to < 150 KB |
| `/admin/units` | admin | add/edit/reorder/delete apartments, phone auto-formatting |
| `/admin/settings` | admin | name, slug, currency, fee, privacy toggle, announcement, emergency contacts, public link + **QR poster** |

### Security model

- Every table has RLS: an authenticated user can only touch rows of buildings where `owner_id = auth.uid()`.
- Anonymous visitors have **no direct table access**. They read through `get_public_building_dashboard(slug)`
  (`SECURITY DEFINER`), which never returns phone numbers or private payment notes and respects “hide resident names”.
- Receipts bucket: public read; upload/replace/delete only into your own `{building_id}/` folder.
- Composite foreign keys stop a payment from pointing to another building’s unit or month.

### Project layout

```
supabase/migrations/001_initial_schema.sql   tables, triggers, RLS, RPCs, storage
supabase/seed.sql                            pilot building sample data
src/app/core/        models, Supabase client, auth, formatting, CSV, WhatsApp texts, image compression
src/app/shared/      icons, status badge, bottom sheet, toasts
src/app/features/    landing, public resident view, admin portal
scripts/set-env.mjs  env → environment.ts
PROJECT_CONTEXT.md   living context: decisions + change log
```
