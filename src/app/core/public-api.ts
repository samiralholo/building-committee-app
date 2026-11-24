import { LAST_SLUG_STORAGE_KEY, LEGACY_LAST_SLUG_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from './config';
import { PublicDashboard } from './models';

/**
 * Tiny fetch-based client for the two PUBLIC RPCs.
 * Residents never download supabase-js: the public route only needs these POSTs.
 * Requests always go to the network (never served from a cache) so payment
 * statuses are fresh the moment an admin marks a unit as paid.
 */
export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'config' | 'server',
  ) {
    super(message);
  }
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_CONFIGURED) throw new PublicApiError('not configured', 'config');
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PublicApiError('network', 'network');
  }
  if (!res.ok) throw new PublicApiError(`HTTP ${res.status}`, 'server');
  return (await res.json()) as T;
}

export interface LandingState {
  building_count: number;
  single_slug: string | null;
  resolved_slug: string | null;
}

export function getLandingState(slug?: string): Promise<LandingState> {
  return rpc<LandingState>('get_public_landing_state', slug ? { p_slug: slug } : {});
}

/** Returns null when the slug (or its old/renamed form) doesn't exist or the building is inactive. */
export function getPublicDashboard(slug: string): Promise<PublicDashboard | null> {
  return rpc<PublicDashboard | null>('get_public_building_dashboard', { p_slug: slug });
}

// ---------------------------------------------------------------- remembered slug

export function readLastSlug(): string {
  try {
    const current = localStorage.getItem(LAST_SLUG_STORAGE_KEY);
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_LAST_SLUG_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(LAST_SLUG_STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_LAST_SLUG_STORAGE_KEY);
      return legacy;
    }
  } catch {
    /* storage blocked */
  }
  return '';
}

export function rememberSlug(slug: string): void {
  try {
    localStorage.setItem(LAST_SLUG_STORAGE_KEY, slug);
  } catch {
    /* ignore */
  }
}

export function forgetSlug(slug?: string): void {
  try {
    if (!slug || localStorage.getItem(LAST_SLUG_STORAGE_KEY) === slug) localStorage.removeItem(LAST_SLUG_STORAGE_KEY);
    localStorage.removeItem(LEGACY_LAST_SLUG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Platform support WhatsApp (normalized digits) for "نسيت كلمة المرور؟", or null when not configured. */
export async function getSupportWhatsapp(): Promise<string | null> {
  const v = await rpc<string | null>('get_support_whatsapp', {});
  return typeof v === 'string' && v ? v : null;
}
