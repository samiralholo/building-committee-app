import { environment } from '../../environments/environment';

/**
 * Pilot-mode guardrail. While false, there is no public signup anywhere in the UI:
 * admins are created manually in Supabase Auth. Set ENABLE_PUBLIC_SIGNUP=true
 * (env var) when you are ready to open the app to other buildings.
 */
export const ENABLE_PUBLIC_SIGNUP: boolean = environment.enablePublicSignup;

export const DEFAULT_BUILDING_SLUG: string = environment.defaultBuildingSlug;

export const SUPABASE_CONFIGURED: boolean = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);

export const RECEIPTS_BUCKET = 'receipts';

export const LAST_SLUG_STORAGE_KEY = 'bc:last-slug';
