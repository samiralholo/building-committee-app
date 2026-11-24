import { ExpenseCategory, PaymentStatus } from './models';

/** Arabic text with Latin digits: crisp, tabular, easy to read for everyone. */
const LOCALE = 'ar-SY-u-nu-latn';

const numberFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

export function formatNumber(value: number | null | undefined): string {
  return numberFmt.format(Number(value ?? 0));
}

export function formatMoney(value: number | null | undefined, currency: string): string {
  return `${formatNumber(value)} ${currency}`;
}

/** Levantine month names, as written on the paper sheet in the elevator. */
export const ARABIC_MONTHS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
] as const;

export function currentMonthTitle(date = new Date()): string {
  return `${ARABIC_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Plain dates ("2026-11-01") are local calendar days, not UTC instants.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' }).format(d);
  return `${formatDate(d)} - ${time}`;
}

/** "اليوم" / "مبارح" / "قبل 3 أيام" / full date — friendlier than raw timestamps. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' }).format(d);
  if (days === 0) return `اليوم ${time}`;
  if (days === 1) return `مبارح ${time}`;
  if (days > 1 && days < 7) return `قبل ${days} أيام`;
  return formatDate(d);
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface StatusMeta {
  label: string;
  icon: 'check' | 'x' | 'clock' | 'minus';
  classes: string;
}

export const STATUS_META: Record<PaymentStatus, StatusMeta> = {
  paid: { label: 'خالص', icon: 'check', classes: 'bg-paid-bg text-paid' },
  unpaid: { label: 'غير مدفوع', icon: 'x', classes: 'bg-unpaid-bg text-unpaid' },
  partial: { label: 'دفع جزء', icon: 'clock', classes: 'bg-partial-bg text-partial' },
  exempt: { label: 'شقة فارغة / معفى', icon: 'minus', classes: 'bg-exempt-bg text-exempt' },
};

export interface CategoryMeta {
  label: string;
  icon: 'bolt' | 'droplet' | 'elevator' | 'broom' | 'wrench' | 'receipt';
}

export const CATEGORY_META: Record<ExpenseCategory, CategoryMeta> = {
  electricity: { label: 'كهرباء', icon: 'bolt' },
  water: { label: 'مي', icon: 'droplet' },
  elevator: { label: 'مصعد', icon: 'elevator' },
  cleaning: { label: 'تنظيف', icon: 'broom' },
  maintenance: { label: 'صيانة', icon: 'wrench' },
  general: { label: 'عام', icon: 'receipt' },
};

export const CATEGORY_OPTIONS = Object.entries(CATEGORY_META).map(([value, meta]) => ({
  value: value as ExpenseCategory,
  label: meta.label,
}));

export function remaining(p: { amount_due: number; amount_paid: number; status: PaymentStatus }): number {
  if (p.status === 'exempt' || p.status === 'paid') return 0;
  return Math.max(Number(p.amount_due) - Number(p.amount_paid), 0);
}

/** Same rules as the `payments_normalize` DB trigger — used for optimistic UI. */
export function deriveStatus(amountDue: number, amountPaid: number, exempt: boolean): PaymentStatus {
  if (exempt) return 'exempt';
  if (amountPaid >= amountDue && (amountDue > 0 || amountPaid > 0)) return 'paid';
  if (amountPaid > 0) return 'partial';
  if (amountDue === 0) return 'paid';
  return 'unpaid';
}

/** Turns any typed slug into a valid URL slug (latin lowercase, digits, dashes). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const AR_TO_LATIN: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'e', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'th',
  ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q',
  ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'w', ي: 'y', ى: 'a', ئ: 'e', ؤ: 'o', ء: '',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** "بناء الياسمين - مدخل أ" → "alyasmin-mdkhl-a" (drops the generic word "بناء"). */
export function suggestSlug(name: string): string {
  const cleaned = name.replace(/^\s*(بناء|بناية|عمارة|برج)\s+/u, '');
  const latin = [...cleaned].map((ch) => AR_TO_LATIN[ch] ?? ch).join('');
  return slugify(latin);
}
