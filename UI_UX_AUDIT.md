# UI/UX Audit — لجنة البناء (v0.2, 2026-11-24)

Audience: everyday neighbors, some elderly or with low literacy, on phones. Audit done in headless Chrome at
**360px, 375px and 390px (iOS UA)** plus desktop 1280px, with an automated check on every screen for
horizontal overflow and interactive elements shorter than 44px.

**Result after fixes:** 0px horizontal overflow on every screen at 360/375px · 0 interactive elements under 48px ·
0 console errors across resident, building-admin and super-admin flows.

## Resident view `/b/:slug`

| # | Issue found (before) | Fix (after) |
|---|---|---|
| R1 | Pinned announcement sat **above** the fund card; a long notice pushed the balance below the fold. | Fund card ("صندوق البناء") is first: balance in 36px `tabular-nums`, 2-column المقبوضات/المصاريف, month progress bar. Its bottom edge is at **~210px** on a 360px phone. Announcement follows, clamped to 2 lines with «اقرأ الإعلان كامل». |
| R2 | Tab label «المصاريف والفواتير» wrapped onto 2 lines in the bottom bar. | Short labels: **الدفعات · المصاريف · خدمات البناء**; bar items are **64px** tall (≥56px), icon + label, sticky at the bottom with safe-area padding. |
| R3 | The page rendered the **saved copy first**, so a resident could briefly see «غير مدفوع» after the admin had already marked it paid. | Network-first: skeleton until fresh data arrives. The saved copy is used **only** when offline, with a grey «ما في إنترنت» notice. |
| R4 | Receipt lightbox showed the photo at screen size only; small text on bills was unreadable. | New zoomable lightbox: tap → 250% zoom with drag/scroll, pinch-zoom allowed, «فتح الصورة الأصلية» button, Esc/close. Also used in the admin and super-admin screens. |
| R5 | No guidance to "install" the page; iPhone users can't get a native prompt. | Dismissible banner «ثبّت التطبيق على شاشة هاتفك لمتابعة الدفعات بضغطة واحدة». Android/Chrome → native prompt; iOS → 2-step visual guide (share ⬆️ → «إضافة إلى الشاشة الرئيسية»). Hidden once installed; dismissal remembered 14 days. |
| R6 | Old QR codes would break if a building's code was renamed. | Old slugs resolve server-side; the page silently switches to the new address. |
| R7 | Status meaning relied on reading. | Kept and verified: every status = soft color + icon + short label (خالص ✓ · غير مدفوع ✗ · دفع جزء ◷ · شقة فارغة / معفى –). |

## Root `/`

| # | Before | After |
|---|---|---|
| L1 | Hard-coded pilot slug `al-yasmin-14` in config. | Removed. `/` asks the server (`get_public_landing_state`): remembered building → open it (validated, follows renames); exactly one building → open it; otherwise a minimal code form + subtle «دخول المشرف». |
| L2 | Wrong code → blank "not found" page. | Inline Arabic error under the field; no navigation. |

## Building admin `/admin`

| # | Before | After |
|---|---|---|
| A1 | Toggles (معفى، مسكونة، إخفاء الأسماء) were 32px switches. | The **whole 56px row** is the switch (`role="switch"`), easier for thumbs and screen readers. |
| A2 | Unit reorder arrows were 40px. | 48px buttons, side by side. |
| A3 | WhatsApp reminder showed for any stored number. | Only shown when the number normalizes to valid international digits (no `+`, no leading `0`/`00`). |
| A4 | Compression feedback read «1.2 م.ب ← 98 ك.ب» (arrow direction confusing in RTL). | Green confirmation chip «انضغطت الصورة: `2.4MB → 115KB`» (LTR island). |
| A5 | Receipt thumbnails opened a new browser tab. | Open the in-app zoomable lightbox. |
| A6 | No way to change the initial password. | «الإعدادات ← حسابي ← تغيير كلمة السر». |
| A7 | Renaming the building code warned that old QR codes would stop working. | They don't anymore (redirects); the hint now says so. |
| A8 | 1-tap «تم الدفع»: already optimistic. | Verified: badge flips instantly, reverts with an Arabic toast on failure. |

## Super admin `/superadmin` (new)

- KPI row (الأبنية · الشقق · المشرفين), search, building cards with status, admin names (⚠️ «بدون مشرف»), public link, fund balance.
- «إضافة بناء جديد»: slug auto-suggested from the Arabic name, live preview of the public URL.
- «تعيين / إدارة المشرف»: add (new or existing email), remove, new password; result card with **«نسخ بيانات الدخول لإرسالها عبر واتساب»** and a direct WhatsApp button.
- «معاينة تفاصيل البناء»: sticky amber banner **«وضع المعاينة (سوبر أدمن - للقراءة فقط)»**, zero mutation buttons (automated check: 0 found), payments/expenses/settings/QR poster.
- Header title shortened to «لوحة التحكم» so it doesn't truncate on 375px.

## Global

- Update banner «يتوفر تحديث جديد — اضغط للتحديث» when a new deploy is ready (checked again when the app returns to the foreground).
- Skeleton loaders on every async view (landing, resident, admin shell, super-admin overview, inspect).
- Elevator poster: A4 `@page`, `print-color-adjust: exact`, large Cairo type, QR 380px, «بدون تسجيل وبدون كلمة سر».

Screenshots of the audited screens were produced during verification (`375-*.png`, `360-*.png`, `ios-*.png`).
