# لجنة البناء — Building Committee App

A free, Arabic-first (RTL) PWA that replaces **the paper collection sheet in the building elevator**.
Residents open one public link (or scan the QR code in the elevator) and see who paid, where the money went
(with receipt photos) and the emergency numbers — no accounts, no passwords. Each building's volunteer admin
records a payment with **1 tap**; a **Super Admin** creates buildings and assigns their admins.

> **Live:** https://building-committee-app.vercel.app · admin & super admin: [`/admin/login`](https://building-committee-app.vercel.app/admin/login)
>
> Decisions, conventions and change log: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) · UX audit: [`UI_UX_AUDIT.md`](UI_UX_AUDIT.md)

**Stack (all free tier):** Angular 22 (standalone, zoneless, Signals, strict) · Tailwind CSS 4 · Angular service worker ·
Supabase (Postgres + RLS + Auth + Storage) · Vercel (static app + 3 serverless functions) · GitHub Actions keep-alive.

---

## Roles

| Role | Where | Can do |
| --- | --- | --- |
| Resident | `/b/:slug` (no login) | Read the building's public page (no phone numbers, names hidden if the admin wants) |
| Building admin | `/admin` | Full control of **their assigned building(s)** only: payments, months, expenses, units, settings |
| Super admin | `/superadmin` | Create/edit/disable/delete buildings, assign/remove admins, reset admin passwords, **read-only** inspection of any building |

A super admin can also be assigned to a building as its admin (then `/admin` manages that building).

---

## Setup from scratch

### 1. Supabase (free project)
1. <https://supabase.com> → **New project**.
2. **SQL Editor** → run, in order:
   1. [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
   2. [`supabase/migrations/002_superadmin_and_roles.sql`](supabase/migrations/002_superadmin_and_roles.sql)
3. **Authentication → Sign In / Providers** → turn **off** “Allow new users to sign up”.
4. **Authentication → Users → Add user → Create new user** (your email + password, “Auto Confirm User”).
5. **Promote yourself to Super Admin** — SQL Editor, one command:
   ```sql
   update public.profiles set role = 'superadmin' where email = 'you@example.com';
   ```
6. Optional sample data: run [`supabase/seed.sql`](supabase/seed.sql) (building `al-yasmin-14`, assigned to the oldest user).

> Upgrading an existing v0.1 project? Run only `002_superadmin_and_roles.sql` (idempotent) and step 5.
> Existing building owners are migrated automatically into `building_admins`.

### 2. Vercel
Import the GitHub repo — `vercel.json` already sets pnpm, the output folder, the SPA rewrite (excluding `/api/*`) and the functions.

**Project → Settings → Environment Variables** (Production):

| Name | Value | Used by |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | build + `/api` functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **secret** key (`sb_secret_…`) or legacy `service_role` key | **`/api` functions only** (creating admin accounts) |

The browser key (URL + publishable/anon key) is read from [`public-config.json`](public-config.json); `SUPABASE_ANON_KEY`
can override it. The build **refuses** to bundle a secret/service_role key, and `pnpm verify:security` scans `src/` and `dist/`.
Redeploy after adding variables.

### 3. GitHub Actions keep-alive (free projects pause after 7 days idle)
`.github/workflows/supabase-keepalive.yml` runs every 4 days (`0 6 */4 * *`) and on demand. It POSTs to
`rpc/get_public_landing_state` and **fails loudly** on any non-200.

**Repo → Settings → Secrets and variables → Actions → New repository secret** — exactly these 2:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | the publishable/anon key (never the secret key) |

(If the secrets are missing, the job falls back to `public-config.json`.) Then **Actions → Supabase keep-alive → Run workflow** once.

---

## Local development

```bash
pnpm install
cp .env.example .env          # optional: point at another Supabase project
pnpm start                    # http://localhost:4200
pnpm build                    # production build → dist/building-committee-app/browser
pnpm typecheck                # strict TS for the app AND the /api functions
pnpm verify:security [slug]   # secret-key scan + live anon checks (units/profiles blocked, no whatsapp_phone)
```

`/api/*` functions run on Vercel (`vercel dev` locally, which needs the two server env vars).

---

## Server API (super admin only)

All endpoints verify the caller's Supabase JWT (`Authorization: Bearer …`) and require `profiles.role = 'superadmin'`
(403 otherwise). They live in [`api/superadmin/`](api/superadmin).

| Method & path | Body | Does |
| --- | --- | --- |
| `POST /api/superadmin/create-building-admin` | `{ building_id, full_name, email, phone?, password }` | Creates the user (email pre-confirmed) or links an existing one, then assigns it to the building |
| `DELETE /api/superadmin/remove-building-admin` | `{ building_id, user_id }` | Unassigns (the account stays) |
| `POST /api/superadmin/reset-admin-password` | `{ user_id, password }` | New password for a building admin |

---

## Security model

- RLS on every table. `anon` has **no table privileges at all**; public data comes only from `SECURITY DEFINER` RPCs
  `get_public_building_dashboard(slug)` (no phones, no private payment notes, honors “hide names”) and `get_public_landing_state()`.
- Building admins: full CRUD on `units / billing_cycles / payments / expenses` only where `is_building_admin(building_id)`;
  select/update their own building row; cannot create/delete buildings or assign admins.
- Super admin: full CRUD on `buildings / building_admins / profiles / building_slug_redirects`; **SELECT only** on operational tables.
- No self-promotion: users cannot update `profiles` (only a super admin can).
- Storage `receipts`: public read; insert/update/delete only into `{building_id}/` folders of buildings you are assigned to.
- Renamed slugs are kept in `building_slug_redirects`, so printed elevator QR codes never break; a slug still used
  by another building's old QR code cannot be taken.

## Performance

Residents load only the landing/resident code: **~83 KB gzipped initial** (was 126 KB+), no supabase-js (fetch-based RPC).
supabase-js, admin, super admin, QR and CSV code are lazy chunks. One RPC call renders the whole resident page.
Numbers: `PROJECT_CONTEXT.md` → Performance.

## PWA

Installable on Android and iOS (Arabic manifest, SVG + PNG + maskable + apple-touch icons). The service worker caches
the app shell and icons only — **Supabase and `/api` requests are never cached**, so payment statuses are always fresh.
A banner offers updates after each deploy, and residents get an install banner (native prompt or a 2-step iOS guide).
The last building visited is remembered, so the home-screen icon opens it directly.

## Project layout

```
api/                        Vercel functions (server-only, service key)
supabase/migrations/        001 schema · 002 roles, redirects, landing RPC
supabase/seed.sql           pilot sample data
src/app/core/               config, fetch-based public API, auth/access, guards, formatting, WhatsApp/CSV/QR helpers
src/app/shared/             icons, badges, sheet, lightbox, install & update banners, change password
src/app/features/           landing (/) · public (/b/:slug) · admin (/admin/**) · superadmin (/superadmin/**)
scripts/                    set-env (env → environment.ts, blocks secret keys) · verify-security
```
