import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  readonly session = signal<Session | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly isLoggedIn = computed(() => this.session() !== null);

  /** Resolves once the stored session (if any) has been restored. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    if (!this.supabase.configured) return;
    try {
      const { data } = await this.supabase.client.auth.getSession();
      this.session.set(data.session);
    } catch {
      this.session.set(null);
    }
    this.supabase.client.auth.onAuthStateChange((_event, session) => this.session.set(session));
  }

  async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.session.set(data.session);
  }

  async signUp(email: string, password: string): Promise<void> {
    const { data, error } = await this.supabase.client.auth.signUp({ email, password });
    if (error) throw error;
    this.session.set(data.session);
  }

  async signOut(): Promise<void> {
    await this.supabase.client.auth.signOut();
    this.session.set(null);
  }
}
