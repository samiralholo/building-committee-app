// App-facing phone helpers. ALL normalization rules live in ./phone-auth (shared with /api and tests).
import { formatPhoneForDisplay, normalizePhone, normalizePhoneOrEmpty } from './phone-auth';

/** Normalized international digits, or '' when the input isn't a valid number. */
export function phoneDigits(raw: string | null | undefined): string {
  return normalizePhoneOrEmpty(raw);
}

/** For input fields on blur: tidy a valid number, leave anything else untouched so the user can fix it. */
export function tidyPhoneInput(raw: string | null | undefined): string {
  const r = normalizePhone(raw);
  return r.ok ? r.phone : (raw ?? '').trim();
}

/** True when the raw input normalizes to a valid international number. */
export function isValidPhone(raw: string | null | undefined): boolean {
  return normalizePhone(raw).ok;
}

/** For tel: links we keep a leading "+" so the dialer understands international numbers. */
export function telHref(phone: string): string {
  const n = phoneDigits(phone);
  return n ? `tel:+${n}` : `tel:${phone}`;
}

export function waHref(phone: string, text?: string): string {
  const base = `https://wa.me/${phoneDigits(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** "963933111001" → "+963 933 111 001" (display only; render with dir="ltr"). */
export function prettyPhone(phone: string | null | undefined): string {
  const n = phoneDigits(phone);
  return n ? formatPhoneForDisplay(n) : (phone ?? '');
}
