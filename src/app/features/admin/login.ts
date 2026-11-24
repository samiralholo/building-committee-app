import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthService } from '../../core/auth.service';
import { ENABLE_PUBLIC_SIGNUP, SUPABASE_CONFIGURED } from '../../core/config';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';

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

      <form class="card space-y-4 p-5" (ngSubmit)="submit()">
        <div>
          <label class="label" for="email">البريد الإلكتروني</label>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            class="field text-start"
            autocomplete="email"
            required
            [(ngModel)]="email"
          />
        </div>
        <div>
          <label class="label" for="password">كلمة السر</label>
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
        <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || !email || !password">
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
  protected email = '';
  protected password = '';

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      if (this.mode() === 'signup' && this.signupEnabled) {
        await this.auth.signUp(this.email.trim(), this.password);
        if (!this.auth.isLoggedIn()) {
          this.toast.info('تم إنشاء الحساب. افتح بريدك وأكّد الحساب ثم سجّل دخول.');
          this.mode.set('login');
          return;
        }
      } else {
        await this.auth.signIn(this.email.trim(), this.password);
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
}
