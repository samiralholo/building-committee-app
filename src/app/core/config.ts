import { environment } from '../../environments/environment';

/**
 * Pilot-mode guardrail. While false, there is no public signup anywhere in the UI:
 * building admins are created by the Super Admin (/superadmin → /api/superadmin/*).
 */
export const ENABLE_PUBLIC_SIGNUP: boolean = environment.enablePublicSignup;

export const SUPABASE_URL: string = environment.supabaseUrl;
export const SUPABASE_ANON_KEY: string = environment.supabaseAnonKey;
export const SUPABASE_CONFIGURED: boolean = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const RECEIPTS_BUCKET = 'receipts';

/** Residents' building, remembered so the installed app icon always opens it directly. */
export const LAST_SLUG_STORAGE_KEY = 'last_visited_building_slug';
/** Pre-upgrade key, migrated on first read. */
export const LEGACY_LAST_SLUG_STORAGE_KEY = 'bc:last-slug';
