import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AccessService } from '../../core/access.service';
import { AuthService } from '../../core/auth.service';
import { Icon, IconName } from '../../shared/icon';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  providers: [AdminStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-dvh pb-24 lg:pb-8">
      <header class="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div class="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
            <app-icon name="shield" [size]="22" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-ink-soft">لوحة المشرف</p>
            @if (store.buildings().length > 1) {
              <select
                class="-ms-1 max-w-full truncate rounded-lg bg-transparent py-0.5 text-lg font-extrabold"
                aria-label="اختر البناء"
                (change)="switchBuilding($event)"
              >
                @for (b of store.buildings(); track b.id) {
                  <option [value]="b.id" [selected]="b.id === store.buildingId()">{{ b.name }}</option>
                }
              </select>
            } @else {
              <h1 class="truncate text-lg leading-tight font-extrabold">{{ store.building()?.name ?? 'لجنة البناء' }}</h1>
            }
          </div>
          @if (access.isSuperadmin()) {
            <a class="btn-icon text-brand" routerLink="/superadmin" aria-label="لوحة السوبر أدمن" title="لوحة السوبر أدمن">
              <app-icon name="building" [size]="22" />
            </a>
          }
          @if (store.building(); as b) {
            <a class="btn-icon" [routerLink]="['/b', b.slug]" target="_blank" aria-label="صفحة السكان" title="صفحة السكان">
              <app-icon name="external" [size]="22" />
            </a>
          }

          <button type="button" class="btn-icon" aria-label="تسجيل خروج" title="تسجيل خروج" (click)="logout()">
            <app-icon name="logout" [size]="22" />
          </button>
        </div>
        <!-- Desktop nav -->
        <nav class="mx-auto hidden max-w-5xl gap-1 px-4 pb-2 lg:flex" aria-label="أقسام المشرف">
          @for (item of nav; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-brand text-white hover:bg-brand-dark"
              [routerLinkActiveOptions]="{ exact: item.path === '/admin' }"
              class="btn-ghost"
            >
              <app-icon [name]="item.icon" /> {{ item.label }}
            </a>
          }
        </nav>
      </header>

      <main class="mx-auto max-w-5xl px-4 pt-4">
        @if (store.loading()) {
          <div class="space-y-3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div class="skeleton h-28"></div>
              <div class="skeleton h-28"></div>
              <div class="skeleton h-28"></div>
            </div>
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="skeleton h-16"></div>
            }
          </div>
        } @else if (store.loadError()) {
          <div class="card p-8 text-center">
            <app-icon name="wifiOff" [size]="36" class="mx-auto mb-2 text-unpaid" />
            <p class="text-lg font-bold">ما قدرنا نحمّل البيانات</p>
            <button type="button" class="btn-primary mt-4" (click)="store.load()">
              <app-icon name="refresh" /> حاول مرة ثانية
            </button>
          </div>
        } @else if (!store.building()) {
          <div class="card mx-auto max-w-md p-8 text-center">
            <div class="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-exempt-bg text-exempt">
              <app-icon name="building" [size]="34" />
            </div>
            <p class="text-lg font-bold">ما في بناء معيّن لك لسا</p>
            <p class="mt-1 text-ink-soft">تواصل مع المشرف العام ليعيّنك على بنائك، بعدين سجّل دخول من جديد.</p>
            <button type="button" class="btn-secondary mt-4" (click)="logout()"><app-icon name="logout" /> تسجيل خروج</button>
          </div>
        } @else {
          <router-outlet />
        }
      </main>


      <!-- Mobile bottom nav -->
      <nav
        class="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="أقسام المشرف"
      >
        <div class="grid grid-cols-5">
          @for (item of nav; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="!text-brand"
              [routerLinkActiveOptions]="{ exact: item.path === '/admin' }"
              class="flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold text-ink-soft"
            >
              <app-icon [name]="item.icon" [size]="24" />
              {{ item.short }}
            </a>
          }
        </div>
      </nav>
    </div>
  `,
})
export class AdminShell {
  protected readonly store = inject(AdminStore);
  protected readonly access = inject(AccessService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly nav: ReadonlyArray<{ path: string; label: string; short: string; icon: IconName }> = [
    { path: '/admin', label: 'الرئيسية', short: 'الرئيسية', icon: 'home' },
    { path: '/admin/payments', label: 'تحصيل الدفعات', short: 'الدفعات', icon: 'coins' },
    { path: '/admin/expenses', label: 'المصاريف', short: 'المصاريف', icon: 'receipt' },
    { path: '/admin/units', label: 'الشقق', short: 'الشقق', icon: 'users' },
    { path: '/admin/settings', label: 'الإعدادات', short: 'الإعدادات', icon: 'settings' },
  ];

  constructor() {
    void this.store.load();
  }

  protected switchBuilding(event: Event): void {
    void this.store.switchBuilding((event.target as HTMLSelectElement).value);
  }

  protected async logout(): Promise<void> {
    await this.auth.signOut();
    this.access.clear();
    this.store.reset();
    await this.router.navigateByUrl('/admin/login');
  }
}
