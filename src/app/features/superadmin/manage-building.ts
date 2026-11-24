import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessService } from '../../core/access.service';
import { slugify } from '../../core/format';
import { adminCredentialsMessage, copyText } from '../../core/messages';
import { generatePassword } from '../../core/password';
import { waHref } from '../../core/phone';
import { displayableEmail, formatPhoneForDisplay, normalizePhone } from '../../core/phone-auth';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { AdminSummary, BuildingSummary, SuperadminApi } from './superadmin-api';

interface Credentials {
  fullName: string;
  phone: string;
  password: string | null;
}

/** Live "+963 912 345 678" preview (or the Arabic error) for a phone field. */
function previewOf(raw: string): { ok: boolean; text: string } {
  if (!raw.trim()) return { ok: false, text: '' };
  const r = normalizePhone(raw);
  return r.ok ? { ok: true, text: formatPhoneForDisplay(r.phone) } : { ok: false, text: r.error };
}

/**
 * Super Admin sheet: assign/replace building heads (phone + password), edit their phone, reset passwords,
 * edit/disable/delete the building. The hidden synthetic login email is never rendered.
 */
@Component({
  selector: 'app-manage-building',
  imports: [FormsModule, Icon, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sheet [open]="!!building()" [title]="building()?.name ?? ''" [wide]="true" (closed)="closed.emit()">
      @if (building(); as b) {
        <div class="space-y-6">
          <!-- Credentials ready to send -->
          @if (creds(); as c) {
            <section class="space-y-3 rounded-2xl border-2 border-paid/40 bg-paid-bg/60 p-4" aria-live="polite">
              <p class="flex items-center gap-2 text-lg font-extrabold text-paid"><app-icon name="check" [stroke]="3" /> جاهز! ابعت بيانات الدخول</p>
              <pre class="max-h-56 overflow-auto rounded-xl bg-white p-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink" dir="rtl">{{ credsText() }}</pre>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" class="btn-secondary" (click)="copyCreds()">
                  <app-icon name="copy" /> نسخ بيانات الدخول
                </button>
                <a class="btn-whatsapp" [href]="waLink()" target="_blank" rel="noopener">
                  <app-icon name="whatsapp" /> إرسال عبر واتساب
                </a>
              </div>
              <button type="button" class="btn-ghost w-full" (click)="creds.set(null)">تم</button>
            </section>
          }

          <!-- Current admins -->
          <section class="space-y-2">
            <h3 class="text-lg font-extrabold">مشرفين البناء</h3>
            @for (a of b.admins; track a.user_id) {
              <div class="rounded-2xl border border-line p-3" data-testid="admin-row">
                <div class="flex items-start gap-3">
                  <div class="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft font-extrabold text-brand">
                    {{ (a.full_name || '؟').charAt(0) }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-bold">
                      {{ a.full_name || 'بدون اسم' }}
                      @if (a.role === 'superadmin') {
                        <span class="ms-1 rounded-full bg-ink px-2 py-0.5 text-xs text-white">سوبر أدمن</span>
                      }
                    </p>
                    @if (a.phone) {
                      <p class="num text-base font-semibold text-ink-soft" dir="ltr" style="text-align: end">{{ fmtPhone(a.phone) }}</p>
                    }
                    @if (realEmail(a.email); as em) {
                      <p class="truncate text-sm text-ink-soft" dir="ltr" style="text-align: end">{{ em }}</p>
                    }
                  </div>
                  @if (a.phone) {
                    <a class="btn-icon shrink-0 text-[#128C4B]" [href]="wa(a.phone)" target="_blank" rel="noopener" [attr.aria-label]="'واتساب ' + (a.full_name || '')">
                      <app-icon name="whatsapp" [size]="24" />
                    </a>
                  }
                </div>

                @switch (actionFor(a.user_id)) {
                  @case ('phone') {
                    <form class="mt-3 space-y-2" (ngSubmit)="savePhone(a)">
                      <label class="label" [for]="'ep-' + a.user_id">رقم الموبايل الجديد (واتساب)</label>
                      <input [id]="'ep-' + a.user_id" name="ep" type="tel" inputmode="tel" dir="ltr" class="field num text-start" autocomplete="off"
                        [ngModel]="editPhone()" (ngModelChange)="editPhone.set($event)" />
                      @if (editPreview().text) {
                        <p class="text-sm font-semibold" [class.text-paid]="editPreview().ok" [class.text-unpaid]="!editPreview().ok">
                          {{ editPreview().ok ? '✓' : '' }} <span [attr.dir]="editPreview().ok ? 'ltr' : null" class="num">{{ editPreview().text }}</span>
                        </p>
                      }
                      <div class="grid grid-cols-2 gap-2">
                        <button type="submit" class="btn-primary" [disabled]="busy() || !editPreview().ok">حفظ الرقم</button>
                        <button type="button" class="btn-secondary" (click)="action.set(null)">إلغاء</button>
                      </div>
                    </form>
                  }
                  @case ('password') {
                    <form class="mt-3 space-y-2" (ngSubmit)="resetPassword(a)">
                      <label class="label" [for]="'rp-' + a.user_id">كلمة المرور الجديدة</label>
                      <div class="flex gap-2">
                        <input [id]="'rp-' + a.user_id" name="rp" class="field num flex-1 text-start" dir="ltr" minlength="8" required autocomplete="off" [(ngModel)]="resetPw" />
                        <button type="button" class="btn-icon" aria-label="توليد كلمة مرور" (click)="resetPw = gen()"><app-icon name="refresh" /></button>
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <button type="submit" class="btn-primary" [disabled]="busy() || resetPw.length < 8">حفظ</button>
                        <button type="button" class="btn-secondary" (click)="action.set(null)">إلغاء</button>
                      </div>
                    </form>
                  }
                  @case ('remove') {
                    <div class="mt-3 space-y-2">
                      <p class="font-bold text-unpaid">إزالة {{ a.full_name || 'هالمشرف' }} من إدارة هالبناء؟ (حسابه بيضل موجود)</p>
                      <div class="grid grid-cols-2 gap-2">
                        <button type="button" class="btn-danger" [disabled]="busy()" (click)="remove(a)">نعم، أزله</button>
                        <button type="button" class="btn-secondary" (click)="action.set(null)">إلغاء</button>
                      </div>
                    </div>
                  }
                  @default {
                    <div class="mt-3 grid grid-cols-3 gap-2">
                      <button type="button" class="btn-secondary px-2 text-sm" [disabled]="a.role === 'superadmin'" (click)="startPhone(a)">
                        <app-icon name="phone" [size]="18" /> تعديل الرقم
                      </button>
                      <button type="button" class="btn-secondary px-2 text-sm" [disabled]="a.role === 'superadmin'" (click)="startReset(a)">
                        <app-icon name="key" [size]="18" /> كلمة مرور
                      </button>
                      <button type="button" class="btn-ghost px-2 text-sm text-unpaid" (click)="startRemove(a)">
                        <app-icon name="trash" [size]="18" /> إزالة
                      </button>
                    </div>
                  }
                }
              </div>
            } @empty {
              <p class="rounded-xl bg-partial-bg p-3 font-semibold text-partial">⚠️ هالبناء بدون مشرف. أضف مشرف تحت.</p>
            }
          </section>

          <!-- Add admin (phone + password) -->
          <section class="space-y-3 rounded-2xl bg-page p-4">
            <h3 class="flex items-center gap-2 text-lg font-extrabold"><app-icon name="userPlus" /> إضافة مشرف للبناء</h3>
            <p class="text-sm text-ink-soft">المشرف بيدخل برقم موبايله وكلمة المرور. إذا الرقم عنده حساب من قبل، بس بينربط بهالبناء.</p>
            <form class="space-y-3" (ngSubmit)="addAdmin()">
              <div>
                <label class="label" for="na-name">الاسم الكامل</label>
                <input id="na-name" name="full_name" class="field" required placeholder="أبو سامر" [(ngModel)]="naName" />
              </div>
              <div>
                <label class="label" for="na-phone">رقم الموبايل (واتساب)</label>
                <input id="na-phone" name="phone" type="tel" inputmode="tel" dir="ltr" class="field num text-start" placeholder="09xxxxxxxx" autocomplete="off"
                  [ngModel]="naPhone()" (ngModelChange)="naPhone.set($event)" />
                @if (naPreview().text) {
                  <p class="mt-1 text-sm font-semibold" [class.text-paid]="naPreview().ok" [class.text-unpaid]="!naPreview().ok">
                    {{ naPreview().ok ? '✓' : '' }} <span [attr.dir]="naPreview().ok ? 'ltr' : null" class="num">{{ naPreview().text }}</span>
                  </p>
                }
              </div>
              <div>
                <label class="label" for="na-pw">كلمة المرور</label>
                <div class="flex gap-2">
                  <input id="na-pw" name="password" class="field num flex-1 text-start" dir="ltr" minlength="8" required autocomplete="off" [(ngModel)]="naPassword" />
                  <button type="button" class="btn-icon" aria-label="توليد كلمة مرور جديدة" (click)="naPassword = gen()"><app-icon name="refresh" /></button>
                </div>
              </div>
              <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || !naName.trim() || !naPreview().ok || naPassword.length < 8">
                <app-icon name="userPlus" /> {{ busy() ? 'جاري الحفظ…' : 'تعيين كمشرف' }}
              </button>
            </form>
          </section>

          <!-- Building info -->
          <section class="space-y-3 rounded-2xl border border-line p-4">
            <h3 class="text-lg font-extrabold">معلومات البناء</h3>
            <form class="space-y-3" (ngSubmit)="saveInfo()">
              <div>
                <label class="label" for="bi-name">الاسم</label>
                <input id="bi-name" name="name" class="field" required [(ngModel)]="biName" />
              </div>
              <div>
                <label class="label" for="bi-slug">الرمز</label>
                <input id="bi-slug" name="slug" class="field text-start" dir="ltr" required [(ngModel)]="biSlug" (blur)="biSlug = slugify(biSlug)" />
                @if (slugify(biSlug) !== b.slug) {
                  <p class="mt-1 text-sm font-semibold text-partial">ℹ️ الرابط والـ QR القديم بيضلوا شغالين ويحوّلوا للرمز الجديد.</p>
                }
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="bi-fee">الاشتراك الشهري</label>
                  <input id="bi-fee" name="fee" type="number" min="0" inputmode="decimal" class="field num" [(ngModel)]="biFee" />
                </div>
                <div>
                  <label class="label" for="bi-cur">العملة</label>
                  <input id="bi-cur" name="currency" class="field" [(ngModel)]="biCurrency" />
                </div>
              </div>
              <button type="submit" class="btn-secondary w-full" [disabled]="busy()">حفظ المعلومات</button>
            </form>

            <button
              type="button"
              role="switch"
              [attr.aria-checked]="b.is_active"
              class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-page px-4 text-start"
              [disabled]="busy()"
              (click)="toggleActive(b)"
            >
              <span>
                <span class="block font-bold">{{ b.is_active ? 'البناء نشط' : 'البناء موقوف' }}</span>
                <span class="block text-sm text-ink-soft">الموقوف ما بيظهر للسكان، وبياناته محفوظة</span>
              </span>
              <span class="toggle" [attr.aria-checked]="b.is_active" aria-hidden="true"><span class="toggle-knob"></span></span>
            </button>
          </section>

          <!-- Danger zone -->
          <section class="space-y-2 rounded-2xl border border-unpaid/30 p-4">
            <h3 class="font-extrabold text-unpaid">حذف البناء نهائياً</h3>
            <p class="text-sm text-ink-soft">بينحذف كل شي: الشقق، الدفعات، المصاريف والفواتير. ما في تراجع. الأفضل «إيقاف» البناء بدل الحذف.</p>
            <label class="label" for="del-confirm">للتأكيد اكتب رمز البناء: <span dir="ltr" class="font-mono">{{ b.slug }}</span></label>
            <input id="del-confirm" class="field text-start" dir="ltr" autocomplete="off" [(ngModel)]="deleteConfirm" />
            <button type="button" class="btn-danger w-full" [disabled]="busy() || deleteConfirm !== b.slug" (click)="deleteBuilding(b)">
              <app-icon name="trash" [size]="18" /> حذف البناء نهائياً
            </button>
          </section>
        </div>
      }
    </app-sheet>
  `,
})
export class ManageBuilding {
  private readonly api = inject(SuperadminApi);
  private readonly toast = inject(ToastService);
  private readonly access = inject(AccessService);

  readonly building = input<BuildingSummary | null>(null);
  readonly closed = output<void>();
  readonly changed = output<void>();

  protected readonly busy = signal(false);
  protected readonly creds = signal<Credentials | null>(null);
  /** One inline action at a time: which admin, which action. */
  protected readonly action = signal<{ userId: string; kind: 'phone' | 'password' | 'remove' } | null>(null);
  protected readonly naPhone = signal('');
  protected readonly editPhone = signal('');
  protected readonly naPreview = computed(() => previewOf(this.naPhone()));
  protected readonly editPreview = computed(() => previewOf(this.editPhone()));

  protected readonly slugify = slugify;
  protected readonly fmtPhone = formatPhoneForDisplay;
  protected readonly realEmail = displayableEmail;
  protected readonly wa = (phone: string) => waHref(phone);
  protected readonly gen = () => generatePassword();

  protected naName = '';
  protected naPassword = generatePassword();
  protected resetPw = '';
  protected biName = '';
  protected biSlug = '';
  protected biFee = 0;
  protected biCurrency = '';
  protected deleteConfirm = '';
  private lastId: string | null = null;

  constructor() {
    effect(() => {
      const b = this.building();
      if (!b) {
        this.lastId = null;
        return;
      }
      if (b.id !== this.lastId) {
        // a different building was opened: reset every form
        this.lastId = b.id;
        this.creds.set(null);
        this.action.set(null);
        this.naName = '';
        this.naPhone.set('');
        this.naPassword = generatePassword();
        this.deleteConfirm = '';
      }
      this.biName = b.name;
      this.biSlug = b.slug;
      this.biFee = Number(b.default_monthly_fee);
      this.biCurrency = b.currency;
    });
  }

  protected actionFor(userId: string): 'phone' | 'password' | 'remove' | null {
    const a = this.action();
    return a && a.userId === userId ? a.kind : null;
  }

  protected credsText(): string {
    const c = this.creds();
    const b = this.building();
    if (!c || !b) return '';
    return adminCredentialsMessage({ fullName: c.fullName, buildingName: b.name, phone: c.phone, password: c.password });
  }

  /** Opens WhatsApp straight to the admin's own number with the message filled in. */
  protected waLink(): string {
    const c = this.creds();
    return c ? waHref(c.phone, this.credsText()) : '#';
  }

  protected async copyCreds(): Promise<void> {
    try {
      await copyText(this.credsText());
      this.toast.success('تم النسخ ✓ الصقه بمحادثة واتساب');
    } catch {
      this.toast.error('ما قدرنا ننسخ');
    }
  }

  private async afterChange(): Promise<void> {
    this.changed.emit();
    await this.access.load(true).catch(() => null); // my own assignments may have changed
  }

  protected async addAdmin(): Promise<void> {
    const b = this.building();
    if (!b) return;
    const phone = normalizePhone(this.naPhone());
    if (!phone.ok) {
      this.toast.error(phone.error);
      return;
    }
    this.busy.set(true);
    try {
      const res = await this.api.createBuildingAdmin({
        building_id: b.id,
        full_name: this.naName.trim(),
        phone: phone.phone,
        password: this.naPassword,
      });
      this.creds.set({ fullName: res.full_name, phone: res.phone, password: res.already_existed ? null : this.naPassword });
      this.toast.success(res.already_existed ? 'الرقم عنده حساب، تم ربطه بالبناء ✓' : 'تم إنشاء حساب المشرف ✓');
      this.naName = '';
      this.naPhone.set('');
      this.naPassword = generatePassword();
      await this.afterChange();
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'ما قدرنا نضيف المشرف');
    } finally {
      this.busy.set(false);
    }
  }

  protected startPhone(a: AdminSummary): void {
    this.editPhone.set(a.phone ? '0' + a.phone.replace(/^963/, '') : '');
    this.action.set({ userId: a.user_id, kind: 'phone' });
  }

  protected startReset(a: AdminSummary): void {
    this.resetPw = generatePassword();
    this.action.set({ userId: a.user_id, kind: 'password' });
  }

  protected startRemove(a: AdminSummary): void {
    this.action.set({ userId: a.user_id, kind: 'remove' });
  }

  protected async savePhone(a: AdminSummary): Promise<void> {
    const phone = normalizePhone(this.editPhone());
    if (!phone.ok) {
      this.toast.error(phone.error);
      return;
    }
    this.busy.set(true);
    try {
      const res = await this.api.updateAdminPhone({ user_id: a.user_id, new_phone: phone.phone });
      this.action.set(null);
      this.toast.success(`تم تعديل الرقم ✓ صار يدخل بـ ${formatPhoneForDisplay(res.phone)}`);
      await this.afterChange();
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'ما تعدّل الرقم');
    } finally {
      this.busy.set(false);
    }
  }

  protected async resetPassword(a: AdminSummary): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.api.resetAdminPassword({ user_id: a.user_id, password: this.resetPw });
      if (res.phone) {
        this.creds.set({ fullName: res.full_name || a.full_name, phone: res.phone, password: this.resetPw });
      }
      this.action.set(null);
      this.toast.success('تم تغيير كلمة المرور ✓');
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'ما تغيّرت كلمة المرور');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(a: AdminSummary): Promise<void> {
    const b = this.building();
    if (!b) return;
    this.busy.set(true);
    try {
      await this.api.removeBuildingAdmin({ building_id: b.id, user_id: a.user_id });
      this.toast.success('تمت الإزالة');
      this.action.set(null);
      await this.afterChange();
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'ما قدرنا نزيله');
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveInfo(): Promise<void> {
    const b = this.building();
    if (!b) return;
    const slug = slugify(this.biSlug);
    if (!this.biName.trim() || slug.length < 3) {
      this.toast.error('اكتب الاسم ورمز من 3 أحرف على الأقل');
      return;
    }
    this.busy.set(true);
    try {
      await this.api.updateBuilding(b.id, {
        name: this.biName.trim(),
        slug,
        currency: this.biCurrency.trim() || 'ل.س',
        default_monthly_fee: Math.max(0, Number(this.biFee) || 0),
      });
      this.toast.success('تم الحفظ ✓');
      await this.afterChange();
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظت المعلومات'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleActive(b: BuildingSummary): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.updateBuilding(b.id, { is_active: !b.is_active });
      this.toast.success(b.is_active ? 'تم إيقاف البناء' : 'تم تفعيل البناء ✓');
      await this.afterChange();
    } catch (err) {
      this.toast.error(arabicError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteBuilding(b: BuildingSummary): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.deleteBuilding(b.id);
      this.toast.success('تم حذف البناء');
      this.closed.emit();
      await this.afterChange();
    } catch (err) {
      this.toast.error(arabicError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
