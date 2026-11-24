import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthService } from '../../core/auth.service';
import { ChangePassword } from '../../shared/change-password';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-superadmin-shell',
  imports: [RouterOutlet, RouterLink, Icon, ChangePassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-dvh pb-10">
      <header class="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div class="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <a routerLink="/superadmin" class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink text-white" aria-label="لوحة السوبر أدمن">
            <app-icon name="shield" [size]="22" />
          </a>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-ink-soft">المشرف العام</p>
            <h1 class="truncate text-lg leading-tight font-extrabold">لوحة التحكم</h1>
          </div>
          @if (access.buildings().length > 0) {
            <a routerLink="/admin" class="btn-secondary px-3 text-sm" title="إدارة البناء المعيّن لك">
              <app-icon name="home" [size]="18" /> <span class="hidden sm:inline">إدارة بنائي</span>
            </a>
          }
          <button type="button" class="btn-icon" aria-label="تغيير كلمة السر" title="تغيير كلمة السر" (click)="pwOpen.set(true)">
            <app-icon name="key" [size]="22" />
          </button>
          <button type="button" class="btn-icon" aria-label="تسجيل خروج" title="تسجيل خروج" (click)="logout()">
            <app-icon name="logout" [size]="22" />
          </button>
        </div>
      </header>
      <main class="mx-auto max-w-5xl px-4 pt-4">
        <router-outlet />
      </main>
      <app-change-password [open]="pwOpen()" (closed)="pwOpen.set(false)" />
    </div>
  `,
})
export class SuperadminShell {
  protected readonly access = inject(AccessService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly pwOpen = signal(false);

  protected async logout(): Promise<void> {
    await this.auth.signOut();
    this.access.clear();
    await this.router.navigateByUrl('/admin/login');
  }
}
