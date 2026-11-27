# PROJECT_CONTEXT — لجنة البناء (Building Committee App)

> **Living document.** Full context of this project: goal, users, rules, architecture, decisions and a change log.
> **Update it with every change** (add a change-log row and adjust any section that changed). Mirrored to the
> claude.ai Project "Construction Committee" so every new session starts from the same picture.

_Last updated: 2026-11-27 (v0.4.1) · Owner: Samir (GitHub `samiralholo`)_

---

## 1. Goal

A 100% free-tier PWA that replaces **the paper collection sheet pinned inside the building elevator**. Not an accounting
system. Started as a one-building pilot; since v0.2 it is multi-building with a **Super Admin** who creates buildings and
assigns a volunteer **building admin** to each.

## 2. Users & non-negotiable UX rules

- **Residents:** everyday neighbors, some elderly or with limited literacy. They **never** create accounts or log in.
  One public read-only link per building: `/b/:slug` (installable on the home screen, opened via an elevator QR code).
- **Building admin:** a volunteer. Logs in with **mobile number + password** (no email). **1 tap** to record a full payment. **1 click** to create a new month for all occupied units.
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
| CI | `.github/workflows/ci.yml` on every push/PR: `pnpm typecheck` (app + api) → `pnpm test:unit` → `pnpm build` → `pnpm verify:security` |
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

### Migration 003 (`supabase/migrations/003_phone_auth_admins.sql`, idempotent)
- `normalize_phone_digits(text, cc='963')` (immutable SQL twin of the TS rules; same results on the shared test vectors).
- Existing `profiles.phone` normalized; duplicates cleared on newer accounts; partial unique index `profiles_phone_unique_idx`.
- `handle_new_user()` stores the normalized metadata phone.
- `platform_settings (key PK, value, updated_at)`: RLS superadmin-only, anon revoked; `get_support_whatsapp()` (anon) returns
  only `support_whatsapp_phone`.
- `get_my_access()` also returns `phone`.

### Migration 004 (`supabase/migrations/004_unit_groups_and_selective_cycles.sql`, idempotent)
- `unit_groups (id, building_id, name, created_at, UNIQUE(building_id,name))`, `unit_group_members (group_id, unit_id, PK)`,
  trigger `unit_group_members_same_building` (unit and group must share the building), helper `unit_group_building(group_id)`.
- RLS on both: anon none; assigned admin full CRUD; superadmin SELECT only.
- `save_unit_group(building, name, unit_ids[], group_id?)` (invoker): upsert by id or name, replace members, ignores foreign units.
- `create_billing_cycle(..., p_unit_ids uuid[] default null)`: null = every unit (vacant → exempt) as before; otherwise rows
  ONLY for the given units (empty / foreign-only → error `no units selected`). Old 5-arg signature dropped (no overload ambiguity).
- `get_public_building_dashboard`: adds `total_units` and per-cycle `scope_units_count` (rows incl. exempt),
  `included_units_count`, `paid_units_count`, `total_due`, `total_collected` (exempt excluded). Groups are NOT in the public payload.
- **Rule:** a unit with no payments row in a cycle is "not included": not unpaid, not exempt, no arrears.

Tested in PGlite with Supabase stubs: **41 checks** (004) + **42 checks** (002) + **65 checks** (003: SQL/TS parity, cleanup, unique index, RLS on 9 tables, settings roles) (upgrade path 001 → old seed → 002 twice, every role, storage, renames).

## 5. App map

| Route | Files | Guard | Notes |
| --- | --- | --- | --- |
| `/` | `features/landing/landing.ts` | — | remembered slug (`last_visited_building_slug`, validated via landing RPC) → single active building → code form |
| `/b/:slug` | `features/public/public-building.{ts,html}` | — | fetch RPC, network-first (saved copy only offline), canonical-slug redirect, install banner, zoomable lightbox |
| `/admin/login` | `features/admin/login.ts` | `guestGuard` | one field «رقم الموبايل أو البريد الإلكتروني» → `resolveLoginIdentifier`; role-aware redirect; «نسيت كلمة المرور؟» → support WhatsApp |
| `/admin/**` | `features/admin/*` (`admin.routes.ts`) | `buildingAdminGuard` | `AdminStore` loads **assigned** buildings only (switcher if >1) + subscriber groups; "not assigned" screen otherwise. Create-cycle scope «كل الشقق المأهولة» / «شقق محددة / مجموعة اشتراك» (`unit-picker.ts`: group chips, select all/none, floor checkbox, live counter, save-as-group); payments «الشقق المشمولة (X من Y)» sheet (`setCycleUnits`, paid-removal warning); units «مجموعات الاشتراك» |
| `/superadmin` | `features/superadmin/overview.ts`, `manage-building.ts` | `superAdminGuard` | KPIs, search, support-WhatsApp card, create building (auto slug), add admin (name + phone + password), «تعديل الرقم», reset password, credentials → copy / «إرسال عبر واتساب», edit/disable/delete |
| `/superadmin/buildings/:id` | `features/superadmin/inspect-building.ts` | `superAdminGuard` | `AdminStore.loadSingle` read-only; banner «وضع المعاينة (سوبر أدمن - للقراءة فقط)»; zero mutation buttons |
| `/api/superadmin/*` | `api/superadmin/*.ts`, `api/_lib/admin.ts` | JWT + `profiles.role` | create-building-admin (POST, phone), update-admin-phone (POST), remove-building-admin (DELETE), reset-admin-password (POST) |

Core: `core/phone-auth.ts` (**shared** by app, `/api` and tests: `normalizePhone`, `resolveLoginIdentifier`,
`phoneToAuthEmail`, `isSyntheticPhoneEmail`, `displayableEmail`, `formatPhoneForDisplay`, `formatPhoneForMessage`),
`core/phone.ts` (app wrappers: `phoneDigits`, `tidyPhoneInput`, `isValidPhone`, `waHref`, `telHref`, `prettyPhone`), `core/public-api.ts` (fetch RPC, remembered slug, `getSupportWhatsapp`), `core/access.service.ts`, `core/auth.guard.ts`,
`core/qr-poster.ts`, `core/password.ts`, `core/messages.ts` (reminder, monthly report, admin credentials),
`core/install.service.ts`. Shared: `lightbox`, `install-banner`, `update-banner`, `change-password`, `sheet`, `status-badge`, `icon`.

## 6. Live environment

| Item | Value |
| --- | --- |
| GitHub | `github.com/samiralholo/building-committee-app`, **public** (GitHub blocks private repos for this account's region); Claude GitHub App installed on this repo only |
| Supabase | org `tracker` (Free), project **building-committee** (Europe), ref `slqjhpvwsctwvajpnorq`; owner signs in with GitHub |
| Supabase state | Migrations 001–004 applied. **Data reset 2026-11-27**: demo «بناء الياسمين» (`al-yasmin-14`) deleted; only real building **«بناء المصرية» (`al-masriya`)** — 22 occupied homes (of 37; the other 15 not entered yet), floors القبو(-1)…7; services 50,000/home/month (تشرين الأول 2026 all paid, تشرين الثاني 2026 19/22 paid); special cycle «المصعد» for 13 subscribers (75,000 floors 5–7, 50,000 floors 2–4, all unpaid); groups «مشتركو المصعد — 75 ألف» (7) and «— 50 ألف» (6). Building admin to be added by the superadmin from /superadmin (ابو رأفت, by phone). Signups **off**; `samir.alholo.98@gmail.com` = **superadmin** (no longer a building admin) |
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
- **Phone format:** international digits without `+` (`09…` → `963…`), one shared module for app/API/tests. WhatsApp links only for valid numbers.
- **Phone login = Synthetic Email Pattern** (`<digits>@phone.lajna.app`): free (no SMS/OTP provider), works with stock
  Supabase password auth. The synthetic address is never rendered (`displayableEmail`) nor returned by the API to people.
- **Forgot password = WhatsApp to the platform admin** (free), who resets it from `/superadmin`.
- **Phones inside Arabic messages** use one unbroken token (`0912345678`, or LRM + `+971…`): spaced groups get reordered
  by the bidi algorithm in RTL text («678 345 912 963+»).
- **Selective billing = absence of a payments row** (no flag column): truthful by construction, every view already keyed on
  rows. "Custom cycle" badge = cycle rows < building units. Vacant units picked in a selective cycle get `exempt` rows,
  same rule as the default mode. Groups are a convenience (load failures never block admin screens).
- **Floors:** negative = basement («القبو»), 0 = «الطابق الأرضي»; one helper `floorName()` / `unitPlace()` in `core/format.ts`
  (label shown once when it already is the floor name). Resident names live only in the database, never in the repo.
- **Public config committed:** URL + publishable key in `public-config.json` (browser-safe by design).

## 10. Verification done (v0.2)

- PGlite: 42 role/RLS/redirect checks pass; migration 002 applied twice (idempotent).
- `pnpm build` + `pnpm typecheck` (app + api) clean; API handlers bundled and smoke-tested (401 no token, 500 missing env, 401 bad session).
- `pnpm verify:security`: 90 files, no secret keys in `src/`/`dist/`. Live anon checks run in the browser against production (see change log).
- Headless Chrome against a mock Supabase running the real SQL, at 360/375/390px: landing (code form, bad code, remembered
  slug), resident page, iOS install guide, superadmin overview/create/manage/inspect, admin login + 1-tap paid, admin blocked
  from `/superadmin`, slug rename → old link redirects. 0 overflow, 0 targets < 48px, 0 console errors.

### v0.3 verification
- `pnpm test:unit`: 13 suites (Eastern Arabic/Persian digits, separators, `00`/`+`, local `09…`, 9-digit, bidi marks,
  other countries, invalid inputs, email passthrough, synthetic helpers, display/message formats).
- Local end-to-end against a mock Supabase running migrations 001–003 **and the real bundled `/api` handlers**:
  superadmin email login; support number saved from `٠٩٣٣…`; admin created by phone (no email field), message has phone +
  password and no synthetic email, «إرسال عبر واتساب» → `wa.me/963…`; same phone re-linked (no 2nd account); admin login
  with `0912345678` and `٠٩١٢٣٤٥٦٧٨`; change password (old rejected with Arabic error); duplicate phone edit → 409; phone
  edit → old number rejected, new works; reset → message with phone; removal. `phone.lajna.app` found in 0 rendered pages.
- Bundle unchanged (main 76.5 KB gz).

### v0.4 verification (selective billing)
- Audit before change: creation always billed every unit (non-subscribers forced to «معفى»); resident list and inspect showed
  non-included units with «—»; admin payments nagged «في X شقة مش مضافة». Progress, drawer, arrears, report and CSV were already row-based.
- PGlite: 41 checks (anon 401 on both tables and the save RPC, cross-building trigger, admin isolation, superadmin read-only,
  subset rows only, empty selection rejected, 5-arg 1-click call = all units, per-cycle stats, no groups in public payload, cascades).
- Local E2E (mock Supabase + real migrations): group «مشتركو المصعد» via floor toggles (5 units) → elevator cycle from the group
  chip → exactly 5 rows; pill (5 من 8); add a unit / remove an unpaid unit; paid removal shows the Arabic warning, then removes;
  WhatsApp report and CSV list only the 4 included units (with the scope line); resident page «دورة مخصصة — تشمل 4 شقة»,
  «تم تحصيل 1 من 4», only those 4 listed, non-subscriber drawer has no elevator cycle; regular 1-click cycle → all 8;
  superadmin inspect «تشمل 4 من 8» with 0 mutation buttons; zero-selection blocked; 0 page errors.
- Bundle: initial 83.1 KB gz (was 82.8), resident chunk 8.2 KB (was 8.0); picker/groups live in admin lazy chunks.

## 11. Backlog / ideas

- Self-service password reset without the platform admin would need an OTP provider (not free) — intentionally skipped.
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
| 2026-11-24 | **v0.3 — phone login for building admins**: shared `phone-auth.ts` (+13 unit tests), migration 003 (normalized unique phones, `platform_settings`, `get_support_whatsapp`, `get_my_access.phone`) applied live; API create-by-phone + `update-admin-phone`; smart login field; «نسيت كلمة المرور؟» via support WhatsApp; super admin phone UI, «تعديل الرقم», «إرسال عبر واتساب»; synthetic emails never displayed. |
| 2026-11-24 | Vercel build failure on intermediate commit `c92df6e` (TS2459: `normalizePhone` no longer exported by `core/phone`, still imported by `manage-building.ts`) — already fixed in `f1874ef`; verified with a clean clone. Added CI workflow (typecheck, unit tests, build, security scan) so a broken commit is caught on GitHub. Lesson: each pushed commit must build on its own. |
| 2026-11-25 | **v0.4 — selective unit billing & subscriber groups**: migration 004 (`unit_groups`, `unit_group_members`, RLS, `save_unit_group`, `create_billing_cycle(p_unit_ids)`, per-cycle stats + `total_units` in the public RPC); create-cycle scope + reusable groups; «الشقق المشمولة» editor with paid-removal warning; «مجموعات الاشتراك» in units; resident badge/denominator/list, report, CSV and inspect use included units only. |
| 2026-11-25 | Migration 004 applied live (2 RLS tables, 8 policies, single 6-arg `create_billing_cycle`, anon no grant, dashboard stats present). Production anon: 401 on `unit_groups`, `unit_group_members`, `save_unit_group`, units, payments, buildings. CI green; Vercel serves the v0.4 build. |
| 2026-11-27 | Production data reset; «بناء المصرية» loaded (22 homes, 2 services months, elevator cycle with 75k/50k per floor band, 2 subscriber groups). Basement support: `floorName()`/`unitPlace()` used by the resident page, unit picker and units list. |
