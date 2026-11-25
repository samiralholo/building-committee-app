import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CATEGORY_META, formatDate, formatMoney, formatNumber, remaining } from '../../core/format';
import { publicBuildingUrl } from '../../core/messages';
import { Expense, Payment, Unit } from '../../core/models';
import { prettyPhone } from '../../core/phone';
import { makeQrDataUrl, printElevatorPoster } from '../../core/qr-poster';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Lightbox } from '../../shared/lightbox';
import { StatusBadge } from '../../shared/status-badge';
import { AdminStore } from '../admin/admin-store';

type Section = 'payments' | 'expenses' | 'settings';

/** /superadmin/buildings/:id — everything about one building, strictly read-only. */
@Component({
  selector: 'app-inspect-building',
  imports: [RouterLink, Icon, StatusBadge, Lightbox],
  providers: [AdminStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sticky top-[61px] z-20 -mx-4 mb-4 flex items-center gap-2 bg-partial-bg px-4 py-3 font-extrabold text-partial shadow-sm" role="note">
      <app-icon name="eye" [size]="22" />
      <span class="flex-1">وضع المعاينة (سوبر أدمن - للقراءة فقط)</span>
      <a routerLink="/superadmin" class="btn-ghost px-3 text-sm text-partial">رجوع</a>
    </div>

    @if (store.loading()) {
      <div class="space-y-3" aria-busy="true">
        <div class="skeleton h-10 w-2/3"></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="skeleton h-24"></div>
          <div class="skeleton h-24"></div>
          <div class="skeleton h-24"></div>
        </div>
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="skeleton h-16"></div>
        }
      </div>
    } @else if (store.loadError() || !store.building()) {
      <div class="card p-8 text-center">
        <p class="text-lg font-bold">ما قدرنا نفتح هالبناء</p>
        <a routerLink="/superadmin" class="btn-primary mt-4">رجوع للقائمة</a>
      </div>
    } @else if (store.building(); as b) {
      <div class="space-y-4">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="text-2xl font-extrabold">{{ b.name }}</h2>
            <a [routerLink]="['/b', b.slug]" target="_blank" class="inline-flex min-h-12 items-center text-sm font-semibold text-brand underline" dir="ltr">/b/{{ b.slug }}</a>
          </div>
          @if (!b.is_active) {
            <span class="rounded-full bg-exempt-bg px-3 py-1 font-bold text-exempt">موقوف</span>
          }
        </div>

        <!-- KPIs -->
        <section class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="card border-brand/30 bg-brand-soft/40 p-4">
            <p class="text-sm font-bold text-brand">رصيد صندوق البناء</p>
            <p class="num text-2xl text-brand">{{ money(store.fundBalance()) }}</p>
            <p class="text-sm text-ink-soft">مقبوضات {{ fmtNum(store.totalCollected()) }} − مصاريف {{ fmtNum(store.totalExpenses()) }}</p>
          </div>
          <div class="card p-4">
            <p class="text-sm font-bold text-ink-soft">إجمالي المتراكم على السكان</p>
            <p class="num text-2xl" [class.text-unpaid]="store.totalArrears() > 0" [class.text-paid]="store.totalArrears() === 0">{{ money(store.totalArrears()) }}</p>
          </div>
          <div class="card p-4">
            <p class="text-sm font-bold text-ink-soft">الشقق / الدورات</p>
            <p class="num text-2xl">{{ store.units().length }} / {{ store.cycles().length }}</p>
          </div>
        </section>

        <div class="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-white p-1" role="tablist">
          @for (s of sections; track s.id) {
            <button type="button" role="tab" [attr.aria-selected]="section() === s.id" class="min-h-12 rounded-xl text-sm font-bold sm:text-base"
              [class]="section() === s.id ? 'bg-brand text-white' : 'text-ink-soft'" (click)="section.set(s.id)">
              {{ s.label }}
            </button>
          }
        </div>

        @switch (section()) {
          @case ('payments') {
            @if (store.cycles().length === 0) {
              <div class="card p-6 text-center text-ink-soft">ما في دورات دفع بعد</div>
            } @else {
              <select class="field font-bold" aria-label="الدورة" (change)="cycleId.set($any($event.target).value)">
                @for (c of store.cycles(); track c.id) {
                  <option [value]="c.id" [selected]="c.id === currentCycleId()">{{ c.title }}</option>
                }
              </select>
              <p class="rounded-xl bg-page px-3 py-2 text-sm font-bold text-ink-soft">
                @if (rows().length < store.units().length) {
                  دورة مخصصة — تشمل <span class="num text-ink">{{ rows().length }}</span> من <span class="num text-ink">{{ store.units().length }}</span> شقة
                } @else {
                  تشمل كل الشقق (<span class="num text-ink">{{ rows().length }}</span>)
                }
              </p>
              <p class="font-bold text-ink-soft">
                <span class="num text-paid">{{ cycleSummary().paid }}</span> خالص ·
                <span class="num text-unpaid">{{ cycleSummary().owing }}</span> عليهم باقي ·
                انقبض <span class="num text-ink">{{ money(cycleSummary().collected) }}</span>
              </p>
              <ul class="space-y-2">
                @for (r of rows(); track r.unit.id) {
                  <li class="card flex items-center gap-3 p-3">
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-bold">{{ r.unit.resident_name }}</p>
                      <p class="truncate text-sm text-ink-soft">
                        {{ r.unit.label }}
                        @if (r.unit.whatsapp_phone) {
                          · <span dir="ltr" class="num font-normal">{{ pretty(r.unit.whatsapp_phone) }}</span>
                        }
                      </p>
                      @if (r.payment && r.payment.status !== 'exempt') {
                        <p class="num text-sm text-ink-soft">{{ fmtNum(r.payment.amount_paid) }} / {{ fmtNum(r.payment.amount_due) }}</p>
                      }
                      @if (r.payment?.notes) {
                        <p class="text-sm text-partial">📝 {{ r.payment!.notes }}</p>
                      }
                    </div>
                    @if (r.payment) {
                      <app-status-badge [status]="r.payment.status" />
                    } @else {
                      <span class="text-sm text-ink-soft">—</span>
                    }
                  </li>
                }
              </ul>
            }
          }
          @case ('expenses') {
            <ul class="space-y-2">
              @for (e of store.expenses(); track e.id) {
                <li class="card flex items-center gap-3 p-3">
                  @if (e.receipt_url) {
                    <button type="button" class="shrink-0" aria-label="عرض الفاتورة" (click)="viewing.set(e)">
                      <img [src]="e.receipt_url" alt="" class="size-14 rounded-xl object-cover ring-1 ring-line" loading="lazy" />
                    </button>
                  } @else {
                    <div class="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <app-icon [name]="categoryMeta[e.category].icon" [size]="26" />
                    </div>
                  }
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-bold">{{ e.title }}</p>
                    <p class="text-sm text-ink-soft">{{ categoryMeta[e.category].label }} · {{ fmtDate(e.expense_date) }}</p>
                  </div>
                  <span class="num">{{ money(e.amount) }}</span>
                </li>
              } @empty {
                <li class="card p-6 text-center text-ink-soft">ما في مصاريف</li>
              }
            </ul>
          }
          @case ('settings') {
            <section class="card divide-y divide-line">
              <div class="flex justify-between gap-3 p-4"><span class="text-ink-soft">العملة</span><span class="font-bold">{{ b.currency }}</span></div>
              <div class="flex justify-between gap-3 p-4"><span class="text-ink-soft">الاشتراك الشهري</span><span class="num">{{ money(b.default_monthly_fee) }}</span></div>
              <div class="flex justify-between gap-3 p-4"><span class="text-ink-soft">أسماء السكان بالصفحة العامة</span><span class="font-bold">{{ b.hide_resident_names ? 'مخفية' : 'ظاهرة' }}</span></div>
              <div class="p-4">
                <p class="text-ink-soft">الإعلان المثبّت</p>
                <p class="font-semibold whitespace-pre-line">{{ b.announcement || '—' }}</p>
              </div>
              <div class="p-4">
                <p class="mb-2 text-ink-soft">أرقام الطوارئ</p>
                @for (c of b.emergency_contacts; track $index) {
                  <p class="flex justify-between gap-3"><span class="font-bold">{{ c.role }} — {{ c.name }}</span><span dir="ltr" class="num font-normal">{{ pretty(c.phone) }}</span></p>
                } @empty {
                  <p>—</p>
                }
              </div>
            </section>
            <section class="card space-y-3 p-4">
              <h3 class="flex items-center gap-2 text-lg font-extrabold"><app-icon name="qr" /> ورقة المصعد</h3>
              @if (qr()) {
                <img [src]="qr()" alt="QR code لصفحة البناء" class="mx-auto size-48 rounded-xl ring-1 ring-line" />
              } @else {
                <div class="skeleton mx-auto size-48"></div>
              }
              <button type="button" class="btn-primary w-full" [disabled]="!qr()" (click)="print()"><app-icon name="printer" /> طباعة ورقة المصعد</button>
            </section>
          }
        }
      </div>
    }

    <app-lightbox
      [src]="viewing()?.receipt_url ?? null"
      [title]="viewing()?.title ?? ''"
      [subtitle]="viewing() ? money(viewing()!.amount) + ' · ' + fmtDate(viewing()!.expense_date) : ''"
      (closed)="viewing.set(null)"
    />
  `,
})
export class InspectBuilding {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  /** Route param `:id` */
  readonly id = input.required<string>();

  protected readonly sections: ReadonlyArray<{ id: Section; label: string }> = [
    { id: 'payments', label: 'الدفعات' },
    { id: 'expenses', label: 'المصاريف' },
    { id: 'settings', label: 'الإعدادات' },
  ];
  protected readonly section = signal<Section>('payments');
  protected readonly cycleId = signal<string | null>(null);
  protected readonly viewing = signal<Expense | null>(null);
  protected readonly qr = signal('');

  protected readonly categoryMeta = CATEGORY_META;
  protected readonly fmtNum = formatNumber;
  protected readonly fmtDate = formatDate;
  protected readonly pretty = prettyPhone;
  protected readonly money = (v: number) => formatMoney(v, this.store.building()?.currency ?? '');

  protected readonly currentCycleId = computed(() => this.cycleId() ?? this.store.cycles()[0]?.id ?? null);

  protected readonly rows = computed(() => {
    const byUnit = new Map(this.store.paymentsFor(this.currentCycleId()).map((p) => [p.unit_id, p]));
    // Only units included in this cycle (selective cycles list just their subscribers)
    return this.store
      .units()
      .filter((unit) => byUnit.has(unit.id))
      .map((unit): { unit: Unit; payment: Payment | undefined } => ({ unit, payment: byUnit.get(unit.id) }));
  });

  protected readonly cycleSummary = computed(() => {
    const ps = this.store.paymentsFor(this.currentCycleId()).filter((p) => p.status !== 'exempt');
    return {
      paid: ps.filter((p) => p.status === 'paid').length,
      owing: ps.filter((p) => remaining(p) > 0).length,
      collected: ps.reduce((s, p) => s + Number(p.amount_paid), 0),
    };
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.loadSingle(id));
    });
    effect(() => {
      const b = this.store.building();
      if (b && this.section() === 'settings' && !this.qr()) {
        void makeQrDataUrl(publicBuildingUrl(b.slug)).then((u) => this.qr.set(u)).catch(() => undefined);
      }
    });
  }

  protected print(): void {
    const b = this.store.building();
    if (!b || !this.qr()) return;
    if (!printElevatorPoster(b.name, publicBuildingUrl(b.slug), this.qr())) this.toast.error('اسمح بالنوافذ المنبثقة للطباعة');
  }
}
