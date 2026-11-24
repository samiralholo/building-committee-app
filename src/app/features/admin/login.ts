import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthService } from '../../core/auth.service';
import { ENABLE_PUBLIC_SIGNUP, SUPABASE_CONFIGURED } from '../../core/config';
import { formatPhoneForDisplay, resolveLoginIdentifier } from '../../core/phone-auth';
import { waHref } from '../../core/phone';
import { getSupportWhatsapp } from '../../core/public-api';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';

const FORGOT_MESSAGE = 'السلام عليكم، أنا مشرف بناء في تطبيق لجنة البناء وأحتاج لإعادة تعيين كلمة المرور لحسابي.';

/**
 * One login for everyone:
 *  - building admins type their mobile number (any format, Arabic digits OK)
 *  - the super admin (and legacy accounts) type an email
 * Phones are turned into the hidden synthetic auth email by resolveLoginIdentifier().
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-brand text-white">
          <app-icon name="shield" [size]="34" />
        </div>
        <h1 class="text-2xl font-extrabold">{{ mode() === 'login' ? 'دخول المشرف' : 'حساب مشرف جديد' }}</h1>
        <p class="mt-1 text-ink-soft">هالصفحة لمشرفي الأبنية فقط. السكان ما بيحتاجوا يسجلوا.</p>
      </div>

      @if (!configured) {
        <div class="rounded-xl bg-partial-bg p-4 font-semibold text-partial">
          التطبيق غير مربوط بـ Supabase بعد. أضف المفاتيح حسب ملف README.
        </div>
      }

      <form class="card space-y-4 p-5" (ngSubmit)="submit()" novalidate>
        <div>
          <label class="label" for="identifier">رقم الموبايل أو البريد الإلكتروني</label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            inputmode="text"
            dir="ltr"
            class="field num text-start text-lg"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            placeholder="09xxxxxxxx"
            required
            [ngModel]="identifier()"
            (ngModelChange)="identifier.set($event); fieldError.set('')"
          />
          @if (fieldError()) {
            <p class="mt-1 font-semibold text-unpaid" role="alert">{{ fieldError() }}</p>
          } @else if (phonePreview()) {
            <p class="mt-1 text-sm font-semibold text-paid">✓ <span dir="ltr" class="num">{{ phonePreview() }}</span></p>
          } @else {
            <p class="mt-1 text-sm text-ink-soft">لمشرفي الأبنية: أدخل رقم الواتساب (مثال: 0912345678)</p>
          }
        </div>
        <div>
          <label class="label" for="password">كلمة المرور</label>
          <input
            id="password"
            name="password"
            type="password"
            dir="ltr"
            class="field text-start"
            [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
            required
            minlength="6"
            [(ngModel)]="password"
          />
        </div>
        <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || !identifier().trim() || !password">
          @if (busy()) {
            جاري الدخول…
          } @else {
            {{ mode() === 'login' ? 'دخول' : 'إنشاء الحساب' }}
          }
        </button>
        @if (signupEnabled) {
          <button type="button" class="btn-ghost w-full" (click)="mode.set(mode() === 'login' ? 'signup' : 'login')">
            {{ mode() === 'login' ? 'ما عندك حساب؟ أنشئ حساب مشرف' : 'عندك حساب؟ سجّل دخول' }}
          </button>
        }
      </form>

      <!-- Forgot password: no paid SMS. The platform admin resets it and replies on WhatsApp. -->
      <div class="space-y-2 text-center">
        <button type="button" class="btn-ghost mx-auto text-base text-brand" [disabled]="forgotBusy()" (click)="forgot()">
          <app-icon name="whatsapp" /> نسيت كلمة المرور؟ تواصل مع الإدارة عبر واتساب
        </button>
        @if (forgotNote()) {
          <p class="rounded-xl bg-exempt-bg px-4 py-3 font-semibold text-exempt" role="status">{{ forgotNote() }}</p>
        }
      </div>

      <a routerLink="/" [state]="{ stay: true }" class="btn-ghost mx-auto">
        <app-icon name="home" /> الصفحة الرئيسية
      </a>
    </main>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly access = inject(AccessService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** `?next=/admin/payments` (bound by the router). */
  readonly next = input<string | undefined>();

  protected readonly configured = SUPABASE_CONFIGURED;
  protected readonly signupEnabled = ENABLE_PUBLIC_SIGNUP;
  protected readonly mode = signal<'login' | 'signup'>('login');
  protected readonly busy = signal(false);
  protected readonly identifier = signal('');
  protected readonly fieldError = signal('');
  protected readonly forgotBusy = signal(false);
  protected readonly forgotNote = signal('');
  protected password = '';

  /** Live "+963 912 345 678" confirmation once the typed phone is valid. */
  protected readonly phonePreview = computed(() => {
    const id = resolveLoginIdentifier(this.identifier());
    return id.kind === 'phone' ? formatPhoneForDisplay(id.normalizedPhone) : '';
  });

  protected async submit(): Promise<void> {
    const id = resolveLoginIdentifier(this.identifier());
    if (id.kind === 'invalid') {
      this.fieldError.set(id.error);
      return;
    }
    this.busy.set(true);
    try {
      if (this.mode() === 'signup' && this.signupEnabled) {
        if (id.kind !== 'email') {
          this.fieldError.set('إنشاء حساب جديد يحتاج بريد إلكتروني');
          return;
        }
        await this.auth.signUp(id.authEmail, this.password);
        if (!this.auth.isLoggedIn()) {
          this.toast.info('تم إنشاء الحساب. افتح بريدك وأكّد الحساب ثم سجّل دخول.');
          this.mode.set('login');
          return;
        }
      } else {
        await this.auth.signIn(id.authEmail, this.password);
      }
      // Role-aware landing: superadmin → /superadmin, building admin → /admin.
      const acc = await this.access.load(true);
      const home = this.access.homeUrl(acc);
      const next = this.next();
      const nextAllowed =
        !!next &&
        !next.startsWith('/admin/login') &&
        (next.startsWith('/superadmin') ? acc?.role === 'superadmin' : next.startsWith('/admin'));
      await this.router.navigateByUrl(nextAllowed ? next! : home);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا نسجّل الدخول'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async forgot(): Promise<void> {
    this.forgotBusy.set(true);
    this.forgotNote.set('');
    // Open the tab synchronously (pop-up blockers), then point it at WhatsApp once we know the number.
    const win = window.open('', '_blank');
    try {
      const support = await getSupportWhatsapp();
      if (support) {
        const url = waHref(support, FORGOT_MESSAGE);
        if (win) win.location.href = url;
        else location.href = url;
        return;
      }
      win?.close();
      this.forgotNote.set('يرجى التواصل مع مسؤول المنصة لإعادة تعيين كلمة المرور');
    } catch {
      win?.close();
      this.forgotNote.set('يرجى التواصل مع مسؤول المنصة لإعادة تعيين كلمة المرور');
    } finally {
      this.forgotBusy.set(false);
    }
  }
}
