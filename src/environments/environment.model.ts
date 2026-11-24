export interface AppEnvironment {
  /** e.g. https://xxxx.supabase.co */
  supabaseUrl: string;
  /** Public anon key (safe in the browser — data is protected by RLS). */
  supabaseAnonKey: string;
  /** Keep false during the pilot. Flip to true when opening the app to other buildings. */
  enablePublicSignup: boolean;
}
