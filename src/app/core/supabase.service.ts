import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { SUPABASE_CONFIGURED } from './config';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured = SUPABASE_CONFIGURED;

  /** Real client when configured; a harmless placeholder otherwise (calls fail with a clear message). */
  readonly client: SupabaseClient = createClient(
    SUPABASE_CONFIGURED ? environment.supabaseUrl : 'https://not-configured.invalid',
    SUPABASE_CONFIGURED ? environment.supabaseAnonKey : 'not-configured',
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'bc-admin-auth',
      },
    },
  );
}
