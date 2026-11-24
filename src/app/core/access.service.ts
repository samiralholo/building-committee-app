import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export type Role = 'superadmin' | 'admin';

export interface AssignedBuilding {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface MyAccess {
  user_id: string;
  role: Role;
  full_name: string;
  buildings: AssignedBuilding[];
}

/** Role + assigned buildings of the signed-in user (from the `get_my_access` RPC). */
@Injectable({ providedIn: 'root' })
export class AccessService {
  private readonly db = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  readonly access = signal<MyAccess | null>(null);
  readonly isSuperadmin = computed(() => this.access()?.role === 'superadmin');
  readonly buildings = computed(() => this.access()?.buildings ?? []);
  private inflight: Promise<MyAccess | null> | null = null;
  private loadedFor: string | null = null;

  /** Cached per user; pass force=true after assignments change. */
  async load(force = false): Promise<MyAccess | null> {
    await this.auth.ready;
    const uid = this.auth.user()?.id ?? null;
    if (!uid) {
      this.access.set(null);
      this.loadedFor = null;
      return null;
    }
    if (!force && this.loadedFor === uid && this.access()) return this.access();
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const { data, error } = await this.db.rpc('get_my_access');
      this.inflight = null;
      if (error) throw error;
      const acc = data as MyAccess;
      this.access.set(acc);
      this.loadedFor = uid;
      return acc;
    })();
    return this.inflight;
  }

  /** Where this user belongs after signing in. */
  homeUrl(acc: MyAccess | null): string {
    if (!acc) return '/admin/login';
    if (acc.role === 'superadmin') return '/superadmin';
    return '/admin';
  }

  clear(): void {
    this.access.set(null);
    this.loadedFor = null;
  }
}
