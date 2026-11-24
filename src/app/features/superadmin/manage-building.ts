import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccessService } from '../../core/access.service';
import { slugify } from '../../core/format';
import { adminCredentialsMessage, copyText } from '../../core/messages';
import { generatePassword } from '../../core/password';
import { isValidPhone, normalizePhone, prettyPhone, waHref } from '../../core/phone';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { AdminSummary, BuildingSummary, SuperadminApi } from './superadmin-api';

interface Credentials {
  fullName: string;
  email: string;
  phone: string;
  password: string | null;
}

/** Super Admin sheet: assign/replace building heads, reset passwords, edit/disable/delete the building. */
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
              <pre class="max-h-48 overflow-auto rounded-xl bg-white p-3 text-sm leading-relaxed whitespace-pre-wrap text-ink" dir="rtl">{{ credsText() }}</pre>
              <button type="button" class="btn-whatsapp w-full text-lg" (click)="copyCreds()">
                <app-icon name="copy" /> نسخ بيانات الدخول لإرسالها عبر واتساب
              </button>
              @if (c.phone && validPhone(c.phone)) {
                <a class="btn-secondary w-full" [href]="waLink()" target="_blank" rel="noopener">
                  <app-icon name="whatsapp" /> فتح واتساب على رقم {{ pretty(c.phone) }}
                </a>
              }
              <button type="button" class="btn-ghost w-full" (click)="creds.set(null)">تم</button>
            </section>
          }

          <!-- Current admins -->
          <section class="space-y-2">
            <h3 class="text-lg font-extrabold">مشرفين البناء</h3>
            @for (a of b.admins; track a.user_id) {
              <div class="rounded-2xl border border-line p-3">
                <div class="flex items-start gap-3">
                  <div class="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft font-extrabold text-brand">
                    {{ (a.full_name || a.email).charAt(0) }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-bold">
                      {{ a.full_name || 'بدون اسم' }}
                      @if (a.role === 'superadmin') {
                        <span class="ms-1 rounded-full bg-ink px-2 py-0.5 text-xs text-white">سوبر أدمن</span>
                      }
                    </p>
                    <p class="truncate text-sm text-ink-soft" dir="ltr" style="text-align: end">{{ a.email }}</p>
                    @if (a.phone) {
                      <p class="num text-sm font-normal text-ink-soft" dir="ltr" style="text-align: end">{{ pretty(a.phone) }}</p>
                    }
                  </div>
                </div>
                @if (resetFor() === a.user_id) {
                  <form class="mt-3 space-y-2" (ngSubmit)="resetPassword(a)">
                    <label class="label" [for]="'rp-' + a.user_id">كلمة السر الجديدة</label>
                    <div class="flex gap-2">
                      <input [id]="'rp-' + a.user_id" name="rp" class="field num flex-1 text-start" dir="ltr" minlength="8" required [(ngModel)]="resetPw" />
                      <button type="button" class="btn-icon" aria-label="توليد كلمة سر" (click)="resetPw = gen()"><app-icon name="refresh" /></button>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                      <button type="submit" class="btn-primary" [disabled]="busy() || resetPw.length < 8">حفظ</button>
                      <button type="button" class="btn-secondary" (click)="resetFor.set(null)">إلغاء</button>
                    </div>
                  </form>
                } @else if (removeFor() === a.user_id) {
                  <div class="mt-3 space-y-2">
                    <p class="font-bold text-unpaid">إزالة {{ a.full_name || a.email }} من إدارة هالبناء؟ (حسابه بيضل موجود)</p>
                    <div class="grid grid-cols-2 gap-2">
                      <button type="button" class="btn-danger" [disabled]="busy()" (click)="remove(a)">نعم، أزله</button>
                      <button type="button" class="btn-secondary" (click)="removeFor.set(null)">إلغاء</button>
                    </div>
                  </div>
                } @else {
                  <div class="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" class="btn-secondary text-sm" [disabled]="a.role === 'superadmin'" (click)="startReset(a)">
                      <app-icon name="key" [size]="18" /> كلمة سر جديدة
                    </button>
                    <button type="button" class="btn-ghost text-sm text-unpaid" (click)="removeFor.set(a.user_id)">
                      <app-icon name="trash" [size]="18" /> إزالة
                    </button>
                  </div>
                }
              </div>
            } @empty {
              <p class="rounded-xl bg-partial-bg p-3 font-semibold text-partial">⚠️ هالبناء بدون مشرف. أضف مشرف تحت.</p>
            }
          </section>

          <!-- Add admin -->
          <section class="space-y-3 rounded-2xl bg-page p-4">
            <h3 class="flex items-center gap-2 text-lg font-extrabold"><app-icon name="userPlus" /> إضافة مشرف للبناء</h3>
            <p class="text-sm text-ink-soft">إذا البريد عنده حساب من قبل، بس بينربط بهالبناء وكلمة سره ما بتتغير.</p>
            <form class="space-y-3" (ngSubmit)="addAdmin()">
              <div>
                <label class="label" for="na-name">الاسم</label>
                <input id="na-name" name="full_name" class="field" required placeholder="أبو سامر" [(ngModel)]="naName" />
              </div>
              <div>
                <label class="label" for="na-email">البريد الإلكتروني</label>
                <input id="na-email" name="email" type="email" dir="ltr" class="field text-start" required autocomplete="off" [(ngModel)]="naEmail" />
              </div>
              <div>
                <label class="label" for="na-phone">رقم الواتساب (اختياري)</label>
                <input id="na-phone" name="phone" type="tel" dir="ltr" class="field num text-start" placeholder="0933 123 456" [(ngModel)]="naPhone" (blur)="naPhone = normalize(naPhone)" />
              </div>
              <div>
                <label class="label" for="na-pw">كلمة السر المؤقتة</label>
                <div class="flex gap-2">
                  <input id="na-pw" name="password" class="field num flex-1 text-start" dir="ltr" minlength="8" required autocomplete="off" [(ngModel)]="naPassword" />
                  <button type="button" class="btn-icon" aria-label="توليد كلمة سر جديدة" (click)="naPassword = gen()"><app-icon name="refresh" /></button>
                </div>
              </div>
              <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || !naName.trim() || !naEmail.trim() || naPassword.length < 8">
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
  protected readonly resetFor = signal<string | null>(null);
  protected readonly removeFor = signal<string | null>(null);

  protected readonly slugify = slugify;
  protected readonly normalize = normalizePhone;
  protected readonly pretty = prettyPhone;
  protected readonly validPhone = (p: string) => isValidPhone(normalizePhone(p));
  protected readonly gen = () => generatePassword();

  protected naName = '';
  protected naEmail = '';
  protected naPhone = '';
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
        this.resetFor.set(null);
        this.removeFor.set(null);
        this.naName = '';
        this.naEmail = '';
        this.naPhone = '';
        this.naPassword = generatePassword();
        this.deleteConfirm = '';
      }
      this.biName = b.name;
      this.biSlug = b.slug;
      this.biFee = Number(b.default_monthly_fee);
      this.biCurrency = b.currency;
    });
  }

  protected credsText(): string {
    const c = this.creds();
    const b = this.building();
    if (!c || !b) return '';
    return adminCredentialsMessage({ fullName: c.fullName, buildingName: b.name, email: c.email, password: c.password });
  }

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
    const phone = normalizePhone(this.naPhone);
    if (phone && !isValidPhone(phone)) {
      this.toast.error('رقم الواتساب غير صحيح');
      return;
    }
    this.busy.set(true);
    try {
      const res = await this.api.createBuildingAdmin({
        building_id: b.id,
        full_name: this.naName.trim(),
        email: this.naEmail.trim().toLowerCase(),
        phone: phone || null,
        password: this.naPassword,
      });
      this.creds.set({
        fullName: this.naName.trim(),
        email: res.email,
        phone,
        password: res.created ? this.naPassword : null,
      });
      this.toast.success(res.created ? 'تم إنشاء حساب المشرف ✓' : 'الحساب موجود، تم ربطه بالبناء ✓');
      this.naName = '';
      this.naEmail = '';
      this.naPhone = '';
      this.naPassword = generatePassword();
      await this.afterChange();
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'ما قدرنا نضيف المشرف');
    } finally {
      this.busy.set(false);
    }
  }

  protected startReset(a: AdminSummary): void {
    this.removeFor.set(null);
    this.resetPw = generatePassword();
    this.resetFor.set(a.user_id);
  }

  protected async resetPassword(a: AdminSummary): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.resetAdminPassword({ user_id: a.user_id, password: this.resetPw });
      this.creds.set({ fullName: a.full_name, email: a.email, phone: normalizePhone(a.phone), password: this.resetPw });
      this.resetFor.set(null);
      this.toast.success('تم تغيير كلمة السر ✓');
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'ما تغيّرت كلمة السر');
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
      this.removeFor.set(null);
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
