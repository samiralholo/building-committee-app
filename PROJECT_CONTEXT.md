# PROJECT_CONTEXT — لجنة البناء (Building Committee App)

> **Living document.** Full context of this project: goal, users, rules, architecture, decisions and a change log.
> **Update it with every change** (add a change-log row and adjust any section that changed). Mirrored to the
> claude.ai Project "Construction Committee" so every new session starts from the same picture.

_Last updated: 2026-11-24 (v0.2) · Owner: Samir (GitHub `samiralholo`)_

---

## 1. Goal

A 100% free-tier PWA that replaces **the paper collection sheet pinned inside the building elevator**. Not an accounting
system. Started as a one-building pilot; since v0.2 it is multi-building with a **Super Admin** who creates buildings and
assigns a volunteer **building admin** to each.

## 2. Users & non-negotiable UX rules

- **Residents:** everyday neighbors, some elderly or with limited literacy. They **never** create accounts or log in.
  One public read-only link per building: `/b/:slug` (installable on the home screen, opened via an elevator QR code).
- **Building admin:** a volunteer. **1 tap** to record a full payment. **1 click** to create a new month for all occupied units.
- **Super admin (Samir):** manages buildings and their admins; inspects any building read-only.
- 100% Arabic, `lang="ar" dir="rtl"`, simple everyday Levantine words:
  صندوق البناء · المطلوب هالشهر · الباقي عليك · خالص · غير مدفوع · دفع جزء · مصاريف الشهر · أرقام الطوارئ.
- Status = color + icon + short label:
  | status | text / bg | icon | label |
  | --- | --- | --- | --- |
  | paid | `#15803D` / `#DCFCE7` | check | خالص |
  | unpaid | `#B91C1C` / `#FEE2E2` | x | غير مدفوع |
  | partial | `#B45309` / `#FEF3C7` | clock | دفع جزء |
  | exempt | `#475569` / `#F1F5F9` | minus | شقة فارغة / معفى |
- Palette: page `#F8FAFC`, cards `#FFFFFF` + border `#E2E8F0`, brand teal `#0F766E` (hover `#115E59`),
  text `#1E293B` / `#475569`. Font **Cairo** 400/600/700/800. Money uses `tabular-nums`.
  **Touch targets ≥ 48px** (verified automatically), mobile bottom bars ≥ 56px, zero horizontal overflow at 360px.

## 3. Stack

| Layer | Choice |
| --- | --- |
| Frontend | Angular **22.3** standalone, **zoneless** (default since v21), Signals, `strict` + `strictTemplates`, OnPush everywhere |
| Package manager | pnpm 10 |
| Styling | Tailwind CSS **4** via `@tailwindcss/postcss`; tokens in `src/styles.css` `@theme`; RTL logical utilities |
| PWA | `@angular/service-worker` (`ngsw-config.json`), `public/manifest.webmanifest`, SwUpdate banner, install banner/iOS guide |
| Backend | Supabase: Postgres + RLS + Auth (email/password) + Storage (`receipts`). Admin pages use `@supabase/supabase-js` (lazy); public pages use plain `fetch` RPC |
| Server | Vercel Functions in `api/superadmin/*` (Web `Request → Response` handlers, Node runtime): the only place the service key is used |
| Hosting | Vercel (`vercel.json`: pnpm build, output `dist/building-committee-app/browser`, SPA rewrite excluding `/api/*` and files) |
| Keep-alive | `.github/workflows/supabase-keepalive.yml`: `0 6 */4 * *` + manual; POST `rpc/get_public_landing_state`, fails on non-200 |
| Extras | `qrcode` (lazy), CSV export (lazy, UTF-8 BOM), canvas image compression |

## 4. Data model

### Migration 001 (`supabase/migrations/001_initial_schema.sql`)
Tables `buildings`, `units`, `billing_cycles`, `payments`, `expenses` (all with `building_id`). CHECKs (slug format, phone
digits, amounts ≥ 0, categories), composite FKs so a payment/expense can't cross buildings, trigger `payments_normalize`
(status from amounts), trigger `buildings_touch_announcement`, RPCs `create_billing_cycle`, `keepalive_ping`,
`get_public_building_dashboard`, storage bucket `receipts`.

### Migration 002 (`supabase/migrations/002_superadmin_and_roles.sql`, idempotent)
- `profiles (id → auth.users, email, full_name, phone, role 'superadmin'|'admin')` + `on_auth_user_created` trigger
  (`handle_new_user`, copies `full_name`/`phone` from user metadata) + backfill.
- `building_admins (building_id, user_id, assigned_by, assigned_at, UNIQUE(building_id,user_id))`; existing `owner_id`
  rows migrated; `buildings.owner_id` now **nullable** ("created by" history only).
- `buildings.is_active` (inactive = hidden from residents, data kept).
- `building_slug_redirects (old_slug PK, building_id)` + trigger `buildings_slug_history`: rename → old slug stored;
  a slug still redirecting to another building is **reserved** (error `buildings_slug_reserved`); renaming back cleans up.
- Helpers (SECURITY DEFINER): `is_superadmin()`, `is_building_admin(id)`; `is_building_owner` / `owns_building_folder`
  now mean "assigned admin".
- RLS rewritten (all old policies dropped):
  - buildings: select/update = superadmin or assigned admin; insert/delete = superadmin.
  - units / billing_cycles / payments / expenses: select = assigned admin **or superadmin (read-only)**; insert/update/delete = assigned admin only.
  - profiles: select own or superadmin; insert/update/delete superadmin only (no self role escalation).
  - building_admins: select own rows or superadmin; write superadmin only. slug_redirects: superadmin only.
  - `anon`: **no privileges** on any table.
- Storage `receipts`: public read; write/delete only in folders of assigned buildings.
- RPCs: `resolve_building_slug(slug)` (internal), `get_public_landing_state(p_slug default null)` →
  `{building_count, single_slug, resolved_slug}` (anon; also the keep-alive), `get_public_building_dashboard(slug)`
  (follows old slugs, skips inactive, returns the canonical slug), `create_billing_cycle` (requires assigned admin),
  `get_my_access()` → `{user_id, role, full_name, buildings[]}`, `superadmin_overview()` → KPIs + buildings with admins,
  unit count, fund balance (superadmin only).

Tested in PGlite with Supabase stubs: **42 checks** (upgrade path 001 → old seed → 002 twice, every role, storage, renames).

## 5. App map

| Route | Files | Guard | Notes |
| --- | --- | --- | --- |
| `/` | `features/landing/landing.ts` | — | remembered slug (`last_visited_building_slug`, validated via landing RPC) → single active building → code form |
| `/b/:slug` | `features/public/public-building.{ts,html}` | — | fetch RPC, network-first (saved copy only offline), canonical-slug redirect, install banner, zoomable lightbox |
| `/admin/login` | `features/admin/login.ts` | `guestGuard` | role-aware redirect: superadmin → `/superadmin`, admin → `/admin` |
| `/admin/**` | `features/admin/*` (`admin.routes.ts`) | `buildingAdminGuard` | `AdminStore` loads **assigned** buildings only (switcher if >1); "not assigned" screen otherwise |
| `/superadmin` | `features/superadmin/overview.ts`, `manage-building.ts` | `superAdminGuard` | KPIs, search, create building (auto slug), assign/remove admins, reset password, credentials → WhatsApp, edit/disable/delete |
| `/superadmin/buildings/:id` | `features/superadmin/inspect-building.ts` | `superAdminGuard` | `AdminStore.loadSingle` read-only; banner «وضع المعاينة (سوبر أدمن - للقراءة فقط)»; zero mutation buttons |
| `/api/superadmin/*` | `api/superadmin/*.ts`, `api/_lib/admin.ts` | JWT + `profiles.role` | create-building-admin (POST), remove-building-admin (DELETE), reset-admin-password (POST) |

Core: `core/public-api.ts` (fetch RPC, remembered slug), `core/access.service.ts`, `core/auth.guard.ts`,
`core/qr-poster.ts`, `core/password.ts`, `core/messages.ts` (reminder, monthly report, admin credentials),
`core/install.service.ts`. Shared: `lightbox`, `install-banner`, `update-banner`, `change-password`, `sheet`, `status-badge`, `icon`.

## 6. Live environment

| Item | Value |
| --- | --- |
| GitHub | `github.com/samiralholo/building-committee-app`, **public** (GitHub blocks private repos for this account's region); Claude GitHub App installed on this repo only |
| Supabase | org `tracker` (Free), project **building-committee** (Europe), ref `slqjhpvwsctwvajpnorq`; owner signs in with GitHub |
| Supabase state | 001 + seed + **002 applied (2026-11-24)**; signups **off**; `samir.alholo.98@gmail.com` = **superadmin** and admin of `al-yasmin-14` |
| Vercel | team `samir-alholos-projects` (Hobby), project `building-committee-app`, auto-deploys from `main`. **https://building-committee-app.vercel.app** |
| Vercel env | **Set 2026-11-24** (Production): `SUPABASE_URL` (config) + `SUPABASE_SERVICE_ROLE_KEY` (secret, pasted by Samir, never seen by an assistant) |
| Keys | publishable key in `public-config.json`. Secret key only in the Supabase dashboard + Vercel env |

## 7. Configuration

`scripts/set-env.mjs` → generated, git-ignored `src/environments/environment.ts`. Priority: env vars → `.env` →
`public-config.json`. **Build fails** if the browser key is a secret/service_role key. No hard-coded building slug anywhere.
Browser: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ENABLE_PUBLIC_SIGNUP` (false). Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 8. Performance (v0.2)

| Metric | v0.1 | v0.2 |
| --- | --- | --- |
| Initial JS (main) | 510.8 KB raw / **126.4 KB gz** | 278.5 KB raw / **76.5 KB gz** |
| Initial total incl. CSS | ~132 KB gz | **82.8 KB gz** |
| Resident page chunk | 6.8 KB gz | 8.0 KB gz (adds install banner + lightbox) |
| supabase-js (229 KB raw / 51 KB gz) | in main | lazy, only after admin login |
| Requests to render `/b/:slug` | 1 RPC | 1 RPC (`get_public_building_dashboard`) |
| QR (`qrcode`) / CSV | lazy route | dynamic `import()` on use |

How: routes split into lazy `admin.routes.ts` / `superadmin.routes.ts` (guards inside the lazy chunk), fetch-based public
RPC client, dynamic imports for QR/CSV, Cairo 400/600/700/800 with preconnect + `display=swap`, inline SVG icons, OnPush +
Signals + `computed()` everywhere, `@for` tracked by id. Fixed a real bug: an `effect()` tracked `data()` and re-fetched forever.

## 9. Decisions & rationale

- **Digits:** Arabic text with Latin digits (`ar-SY-u-nu-latn`). **Months:** Levantine names.
- **Payment notes are admin-only** (excluded from the public RPC). Expense notes are public (transparency).
- **Super admin is read-only on operational data** (RLS), so inspecting a building can never change money records.
  If the super admin should run a building, assign them to it (`building_admins`), like Samir for `al-yasmin-14`.
- **Removing an admin keeps the account** (they may run other buildings). Deleting a building cascades everything,
  so the UI recommends "إيقاف" (deactivate) and requires typing the slug to delete.
- **Existing email on "add admin"** → linked, password untouched, message says "use your usual password".
- **Network-first resident data**; the localStorage copy is only an offline fallback. The SW never caches Supabase or `/api`.
- **Receipts** always JPEG, max 1200px, q 0.72 stepped down to < 150 KB; URL gets `?v=timestamp`.
- **Delete confirmations** are in-app (no browser `confirm()`).
- **Phone format:** international digits without `+` (`09…` → `963…`). WhatsApp links only for valid numbers.
- **Public config committed:** URL + publishable key in `public-config.json` (browser-safe by design).

## 10. Verification done (v0.2)

- PGlite: 42 role/RLS/redirect checks pass; migration 002 applied twice (idempotent).
- `pnpm build` + `pnpm typecheck` (app + api) clean; API handlers bundled and smoke-tested (401 no token, 500 missing env, 401 bad session).
- `pnpm verify:security`: 90 files, no secret keys in `src/`/`dist/`. Live anon checks run in the browser against production (see change log).
- Headless Chrome against a mock Supabase running the real SQL, at 360/375/390px: landing (code form, bad code, remembered
  slug), resident page, iOS install guide, superadmin overview/create/manage/inspect, admin login + 1-tap paid, admin blocked
  from `/superadmin`, slug rename → old link redirects. 0 overflow, 0 targets < 48px, 0 console errors.

## 11. Backlog / ideas

- Self-service "forgot password" email flow (needs Supabase SMTP / redirect URL).
- Clean up orphaned receipt files when a whole building is deleted.
- Audit log of admin actions; monthly PDF report; Supabase CLI config for local dev.

## 12. Change log

| Date | Change |
| --- | --- |
| 2026-11-24 | v0.1: initial build (schema/RLS/RPCs/storage/seed, public resident view, admin portal, PWA, Vercel config, keep-alive workflow, README, this context file). Repo created at `github.com/samiralholo/building-committee-app`. |
| 2026-11-24 | Repo made **public** and pushed. Supabase project `building-committee` created (GitHub sign-in), migration + seed applied, public signups disabled, admin user created. Added `public-config.json` (URL + publishable key) as build/cron fallback. |
| 2026-11-24 | Deployed to Vercel (Git-connected). Verified live: resident page with real data, admin guard, service worker active. |
| 2026-11-24 | **v0.2**: migration 002 (profiles, building_admins, slug redirects, is_active, landing RPC, RLS rewrite) applied live; Samir promoted to superadmin. Super Admin portal + read-only inspect; `/api/superadmin/*` provisioning functions; role-aware login/guards; dynamic `/` (no hard-coded slug); perf split (−40% initial JS, no supabase-js for residents); safe SW caching, update banner, install banner + iOS guide; zoomable lightbox; UX fixes (`UI_UX_AUDIT.md`); `verify-security` script; keep-alive → `get_public_landing_state` at `0 6 */4 * *`. |
| 2026-11-24 | Production verified as anon: 401 on units/profiles/building_admins/payments/buildings/slug_redirects and on `superadmin_overview`; dashboard has 0 `whatsapp_phone` and no payment notes; `/api/superadmin/*` deployed (401 without token). Vercel env vars set; redeploy to activate them. |
