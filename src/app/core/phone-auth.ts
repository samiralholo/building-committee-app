// ============================================================================
//  Phone normalization + phone-based login identity (Synthetic Email Pattern)
//
//  ONE pure module, imported unchanged by:
//    - the Angular app (src/app/**)
//    - the Vercel functions (api/superadmin/**)
//    - the unit tests (tests/phone-auth.test.ts, run with node --test)
//  Keep it dependency-free and use only erasable TypeScript (no enums/namespaces).
//
//  Building admins log in with "mobile number + password". Supabase Auth needs an
//  email, so each phone maps to a synthetic address <digits>@phone.lajna.app that
//  is NEVER shown to anyone (UI, messages, API responses meant for people).
// ============================================================================

export const DEFAULT_COUNTRY_CODE = '963';
export const SYNTHETIC_PHONE_DOMAIN = 'phone.lajna.app';
export const PHONE_INVALID_MESSAGE = 'يرجى إدخال رقم موبايل صحيح (مثال: 0912345678)';

/** International digits only, no "+", no leading zero, 10–15 digits (E.164 length). */
export const NORMALIZED_PHONE_PATTERN = /^[1-9]\d{9,14}$/;

export type PhoneResult = { ok: true; phone: string } | { ok: false; error: string };

export type LoginIdentifier =
  | { kind: 'email'; authEmail: string }
  | { kind: 'phone'; normalizedPhone: string; authEmail: string }
  | { kind: 'invalid'; error: string };

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', // Eastern Arabic
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', // Persian / Urdu
};

/** Spaces (incl. NBSP), dashes (ASCII + Unicode), parentheses, dots, slashes and invisible bidi marks. */
const SEPARATORS = /[\s  -​‐-―−\-().\/‎‏‪-‮⁦-⁩﻿]/g;

/**
 * Turns anything a person might type into international digits, or explains why it can't.
 *   "٠٩١٢٣٤٥٦٧٨"        → 963912345678
 *   "+963 912-345-678"  → 963912345678
 *   "00963912345678"    → 963912345678
 *   "0912345678"        → 963912345678   (local: drop 0, add country code)
 *   "912345678"         → 963912345678   (9 digits starting with 9)
 *   "+971501234567"     → 971501234567   (other countries kept as typed)
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): PhoneResult {
  const fail: PhoneResult = { ok: false, error: PHONE_INVALID_MESSAGE };
  if (typeof raw !== 'string') return fail;

  let s = raw.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d).replace(SEPARATORS, '');
  if (!/^\+?\d+$/.test(s)) return fail;

  let international = false;
  if (s.startsWith('+')) {
    s = s.slice(1);
    international = true;
  } else if (s.startsWith('00')) {
    s = s.slice(2);
    international = true;
  }

  if (international) {
    // "+963 0912…": a local trunk 0 typed after the country code
    if (s.startsWith(defaultCountryCode + '0')) s = defaultCountryCode + s.slice(defaultCountryCode.length + 1);
  } else if (s.startsWith('0') && s.length >= 9 && s.length <= 11) {
    s = defaultCountryCode + s.slice(1);
  } else if (s.startsWith('9') && s.length === 9) {
    s = defaultCountryCode + s;
  }

  return NORMALIZED_PHONE_PATTERN.test(s) ? { ok: true, phone: s } : fail;
}

/** Normalized digits or '' (for optional fields and lenient display). */
export function normalizePhoneOrEmpty(raw: string | null | undefined, defaultCountryCode: string = DEFAULT_COUNTRY_CODE): string {
  const r = normalizePhone(raw, defaultCountryCode);
  return r.ok ? r.phone : '';
}

export function isNormalizedPhone(value: string | null | undefined): boolean {
  return typeof value === 'string' && NORMALIZED_PHONE_PATTERN.test(value);
}

export function phoneToAuthEmail(normalizedPhone: string): string {
  return `${normalizedPhone}@${SYNTHETIC_PHONE_DOMAIN}`;
}

export function isSyntheticPhoneEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith('@' + SYNTHETIC_PHONE_DOMAIN);
}

/** Real email to show people, or null when the address is a synthetic phone login. */
export function displayableEmail(email: string | null | undefined): string | null {
  return email && !isSyntheticPhoneEmail(email) ? email : null;
}

/**
 * "963912345678" → "+963 912 345 678". Render inside dir="ltr".
 * Other countries are shown as "+<digits>" (no guessing of country-code length).
 */
export function formatPhoneForDisplay(normalizedPhone: string | null | undefined): string {
  if (!normalizedPhone) return '';
  const d = normalizedPhone.replace(/\D/g, '');
  if (d.startsWith(DEFAULT_COUNTRY_CODE) && d.length === 12) {
    return `+${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  }
  return d ? '+' + d : '';
}

/**
 * Phone inside an Arabic sentence (WhatsApp messages). Spaced groups get reordered by the
 * bidi algorithm in RTL text, so use one unbroken token:
 *   Syrian  "963912345678" → "0912345678"  (exactly what admins type at login)
 *   others  "971501234567" → "\u200E+971501234567" (LRM keeps the "+" in front)
 */
export function formatPhoneForMessage(normalizedPhone: string): string {
  const d = normalizedPhone.replace(/\D/g, '');
  if (d.startsWith(DEFAULT_COUNTRY_CODE) && d.length === 12) return '0' + d.slice(3);
  return '\u200E+' + d;
}

/** Login box accepts "mobile number OR email": emails pass through, phones become their synthetic login email. */
export function resolveLoginIdentifier(input: string | null | undefined): LoginIdentifier {
  const trimmed = (input ?? '').trim();
  if (trimmed.includes('@')) return { kind: 'email', authEmail: trimmed.toLowerCase() };
  const r = normalizePhone(trimmed);
  if (!r.ok) return { kind: 'invalid', error: r.error };
  return { kind: 'phone', normalizedPhone: r.phone, authEmail: phoneToAuthEmail(r.phone) };
}
