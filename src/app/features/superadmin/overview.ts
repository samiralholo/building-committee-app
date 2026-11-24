import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatMoney, formatNumber, slugify, suggestSlug } from '../../core/format';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { ManageBuilding } from './manage-building';
import { BuildingSummary, Overview as OverviewData, SuperadminApi } from './superadmin-api';

@Component({
  selector: 'app-superadmin-overview',
  imports: [FormsModule, RouterLink, Icon, Sheet, ManageBuilding],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="space-y-3" aria-busy="true">
        <div class="grid grid-cols-3 gap-3">
          <div class="skeleton h-24"></div>
          <div class="skeleton h-24"></div>
          <div class="skeleton h-24"></div>
        </div>
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton h-36"></div>
        }
      </div>
    } @else if (failed()) {
      <div class="card p-8 text-center">
        <app-icon name="wifiOff" [size]="36" class="mx-auto mb-2 text-unpaid" />
        <p class="text-lg font-bold">ما قدرنا نحمّل البيانات</p>
        <button type="button" class="btn-primary mt-4" (click)="load()"><app-icon name="refresh" /> حاول مرة ثانية</button>
      </div>
    } @else if (data(); as d) {
      <div class="space-y-4">
        <!-- KPIs -->
        <section class="grid grid-cols-3 gap-2 sm:gap-3" aria-label="أرقام المنصة">
          <div class="card p-3 sm:p-4">
            <p class="text-xs font-bold text-ink-soft sm:text-sm">الأبنية</p>
            <p class="num text-2xl text-brand sm:text-3xl">{{ fmtNum(d.total_buildings) }}</p>
            <p class="text-xs text-ink-soft">{{ fmtNum(d.active_buildings) }} نشط</p>
          </div>
          <div class="card p-3 sm:p-4">
            <p class="text-xs font-bold text-ink-soft sm:text-sm">الشقق</p>
            <p class="num text-2xl text-ink sm:text-3xl">{{ fmtNum(d.total_units) }}</p>
            <p class="text-xs text-ink-soft">بكل الأبنية</p>
          </div>
          <div class="card p-3 sm:p-4">
            <p class="text-xs font-bold text-ink-soft sm:text-sm">المشرفين</p>
            <p class="num text-2xl text-ink sm:text-3xl">{{ fmtNum(d.active_admins) }}</p>
            <p class="text-xs text-ink-soft">معيّنين</p>
          </div>
        </section>

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <label class="sr-only" for="sa-search">بحث</label>
          <input id="sa-search" class="field" placeholder="ابحث باسم البناء أو الرمز…" [ngModel]="query()" (ngModelChange)="query.set($event)" />
          <button type="button" class="btn-primary" (click)="openCreate()"><app-icon name="plus" /> إضافة بناء جديد</button>
        </div>

        <ul class="space-y-3">
          @for (b of filtered(); track b.id) {
            <li class="card p-4">
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-lg font-extrabold">{{ b.name }}</h2>
                    @if (b.is_active) {
                      <span class="rounded-full bg-paid-bg px-2.5 py-0.5 text-xs font-bold text-paid">نشط</span>
                    } @else {
                      <span class="rounded-full bg-exempt-bg px-2.5 py-0.5 text-xs font-bold text-exempt">موقوف</span>
                    }
                  </div>
                  <a [routerLink]="['/b', b.slug]" target="_blank" class="inline-flex min-h-12 items-center text-sm font-semibold text-brand underline" dir="ltr">/b/{{ b.slug }}</a>
                </div>
                <div class="text-end">
                  <p class="text-xs text-ink-soft">رصيد الصندوق</p>
                  <p class="num text-lg" [class.text-brand]="b.fund_balance >= 0" [class.text-unpaid]="b.fund_balance < 0">
                    {{ money(b.fund_balance, b.currency) }}
                  </p>
                </div>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div class="rounded-xl bg-page px-3 py-2">
                  <p class="text-ink-soft">الشقق</p>
                  <p class="num text-base">{{ fmtNum(b.unit_count) }}</p>
                </div>
                <div class="rounded-xl bg-page px-3 py-2">
                  <p class="text-ink-soft">المشرف</p>
                  @if (b.admins.length) {
                    <p class="truncate font-bold">{{ adminNames(b) }}</p>
                  } @else {
                    <p class="font-bold text-partial">⚠️ بدون مشرف</p>
                  }
                </div>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-2">
                <a class="btn-secondary" [routerLink]="['/superadmin/buildings', b.id]"><app-icon name="eye" [size]="18" /> معاينة تفاصيل البناء</a>
                <button type="button" class="btn-primary" (click)="managing.set(b)"><app-icon name="userPlus" [size]="18" /> تعيين / إدارة المشرف</button>
              </div>
            </li>
          } @empty {
            <li class="card p-8 text-center text-ink-soft">
              <app-icon name="building" [size]="36" class="mx-auto mb-2 text-slate-400" />
              <p class="text-lg font-semibold">{{ query() ? 'ما في نتائج' : 'ما في أبنية بعد' }}</p>
              @if (!query()) {
                <p>اضغط «إضافة بناء جديد» وابدأ.</p>
              }
            </li>
          }
        </ul>
      </div>
    }

    <!-- Create building -->
    <app-sheet [open]="createOpen()" title="إضافة بناء جديد" (closed)="createOpen.set(false)">
      <form class="space-y-4" (ngSubmit)="create()">
        <div>
          <label class="label" for="nb-name">اسم البناء</label>
          <input id="nb-name" name="name" class="field" required placeholder="بناء الياسمين - مدخل أ" [(ngModel)]="nbName" (ngModelChange)="onNameChange($event)" />
        </div>
        <div>
          <label class="label" for="nb-slug">رمز البناء (للرابط والـ QR)</label>
          <input id="nb-slug" name="slug" class="field text-start" dir="ltr" required [(ngModel)]="nbSlug" (ngModelChange)="slugTouched = true" (blur)="nbSlug = slugify(nbSlug)" />
          <p class="mt-1 text-sm text-ink-soft" dir="ltr" style="text-align: end">{{ origin }}/b/{{ slugify(nbSlug) || '…' }}</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="nb-fee">الاشتراك الشهري</label>
            <input id="nb-fee" name="fee" type="number" inputmode="decimal" min="0" class="field num" [(ngModel)]="nbFee" />
          </div>
          <div>
            <label class="label" for="nb-cur">العملة</label>
            <input id="nb-cur" name="currency" class="field" list="sa-currencies" [(ngModel)]="nbCurrency" />
            <datalist id="sa-currencies"><option value="ل.س"></option><option value="$"></option><option value="ل.ل"></option><option value="د.أ"></option></datalist>
          </div>
        </div>
        <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || !nbName.trim() || slugify(nbSlug).length < 3">
          <app-icon name="plus" /> {{ busy() ? 'جاري الإنشاء…' : 'إنشاء البناء' }}
        </button>
        <p class="text-center text-sm text-ink-soft">بعد الإنشاء: عيّن مشرف البناء من زر «تعيين / إدارة المشرف».</p>
      </form>
    </app-sheet>

    <app-manage-building [building]="managing()" (closed)="managing.set(null)" (changed)="load(true)" />
  `,
})
export class Overview {
  private readonly api = inject(SuperadminApi);
  private readonly toast = inject(ToastService);

  protected readonly data = signal<OverviewData | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly query = signal('');
  protected readonly createOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly managing = signal<BuildingSummary | null>(null);

  protected readonly origin = location.origin;
  protected readonly slugify = slugify;
  protected readonly fmtNum = formatNumber;
  protected readonly money = (v: number, cur: string) => formatMoney(v, cur);

  protected nbName = '';
  protected nbSlug = '';
  protected nbFee = 0;
  protected nbCurrency = 'ل.س';
  protected slugTouched = false;

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.data()?.buildings ?? [];
    return q ? list.filter((b) => b.name.toLowerCase().includes(q) || b.slug.includes(q)) : list;
  });

  constructor() {
    void this.load();
  }

  protected async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.failed.set(false);
    try {
      const d = await this.api.overview();
      this.data.set(d);
      // keep the open "manage" sheet in sync with fresh data
      const open = this.managing();
      if (open) this.managing.set(d.buildings.find((b) => b.id === open.id) ?? null);
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected adminNames(b: BuildingSummary): string {
    return b.admins.map((a) => a.full_name || a.email).join('، ');
  }

  protected openCreate(): void {
    this.nbName = '';
    this.nbSlug = '';
    this.nbFee = 0;
    this.nbCurrency = 'ل.س';
    this.slugTouched = false;
    this.createOpen.set(true);
  }

  protected onNameChange(name: string): void {
    if (!this.slugTouched) this.nbSlug = suggestSlug(name);
  }

  protected async create(): Promise<void> {
    const slug = slugify(this.nbSlug);
    this.busy.set(true);
    try {
      await this.api.createBuilding({
        name: this.nbName.trim(),
        slug,
        currency: this.nbCurrency.trim() || 'ل.س',
        default_monthly_fee: Math.max(0, Number(this.nbFee) || 0),
      });
      this.toast.success('تم إنشاء البناء ✓ عيّن مشرفه الآن');
      this.createOpen.set(false);
      await this.load(true);
      const created = this.data()?.buildings.find((b) => b.slug === slug);
      if (created) this.managing.set(created);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا ننشئ البناء'));
    } finally {
      this.busy.set(false);
    }
  }
}
