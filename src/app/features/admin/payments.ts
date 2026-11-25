import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatDate, formatMoney, formatNumber } from '../../core/format';
import { whatsappReminder } from '../../core/messages';
import { Payment, PaymentStatus, Unit } from '../../core/models';
import { isValidPhone, waHref } from '../../core/phone';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { StatusBadge } from '../../shared/status-badge';
import { AdminStore } from './admin-store';
import { CreateCycle } from './create-cycle';
import { CycleSelect } from './cycle-select';
import { UnitPicker } from './unit-picker';

interface Row {
  unit: Unit;
  payment: Payment;
}

type Filter = 'all' | 'owing' | 'paid';

@Component({
  selector: 'app-payments',
  imports: [FormsModule, RouterLink, Icon, Sheet, StatusBadge, CycleSelect, CreateCycle, UnitPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!store.building()) {
      <div class="card p-8 text-center">
        <p class="text-lg font-bold">أنشئ البناء أولاً</p>
        <a routerLink="/admin" class="btn-primary mt-4">للرئيسية</a>
      </div>
    } @else if (store.cycles().length === 0) {
      <div class="card p-8 text-center">
        <app-icon name="calendar" [size]="40" class="mx-auto mb-2 text-brand" />
        <p class="text-lg font-bold">ما في ولا شهر لسا</p>
        <button type="button" class="btn-primary mt-4" (click)="showCreate.set(true)">
          <app-icon name="plus" /> إنشاء شهر جديد
        </button>
      </div>
      <app-create-cycle [open]="showCreate()" (closed)="showCreate.set(false)" />
    } @else {
      <div class="space-y-3">
        <div class="grid grid-cols-[1fr_auto] gap-2">
          <app-cycle-select />
          <button type="button" class="btn-primary" (click)="showCreate.set(true)" aria-label="إنشاء شهر جديد">
            <app-icon name="plus" /> <span class="hidden sm:inline">شهر جديد</span>
          </button>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-white px-4 py-3 ring-1 ring-line">
          <p class="font-bold">
            <span class="num text-paid">{{ summary().paid }}</span> خالص ·
            <span class="num text-unpaid">{{ summary().owing }}</span> عليهم باقي
          </p>
          <p class="num text-sm text-ink-soft">انقبض {{ money(summary().collected) }} من {{ money(summary().due) }}</p>
        </div>

        <div class="flex gap-2 overflow-x-auto" role="group" aria-label="فلترة">
          <button type="button" class="chip" [class.chip-active]="filter() === 'all'" (click)="filter.set('all')">الكل</button>
          <button type="button" class="chip" [class.chip-active]="filter() === 'owing'" (click)="filter.set('owing')">
            <app-icon name="x" [size]="16" [stroke]="3" /> غير مدفوع
          </button>
          <button type="button" class="chip" [class.chip-active]="filter() === 'paid'" (click)="filter.set('paid')">
            <app-icon name="check" [size]="16" [stroke]="3" /> خالص
          </button>
        </div>

        <!-- Which units this cycle covers (selective billing) -->
        <button type="button" class="chip w-full justify-between" (click)="openScope()" aria-haspopup="dialog">
          <span class="flex items-center gap-2"><app-icon name="users" [size]="18" /> الشقق المشمولة</span>
          <span class="num">({{ includedCount() }} من {{ store.units().length }})</span>
        </button>

        <ul class="space-y-2">
          @for (r of rows(); track r.payment.id) {
            <li class="card p-3">
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-base font-bold">{{ r.unit.resident_name }}</p>
                  <p class="truncate text-sm text-ink-soft">{{ r.unit.label }}</p>
                  @if (r.payment.status !== 'exempt') {
                    <p class="num mt-0.5 text-sm text-ink-soft">
                      {{ fmtNum(r.payment.amount_paid) }} / {{ fmtNum(r.payment.amount_due) }}
                      @if (r.payment.status === 'paid' && r.payment.paid_at) {
                        · {{ fmtDate(r.payment.paid_at) }}
                      }
                    </p>
                  }
                  @if (r.payment.notes) {
                    <p class="mt-0.5 text-sm text-partial">📝 {{ r.payment.notes }}</p>
                  }
                </div>
                <app-status-badge [status]="r.payment.status" />
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                @if (r.payment.status === 'unpaid' || r.payment.status === 'partial') {
                  <button
                    type="button"
                    class="btn-paid flex-1 text-lg"
                    [disabled]="busy().has(r.payment.id)"
                    (click)="markPaid(r.payment)"
                  >
                    <app-icon name="check" [size]="22" [stroke]="3" /> تم الدفع
                  </button>
                }
                <button type="button" class="btn-secondary" (click)="openEdit(r)">
                  <app-icon name="pencil" [size]="18" /> تعديل / دفع جزئي
                </button>
                @if ((r.payment.status === 'unpaid' || r.payment.status === 'partial') && hasWhatsapp(r.unit)) {
                  <a class="btn-whatsapp" [href]="reminderHref(r)" target="_blank" rel="noopener">
                    <app-icon name="whatsapp" [size]="20" /> تذكير واتساب
                  </a>
                }
              </div>
            </li>
          } @empty {
            <li class="card p-6 text-center text-ink-soft">ما في شقق بهالفلترة</li>
          }
        </ul>

        <!-- Danger zone -->
        <div class="pt-6 text-center">
          @if (!confirmDelete()) {
            <button type="button" class="btn-ghost text-unpaid" (click)="confirmDelete.set(true)">
              <app-icon name="trash" [size]="18" /> حذف هالدورة
            </button>
          } @else {
            <div class="card mx-auto max-w-md space-y-3 border-unpaid/40 p-4">
              <p class="font-bold text-unpaid">أكيد بدك تحذف "{{ store.selectedCycle()?.title }}" مع كل دفعاتها؟</p>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="btn-danger" (click)="deleteCycle()">نعم، احذف</button>
                <button type="button" class="btn-secondary" (click)="confirmDelete.set(false)">إلغاء</button>
              </div>
            </div>
          }
        </div>
      </div>

      <app-create-cycle [open]="showCreate()" (closed)="showCreate.set(false)" />

      <!-- Edit / partial payment -->
      <app-sheet [open]="!!editing()" [title]="editing()?.unit?.resident_name ?? ''" (closed)="editing.set(null)">
        @if (editing(); as e) {
          <form class="space-y-4" (ngSubmit)="saveEdit()">
            <p class="-mt-1 text-ink-soft">{{ e.unit.label }} · {{ store.selectedCycle()?.title }}</p>

            <button
              type="button"
              role="switch"
              [attr.aria-checked]="exempt"
              class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-exempt-bg px-4 text-start"
              (click)="exempt = !exempt"
            >
              <span class="font-bold text-exempt">شقة فارغة / معفى</span>
              <span class="toggle" [attr.aria-checked]="exempt" aria-hidden="true"><span class="toggle-knob"></span></span>
            </button>

            @if (!exempt) {
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="pd-due">المطلوب</label>
                  <input id="pd-due" name="due" type="number" inputmode="decimal" min="0" class="field num" [(ngModel)]="amountDue" />
                </div>
                <div>
                  <label class="label" for="pd-paid">المدفوع</label>
                  <input
                    id="pd-paid"
                    name="paid"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    class="field num text-lg"
                    [(ngModel)]="amountPaid"
                  />
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <button type="button" class="chip justify-center" (click)="amountPaid = 0">ولا شي</button>
                <button type="button" class="chip justify-center" (click)="amountPaid = half()">نص المبلغ</button>
                <button type="button" class="chip justify-center" (click)="amountPaid = amountDue">كامل</button>
              </div>
              <div class="flex items-center justify-between rounded-xl bg-page px-4 py-3">
                <span class="text-ink-soft">رح تصير الحالة:</span>
                <app-status-badge [status]="previewStatus()" />
              </div>
            }

            <div>
              <label class="label" for="pd-notes">ملاحظة (اختياري)</label>
              <input
                id="pd-notes"
                name="notes"
                class="field"
                placeholder="دفع نصف المبلغ والباقي أول الشهر"
                [(ngModel)]="notes"
              />
            </div>

            <button type="submit" class="btn-primary w-full text-lg" [disabled]="saving()">حفظ</button>
          </form>
        }
      </app-sheet>

      <!-- تعديل الشقق المشمولة -->
      <app-sheet [open]="scopeOpen()" title="تعديل الشقق المشمولة" [wide]="true" (closed)="scopeOpen.set(false)">
        <div class="space-y-4">
          <p class="text-ink-soft">
            الشقق المحددة بتدفع «{{ store.selectedCycle()?.title }}». الشقة اللي بتشيلها ما بتظهر بهالدورة أبداً وما بينحسب عليها شي.
          </p>
          <app-unit-picker [units]="store.units()" [groups]="store.groups()" [selected]="scopeIds()" (selectedChange)="scopeIds.set($event); confirmPaidRemoval.set(false)" />
          @if (confirmPaidRemoval() && paidRemovals().length) {
            <div class="space-y-2 rounded-2xl border-2 border-unpaid/40 bg-unpaid-bg p-4" role="alert">
              <p class="font-extrabold text-unpaid">هذه الشقة دفعت مبلغاً في هذه الدورة — هل تريد إزالتها وحذف دفعتها؟</p>
              <ul class="text-unpaid">
                @for (r of paidRemovals(); track r.payment.id) {
                  <li>• {{ r.unit?.resident_name }} — {{ r.unit?.label }}: <span class="num">{{ money(r.payment.amount_paid) }}</span></li>
                }
              </ul>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="btn-danger" [disabled]="busyScope()" (click)="saveScope()">نعم، أزلها واحذف دفعتها</button>
                <button type="button" class="btn-secondary" (click)="confirmPaidRemoval.set(false)">رجوع</button>
              </div>
            </div>
          } @else {
            <button type="button" class="btn-primary w-full text-lg" [disabled]="busyScope() || scopeIds().length === 0" (click)="saveScope()">
              حفظ ({{ scopeIds().length }} شقة)
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class Payments {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  protected readonly showCreate = signal(false);
  protected readonly filter = signal<Filter>('all');
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly scopeOpen = signal(false);
  protected readonly scopeIds = signal<string[]>([]);
  protected readonly confirmPaidRemoval = signal(false);
  protected readonly busyScope = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly editing = signal<Row | null>(null);
  protected readonly saving = signal(false);

  protected exempt = false;
  protected amountDue = 0;
  protected amountPaid = 0;
  protected notes = '';

  protected readonly fmtNum = formatNumber;
  protected readonly fmtDate = formatDate;
  protected readonly money = (v: number) => formatMoney(v, this.store.building()?.currency ?? '');

  private readonly allRows = computed<Row[]>(() => {
    const byUnit = new Map(this.store.paymentsFor(this.store.selectedCycle()?.id).map((p) => [p.unit_id, p]));
    return this.store
      .units()
      .map((unit) => ({ unit, payment: byUnit.get(unit.id) }))
      .filter((r): r is Row => !!r.payment);
  });

  protected readonly rows = computed(() => {
    const f = this.filter();
    return this.allRows().filter((r) =>
      f === 'all' ? true : f === 'paid' ? r.payment.status === 'paid' : r.payment.status === 'unpaid' || r.payment.status === 'partial',
    );
  });

  protected readonly summary = computed(() => {
    const billable = this.allRows().filter((r) => r.payment.status !== 'exempt');
    return {
      paid: billable.filter((r) => r.payment.status === 'paid').length,
      owing: billable.filter((r) => r.payment.status !== 'paid').length,
      collected: billable.reduce((s, r) => s + Number(r.payment.amount_paid), 0),
      due: billable.reduce((s, r) => s + Number(r.payment.amount_due), 0),
    };
  });

  protected readonly includedCount = computed(() => this.allRows().length);

  protected half(): number {
    return Math.round((Number(this.amountDue) || 0) / 2);
  }

  protected previewStatus(): PaymentStatus {
    const due = Number(this.amountDue) || 0;
    const paid = Number(this.amountPaid) || 0;
    if (paid >= due && (due > 0 || paid > 0)) return 'paid';
    if (paid > 0) return 'partial';
    return due === 0 ? 'paid' : 'unpaid';
  }

  /** Only offer WhatsApp when the stored number normalizes to valid international digits. */
  protected hasWhatsapp(u: Unit): boolean {
    return isValidPhone(u.whatsapp_phone);
  }

  protected reminderHref(r: Row): string {
    const building = this.store.building();
    const cycle = this.store.selectedCycle();
    if (!building || !cycle || !r.unit.whatsapp_phone) return '#';
    return waHref(r.unit.whatsapp_phone, whatsappReminder({ building, cycle, unit: r.unit, payment: r.payment }));
  }

  protected async markPaid(p: Payment): Promise<void> {
    this.busy.update((s) => new Set(s).add(p.id));
    try {
      await this.store.markPaid(p);
      this.toast.success('تم تسجيل الدفع ✓');
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظ الدفع، جرّب مرة ثانية'));
    } finally {
      this.busy.update((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    }
  }

  protected openEdit(r: Row): void {
    const cycle = this.store.selectedCycle();
    this.exempt = r.payment.status === 'exempt';
    // When un-exempting, fall back to the cycle's default amount.
    this.amountDue = this.exempt ? Number(cycle?.default_amount ?? 0) : Number(r.payment.amount_due);
    this.amountPaid = Number(r.payment.amount_paid);
    this.notes = r.payment.notes ?? '';
    this.editing.set(r);
  }

  protected async saveEdit(): Promise<void> {
    const r = this.editing();
    if (!r) return;
    const due = Math.max(0, Number(this.amountDue) || 0);
    const paid = Math.max(0, Number(this.amountPaid) || 0);
    this.saving.set(true);
    try {
      await this.store.updatePayment(r.payment, {
        amount_due: due,
        amount_paid: paid,
        exempt: this.exempt,
        notes: this.notes.trim() || null,
      });
      this.toast.success('تم الحفظ ✓');
      this.editing.set(null);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظ التعديل'));
    } finally {
      this.saving.set(false);
    }
  }

  // ------------------------------------------------ included units of the selected cycle

  protected openScope(): void {
    this.scopeIds.set(this.store.includedUnitIds(this.store.selectedCycle()?.id));
    this.confirmPaidRemoval.set(false);
    this.scopeOpen.set(true);
  }

  /** Units being taken out of the cycle that already paid something. */
  protected readonly paidRemovals = computed(() => {
    const keep = new Set(this.scopeIds());
    const byId = new Map(this.store.units().map((u) => [u.id, u]));
    return this.store
      .paymentsFor(this.store.selectedCycle()?.id)
      .filter((p) => !keep.has(p.unit_id) && Number(p.amount_paid) > 0)
      .map((p) => ({ payment: p, unit: byId.get(p.unit_id) }));
  });

  protected async saveScope(): Promise<void> {
    const cycle = this.store.selectedCycle();
    if (!cycle) return;
    if (this.scopeIds().length === 0) {
      this.toast.error('اختر شقة وحدة على الأقل');
      return;
    }
    if (this.paidRemovals().length && !this.confirmPaidRemoval()) {
      this.confirmPaidRemoval.set(true); // show the warning first
      return;
    }
    this.busyScope.set(true);
    try {
      const r = await this.store.setCycleUnits(cycle, this.scopeIds(), this.confirmPaidRemoval());
      this.toast.success(r.added || r.removed ? `تم ✓ أضفنا ${r.added} وشلنا ${r.removed}` : 'ما في تغيير');
      this.scopeOpen.set(false);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظ التعديل'));
    } finally {
      this.busyScope.set(false);
    }
  }


  protected async deleteCycle(): Promise<void> {
    const cycle = this.store.selectedCycle();
    if (!cycle) return;
    try {
      await this.store.deleteCycle(cycle);
      this.toast.success('تم حذف الدورة');
    } catch (err) {
      this.toast.error(arabicError(err));
    } finally {
      this.confirmDelete.set(false);
    }
  }
}
