import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { cycleReportRows, downloadCsv } from '../../core/csv';
import { formatMoney, formatNumber, remaining, slugify } from '../../core/format';
import { copyText, whatsappMonthlyReport } from '../../core/messages';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { StatusBadge } from '../../shared/status-badge';
import { AdminStore } from './admin-store';
import { CreateBuilding } from './create-building';
import { CreateCycle } from './create-cycle';
import { CycleSelect } from './cycle-select';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Icon, StatusBadge, CreateBuilding, CreateCycle, CycleSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!store.building()) {
      <app-create-building />
    } @else {
      <div class="space-y-5">
        <!-- Quick actions -->
        <section class="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="إجراءات سريعة">
          <button type="button" class="btn-primary min-h-14 text-lg" (click)="showCreate.set(true)">
            <app-icon name="plus" [size]="22" /> إنشاء شهر جديد / دفعة جديدة
          </button>
          <button type="button" class="btn-whatsapp min-h-14" [disabled]="!cycle()" (click)="copyReport()">
            <app-icon name="whatsapp" [size]="22" /> نسخ تقرير الشهر للواتساب
          </button>
          <button type="button" class="btn-secondary min-h-14" [disabled]="!cycle()" (click)="exportCsv()">
            <app-icon name="download" [size]="22" /> تصدير Excel (CSV)
          </button>
        </section>

        @if (store.cycles().length === 0) {
          <div class="card p-8 text-center">
            <app-icon name="calendar" [size]="40" class="mx-auto mb-2 text-brand" />
            <p class="text-lg font-bold">ما في ولا شهر لسا</p>
            <p class="text-ink-soft">
              @if (store.units().length === 0) {
                ابدأ بإضافة الشقق، بعدين اضغط "إنشاء شهر جديد".
              } @else {
                اضغط "إنشاء شهر جديد" وبتنضاف كل الشقق تلقائياً.
              }
            </p>
            @if (store.units().length === 0) {
              <a routerLink="/admin/units" class="btn-primary mt-4"><app-icon name="users" /> إضافة الشقق</a>
            }
          </div>
        } @else {
          <app-cycle-select />

          <!-- KPIs -->
          <section class="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="الأرقام">
            <div class="card p-4">
              <p class="text-sm font-bold text-ink-soft">المقبوض هالدورة</p>
              <p class="num mt-1 text-2xl text-paid">{{ money(kpi().collected) }}</p>
              <p class="text-sm text-ink-soft">
                الباقي: <span class="num text-unpaid">{{ money(kpi().remaining) }}</span>
              </p>
              <div class="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-paid" [style.width.%]="kpi().percent"></div>
              </div>
              <p class="mt-1 text-sm text-ink-soft">
                <span class="num text-ink">{{ kpi().paidCount }}</span> من
                <span class="num text-ink">{{ kpi().billable }}</span> شقق خالصين
              </p>
            </div>
            <div class="card p-4">
              <p class="text-sm font-bold text-ink-soft">إجمالي المتراكم على السكان</p>
              <p class="num mt-1 text-2xl" [class.text-unpaid]="store.totalArrears() > 0" [class.text-paid]="store.totalArrears() === 0">
                {{ money(store.totalArrears()) }}
              </p>
              <p class="text-sm text-ink-soft">من كل الدورات</p>
            </div>
            <div class="card border-brand/30 bg-brand-soft/40 p-4">
              <p class="text-sm font-bold text-brand">رصيد صندوق البناء</p>
              <p class="num mt-1 text-2xl text-brand">{{ money(store.fundBalance()) }}</p>
              <p class="text-sm text-ink-soft">
                مقبوضات {{ fmtNum(store.totalCollected()) }} − مصاريف {{ fmtNum(store.totalExpenses()) }}
              </p>
            </div>
          </section>

          <!-- Who still owes -->
          <section class="card" aria-label="الباقي عليهم">
            <header class="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 class="text-lg font-extrabold">الباقي عليهم</h2>
              <a routerLink="/admin/payments" class="btn-ghost text-brand">
                تحصيل الدفعات <app-icon name="chevronLeft" />
              </a>
            </header>
            @if (owing().length === 0) {
              <p class="p-6 text-center text-lg font-bold text-paid">الكل دفع 🎉</p>
            } @else {
              <ul class="divide-y divide-line">
                @for (r of owing(); track r.unit.id) {
                  <li class="flex min-h-14 items-center gap-3 px-4 py-2">
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-bold">{{ r.unit.resident_name }}</p>
                      <p class="truncate text-sm text-ink-soft">{{ r.unit.label }}</p>
                    </div>
                    <span class="num text-unpaid">{{ fmtNum(remaining(r.payment)) }}</span>
                    <app-status-badge [status]="r.payment.status" />
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>

      <app-create-cycle [open]="showCreate()" (closed)="showCreate.set(false)" />
    }
  `,
})
export class Dashboard {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  protected readonly showCreate = signal(false);
  protected readonly cycle = this.store.selectedCycle;
  protected readonly fmtNum = formatNumber;
  protected readonly remaining = remaining;
  protected readonly money = (v: number) => formatMoney(v, this.store.building()?.currency ?? '');

  private readonly cyclePayments = computed(() => this.store.paymentsFor(this.cycle()?.id));

  protected readonly kpi = computed(() => {
    const billable = this.cyclePayments().filter((p) => p.status !== 'exempt');
    const collected = billable.reduce((s, p) => s + Number(p.amount_paid), 0);
    const due = billable.reduce((s, p) => s + Number(p.amount_due), 0);
    const paidCount = billable.filter((p) => p.status === 'paid').length;
    return {
      collected,
      remaining: billable.reduce((s, p) => s + remaining(p), 0),
      paidCount,
      billable: billable.length,
      percent: due ? Math.min(100, Math.round((collected / due) * 100)) : 0,
    };
  });

  protected readonly owing = computed(() => {
    const byUnit = new Map(this.cyclePayments().map((p) => [p.unit_id, p]));
    return this.store
      .units()
      .map((unit) => ({ unit, payment: byUnit.get(unit.id) }))
      .filter(
        (r): r is { unit: (typeof r)['unit']; payment: NonNullable<(typeof r)['payment']> } =>
          !!r.payment && (r.payment.status === 'unpaid' || r.payment.status === 'partial'),
      );
  });

  protected async copyReport(): Promise<void> {
    const building = this.store.building();
    const cycle = this.cycle();
    if (!building || !cycle) return;
    const text = whatsappMonthlyReport({
      building,
      cycle,
      units: this.store.units(),
      payments: this.store.payments(),
      expenses: this.store.expenses(),
      fundBalance: this.store.fundBalance(),
    });
    try {
      await copyText(text);
      this.toast.success('تم نسخ التقرير ✓ الصقه بمجموعة البناء على واتساب');
    } catch {
      this.toast.error('ما قدرنا ننسخ، جرّب مرة ثانية');
    }
  }

  protected exportCsv(): void {
    const building = this.store.building();
    const cycle = this.cycle();
    if (!building || !cycle) return;
    const rows = cycleReportRows({
      building,
      cycle,
      units: this.store.units(),
      payments: this.store.payments(),
      expenses: this.store.expenses(),
    });
    const safeTitle = cycle.title.replace(/[\\/:*?"<>|]+/g, '-');
    downloadCsv(`${slugify(building.slug) || 'building'}-${safeTitle}.csv`, rows);
    this.toast.success('تم تنزيل الملف ✓');
  }
}
