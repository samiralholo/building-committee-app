const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Normalizes whatever the admin types into WhatsApp's international format (digits only, no "+").
 *  "+963 933 111 001" → "963933111001"
 *  "00963933111001"   → "963933111001"
 *  "0933111001"       → "963933111001"  (local Syrian mobile, uses default country code)
 */
export function normalizePhone(input: string | null | undefined, defaultCountryCode = '963'): string {
  if (!input) return '';
  let digits = input.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] ?? d).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) {
    digits = defaultCountryCode + digits.slice(1);
  }
  return digits;
}

export function isValidPhone(digits: string): boolean {
  return /^[0-9]{8,15}$/.test(digits);
}

/** For tel: links we keep a leading "+" so the dialer understands international numbers. */
export function telHref(phone: string): string {
  const n = normalizePhone(phone);
  return n ? `tel:+${n}` : `tel:${phone}`;
}

export function waHref(phone: string, text?: string): string {
  const n = normalizePhone(phone);
  const base = `https://wa.me/${n}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** "963933111001" → "+963 933 111 001" (display only). */
export function prettyPhone(phone: string | null | undefined): string {
  const n = normalizePhone(phone);
  if (!n) return '';
  if (n.startsWith('963') && n.length === 12) return `+963 ${n.slice(3, 6)} ${n.slice(6, 9)} ${n.slice(9)}`;
  return `+${n}`;
}
