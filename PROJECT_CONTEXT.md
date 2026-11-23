# PROJECT_CONTEXT — لجنة البناء (Building Committee App)

> **Living document.** It holds the full context of this project: goal, users, rules, architecture,
> decisions and a change log. **Update it with every change** (add a line to the change log and adjust
> any section that changed). It is mirrored to the claude.ai Project "Construction Committee"
> so every new session starts from the same picture.

_Last updated: 2026-11-24 · Owner: Samir (GitHub `samiralholo`)_

---

## 1. Goal

A 100% free-tier PWA that replaces **the paper collection sheet pinned inside the building elevator**.
It is NOT an accounting system. Pilot: one building, then open it to more buildings (SaaS) later without refactoring.

## 2. Users & non-negotiable UX rules

- **Residents:** everyday neighbors, some elderly or with limited literacy. They **never** create accounts or log in.
  One public read-only link per building: `/b/:slug` (installable on the home screen, opened via an elevator QR code).
- **Admin:** a volunteer. **1 tap** to record a full payment. **1 click** to create a new month for all occupied units.
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
  text `#1E293B` / `#475569`. Font **Cairo** 400/600/700/800. Money uses `tabular-nums`. Min touch target **48px**.

## 3. Stack

| Layer | Choice |
| --- | --- |
| Frontend | Angular **22.3** standalone, **zoneless** (default since v21), Signals, `strict` + `strictTemplates` |
| Package manager | pnpm 10 |
| Styling | Tailwind CSS **4** via `@tailwindcss/postcss` (`.postcssrc.json`); tokens in `src/styles.css` `@theme`; RTL logical utilities (`ms-/me-/ps-/pe-/text-start/end`) |
| PWA | `@angular/service-worker` (`ngsw-config.json`), `public/manifest.webmanifest` (Arabic name, teal icons) |
| Backend | Supabase: Postgres + RLS + Auth (email/password) + Storage (`receipts` bucket) via `@supabase/supabase-js` |
| Hosting | Vercel (`vercel.json`: pnpm build, output `dist/building-committee-app/browser`, SPA rewrite) |
| Keep-alive | `.github/workflows/supabase-keepalive.yml` — every 4 days calls `rpc/keepalive_ping` with repo secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Extras | `qrcode` (QR poster), client CSV export (UTF-8 BOM), canvas image compression |

## 4. Data model (`supabase/migrations/001_initial_schema.sql`)

Tables (all with `building_id` for multi-tenancy): `buildings`, `units`, `billing_cycles`, `payments`, `expenses`.
Exact columns follow the original spec. Additions:
- CHECKs: slug format `^[a-z0-9]+(-[a-z0-9]+)*$`, phone `^[0-9]{8,15}$`, non-negative amounts, category whitelist.
- Composite FKs `(cycle_id, building_id)` / `(unit_id, building_id)` so a payment or expense can never cross buildings.
- Trigger `payments_normalize`: derives `status` from amounts (exempt → amounts 0), sets `paid_at`, touches `updated_at`.
- Trigger `buildings_touch_announcement`: sets `announcement_updated_at` when the announcement text changes.

Functions:
- `is_building_owner(uuid)` — SECURITY DEFINER helper used by every RLS policy.
- `get_public_building_dashboard(p_slug text) → jsonb` — SECURITY DEFINER, granted to `anon`. Returns building summary,
  stats (`total_collected`, `total_expenses`, `fund_balance`, `last_updated`), cycles (newest first), units **without
  phone numbers** + `display_name` (privacy toggle) + `total_arrears`, payments (**without notes**), expenses.
- `create_billing_cycle(building, title, type, amount, date)` — SECURITY INVOKER; creates the cycle + one payment per unit
  in one transaction (occupied → `unpaid` with amount, vacant → `exempt` with 0). Powers the 1-click button.
- `keepalive_ping()` — tiny read for the cron.
- `owns_building_folder(text)` — storage policy helper (safe for non-uuid folder names).

Security: RLS on all 5 tables (owner-only CRUD); `anon` has **no** table privileges at all; storage `receipts` is
public-read, write/delete only inside the owner's `{building_id}/` folder. Seed: `supabase/seed.sql` (building `al-yasmin-14`,
8 units on 4 floors, 2 cycles, mixed statuses, 3 expenses) → owner = oldest `auth.users` row.

## 5. App map

| Route | File | Notes |
| --- | --- | --- |
| `/` | `features/landing/landing.ts` | Redirects to `DEFAULT_BUILDING_SLUG` or the last visited slug (so installed PWAs reopen the right building); `history.state.stay` skips the redirect |
| `/b/:slug` | `features/public/public-building.{ts,html}` | Fund card, announcement, 3 tabs (bottom bar on mobile), unit history drawer, receipt lightbox, call/WhatsApp. Caches the last payload in `localStorage` → offline view |
| `/admin/login` | `features/admin/login.ts` | Signup only if `ENABLE_PUBLIC_SIGNUP` |
| `/admin` (guarded) | `admin-shell.ts` + `admin-store.ts` | `AdminStore` (Signals) = single source of truth, optimistic updates with rollback |
| `/admin` | `dashboard.ts` | KPIs, create cycle (`create-cycle.ts`), WhatsApp report, CSV export; `create-building.ts` when no building |
| `/admin/payments` | `payments.ts` | 1-tap paid, edit/partial/exempt/notes sheet, WhatsApp reminder, "add missing units", delete cycle |
| `/admin/expenses` | `expenses.ts` | CRUD + receipt compress (`core/image-compress.ts`) → `receipts/{building_id}/{expense_id}.jpg` |
| `/admin/units` | `units.ts` | CRUD, up/down reorder, phone normalization (`core/phone.ts`) |
| `/admin/settings` | `settings.ts` | Building fields, public URL copy, QR + printable elevator poster, privacy, announcement, emergency contacts |

Core helpers: `core/format.ts` (Arabic months, money, status/category meta, `deriveStatus`), `core/messages.ts`
(WhatsApp reminder + monthly report), `core/csv.ts`, `core/toast.service.ts` (`arabicError` maps errors to friendly Arabic).

## 6. Live environment

| Item | Value |
| --- | --- |
| GitHub | `github.com/samiralholo/building-committee-app` — **public** (GitHub blocks private repos for this account's region); Claude GitHub App installed on this repo only |
| Supabase | org `tracker` (Free), project **building-committee** (Europe), ref `slqjhpvwsctwvajpnorq`, URL `https://slqjhpvwsctwvajpnorq.supabase.co`; owner signs in with GitHub |
| Supabase state | migration 001 + seed applied; Auth "Allow new users to sign up" = **off**; 1 admin user (created by Samir); pilot building `al-yasmin-14` |
| Keys | publishable key committed in `public-config.json` (browser-safe by design). Secret keys and the DB password live only in the Supabase dashboard; never commit them |
| Vercel | team `samir-alholos-projects` (Hobby), project `building-committee-app`, auto-deploys from `main`. **Production: https://building-committee-app.vercel.app** · residents: `/b/al-yasmin-14` · admin: `/admin/login` |

Live checks (2026-11-24): public RPC returns the building with no phone fields; anon `select` on `units` → 401; `keepalive_ping` → 200; `/auth/v1/signup` → 422 `signup_disabled`.

## 7. Configuration

`scripts/set-env.mjs` → generated, git-ignored `src/environments/environment.ts`. Priority: env vars →
`.env` / `.env.local` → committed `public-config.json` (URL, publishable key, default slug).
Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `DEFAULT_BUILDING_SLUG`, optional `ENABLE_PUBLIC_SIGNUP` (default `false`).
The keep-alive workflow uses repo secrets if set, otherwise `public-config.json` (sends only the `apikey` header).
Pilot mode = Supabase "Allow new users to sign up" **off** + `ENABLE_PUBLIC_SIGNUP=false`.

## 8. Decisions & rationale

- **Digits:** Arabic text with Latin digits (`ar-SY-u-nu-latn`): clearer for numbers on phones, matches common usage.
- **Month names:** Levantine (كانون الثاني … كانون الأول), matching the spec example "تشرين الثاني 2026".
- **New cycle title:** auto-suggests the current month, or the next free month if that title already exists.
- **Payment notes are admin-only:** excluded from the public RPC (they can be personal). Expense notes are public (transparency).
- **"غير مدفوع" filter** includes partial payers (anyone who still owes).
- **Reminder greeting:** if the name already starts with أبو/أم/عائلة/السيد… it's used as is; otherwise "أبو/أم + name" per spec.
- **Receipts:** always JPEG (Safari can't always encode WebP from canvas); max 1200px, q 0.72, stepped down until < 150 KB;
  stored URL gets `?v=timestamp` so replaced photos refresh.
- **Fonts:** Google Fonts link (not build-time inlined: inlining fails without network and adds build fragility);
  the service worker caches the font files.
- **Delete confirmations:** in-app two-step buttons (no browser `confirm()` dialogs).
- **Public config committed:** the Supabase URL + publishable key sit in `public-config.json`, so Vercel and the
  GitHub cron need no secrets. Rotating the key = edit that file (or override with env vars).
- **Phone format:** stored as international digits without `+` (e.g. `963933111001`); `09…` local numbers become `963…`.

## 9. Verification done

- SQL migration + seed applied twice (idempotent) on PGlite with Supabase `auth`/`storage` stubs; verified: anon cannot read
  `units`; RPC has no phone fields; other users see 0 rows and cannot create cycles or upload; owner can; 1-click cycle makes
  7 unpaid + 1 exempt; trigger statuses; storage folder checks.
- `pnpm build` clean under `strict` + `strictTemplates`.
- Headless Chrome run against a mock Supabase (PGlite + real SQL): public page, drawer, tabs, login, dashboard,
  1-tap paid (optimistic), create cycle, units, expenses form, settings/QR — no console errors.

## 10. Backlog / ideas (not built yet)

- Per-building dynamic manifest `start_url` (today: landing redirects to the last visited building).
- Multiple admins per building (`building_members` table) when going SaaS.
- Payment receipts for residents / monthly PDF report.
- Supabase CLI config (`supabase/config.toml`) for local dev.

## 11. Change log

| Date | Change |
| --- | --- |
| 2026-11-24 | v0.1 — Initial build: schema/RLS/RPCs/storage/seed, public resident view, admin portal, PWA, Vercel config, keep-alive workflow, README, this context file. Repo created at `github.com/samiralholo/building-committee-app`. |
| 2026-11-24 | Repo made **public** and pushed. Supabase project `building-committee` created (GitHub sign-in), migration + seed applied, public signups disabled, admin user created. Added `public-config.json` (URL + publishable key + default slug) as build/cron fallback; keep-alive sends `apikey` header only. |
| 2026-11-24 | Deployed to Vercel (Git-connected, no env vars needed thanks to `public-config.json`). Verified live: `/` → `/b/al-yasmin-14` with real data, deep link → admin guard → login, service worker active. |
