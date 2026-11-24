// Server-only helpers for /api/superadmin/* (Vercel Functions, Node runtime).
// Files under api/_lib are not exposed as routes (leading underscore).
//
// Required Vercel environment variables (Project → Settings → Environment Variables):
//   SUPABASE_URL               https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Supabase secret key (sb_secret_…) or legacy service_role JWT
// The service key is used ONLY here and never reaches the browser bundle.
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { normalizePhone } from '../../src/app/core/phone-auth';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let cached: SupabaseClient | null = null;

/** Service-role client (bypasses RLS) — only after the caller is verified as superadmin. */
export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new HttpError(500, 'الخادم غير مضبوط: أضف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في إعدادات Vercel');
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return cached;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Wraps a handler: maps HttpError → JSON error, hides internal errors. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error('[superadmin-api]', err);
      return json(500, { error: 'صار خطأ بالخادم، جرّب مرة ثانية' });
    }
  };
}

/** Verifies the Bearer JWT with Supabase Auth and requires profiles.role = 'superadmin'. */
export async function requireSuperadmin(req: Request): Promise<User> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'لازم تسجّل دخول');

  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'انتهت الجلسة، سجّل دخول من جديد');

  const { data: profile, error: pErr } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (pErr) throw pErr;
  if (profile?.role !== 'superadmin') throw new HttpError(403, 'هالعملية للمشرف العام فقط');
  return data.user;
}

export async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'طلب غير صالح');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, `قيمة غير صالحة: ${field}`);
  return value;
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    throw new HttpError(400, 'كلمة السر لازم تكون 8 أحرف على الأقل');
  }
  return value;
}

/** Same normalization as the app (src/app/core/phone-auth.ts). 400 with the Arabic message if invalid. */
export function requirePhone(value: unknown): string {
  const r = normalizePhone(typeof value === 'string' ? value : '');
  if (!r.ok) throw new HttpError(400, r.error);
  return r.phone;
}

export function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  if (!name) throw new HttpError(400, 'اكتب اسم المشرف');
  return name;
}
