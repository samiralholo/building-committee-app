import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../core/supabase.service';

export interface AdminSummary {
  user_id: string;
  /** May be a hidden synthetic phone login (<digits>@phone.lajna.app) — never render it directly. */
  email: string;
  full_name: string;
  phone: string | null;
  role: 'superadmin' | 'admin';
  assigned_at: string;
}

export interface BuildingSummary {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  currency: string;
  default_monthly_fee: number;
  created_at: string;
  unit_count: number;
  fund_balance: number;
  admins: AdminSummary[];
}

export interface Overview {
  total_buildings: number;
  active_buildings: number;
  total_units: number;
  active_admins: number;
  buildings: BuildingSummary[];
}

export interface CreateAdminResult {
  user_id: string;
  full_name: string;
  phone: string;
  already_existed: boolean;
  building: { id: string; name: string; slug: string };
}

export interface AdminPhoneResult {
  user_id: string;
  full_name: string;
  phone: string | null;
}

const SUPPORT_KEY = 'support_whatsapp_phone';

/**
 * Super Admin data access.
 *  - Reads + building CRUD go straight to Supabase (RLS: superadmin only).
 *  - Creating / removing admins and resetting passwords needs the service key,
 *    so it goes through the server-side Vercel functions in /api/superadmin/*.
 */
@Injectable({ providedIn: 'root' })
export class SuperadminApi {
  private readonly db = inject(SupabaseService).client;

  async overview(): Promise<Overview> {
    const { data, error } = await this.db.rpc('superadmin_overview');
    if (error) throw error;
    return data as Overview;
  }

  async createBuilding(input: { name: string; slug: string; currency: string; default_monthly_fee: number }): Promise<void> {
    const { error } = await this.db.from('buildings').insert(input);
    if (error) throw error;
  }

  async updateBuilding(
    id: string,
    patch: Partial<Pick<BuildingSummary, 'name' | 'slug' | 'currency' | 'default_monthly_fee' | 'is_active'>>,
  ): Promise<void> {
    const { error } = await this.db.from('buildings').update(patch).eq('id', id);
    if (error) throw error;
  }

  async deleteBuilding(id: string): Promise<void> {
    const { error } = await this.db.from('buildings').delete().eq('id', id);
    if (error) throw error;
  }

  /** Phone-based building admin (logs in with phone + password). */
  createBuildingAdmin(body: { building_id: string; full_name: string; phone: string; password: string }): Promise<CreateAdminResult> {
    return this.call<CreateAdminResult>('create-building-admin', 'POST', body);
  }

  removeBuildingAdmin(body: { building_id: string; user_id: string }): Promise<{ ok: true } & AdminPhoneResult> {
    return this.call('remove-building-admin', 'DELETE', body);
  }

  resetAdminPassword(body: { user_id: string; password: string }): Promise<{ ok: true } & AdminPhoneResult> {
    return this.call('reset-admin-password', 'POST', body);
  }

  updateAdminPhone(body: { user_id: string; new_phone: string }): Promise<AdminPhoneResult> {
    return this.call('update-admin-phone', 'POST', body);
  }

  /** Support WhatsApp shown on the login page ("نسيت كلمة المرور؟"). Superadmin-only table (RLS). */
  async getSupportWhatsapp(): Promise<string> {
    const { data, error } = await this.db.from('platform_settings').select('value').eq('key', SUPPORT_KEY).maybeSingle();
    if (error) throw error;
    return (data?.value as string | undefined) ?? '';
  }

  async setSupportWhatsapp(normalizedPhone: string): Promise<void> {
    const { error } = await this.db
      .from('platform_settings')
      .upsert({ key: SUPPORT_KEY, value: normalizedPhone }, { onConflict: 'key' });
    if (error) throw error;
  }

  private async call<T>(path: string, method: 'POST' | 'DELETE', body: unknown): Promise<T> {
    const { data } = await this.db.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('انتهت الجلسة، سجّل دخول من جديد');
    let res: Response;
    try {
      res = await fetch(`/api/superadmin/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('ما في اتصال بالإنترنت');
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      if (res.status === 404) throw new Error('خدمة إدارة المشرفين غير منشورة بعد على Vercel');
      throw new Error(json.error || 'صار خطأ بالخادم');
    }
    return json as T;
  }
}
