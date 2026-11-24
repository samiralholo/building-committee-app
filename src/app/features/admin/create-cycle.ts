import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ARABIC_MONTHS, currentMonthTitle, formatMoney, todayIso } from '../../core/format';
import { CycleType } from '../../core/models';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-create-cycle',
  imports: [FormsModule, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sheet [open]="open()" title="إنشاء شهر جديد / دفعة جديدة" (closed)="closed.emit()">
      <form class="space-y-4" (ngSubmit)="submit()">
        <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="النوع">
          <button
            type="button"
            role="radio"
            class="chip justify-center"
            [class.chip-active]="type() === 'monthly'"
            [attr.aria-checked]="type() === 'monthly'"
            (click)="setType('monthly')"
          >
            <app-icon name="calendar" [size]="18" /> اشتراك شهري
          </button>
          <button
            type="button"
            role="radio"
            class="chip justify-center"
            [class.chip-active]="type() === 'special'"
            [attr.aria-checked]="type() === 'special'"
            (click)="setType('special')"
          >
            <app-icon name="wrench" [size]="18" /> دفعة خاصة
          </button>
        </div>

        <div>
          <label class="label" for="cy-title">العنوان</label>
          <input
            id="cy-title"
            name="title"
            class="field"
            required
            [placeholder]="type() === 'special' ? 'مثلاً: صيانة مضخة المياه' : 'تشرين الثاني 2026'"
            [(ngModel)]="title"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="cy-amount">المبلغ على كل شقة</label>
            <input
              id="cy-amount"
              name="amount"
              type="number"
              inputmode="decimal"
              min="0"
              class="field num text-lg"
              required
              [(ngModel)]="amount"
            />
          </div>
          <div>
            <label class="label" for="cy-date">التاريخ</label>
            <input id="cy-date" name="date" type="date" class="field" [(ngModel)]="date" />
          </div>
        </div>

        <div class="rounded-xl bg-brand-soft/60 p-4 text-ink">
          <p class="font-bold">رح ينضاف تلقائياً:</p>
          <ul class="mt-1 space-y-0.5 text-ink-soft">
            <li>
              • <span class="num text-ink">{{ occupied() }}</span> شقة مسكونة — "غير مدفوع" بمبلغ
              <span class="num text-ink">{{ money(amount) }}</span>
            </li>
            <li>• <span class="num text-ink">{{ vacant() }}</span> شقة فارغة — "معفى"</li>
          </ul>
        </div>

        @if (store.units().length === 0) {
          <p class="rounded-xl bg-partial-bg p-3 font-semibold text-partial">
            ما في شقق بعد. أضف الشقق من قسم "الشقق" أولاً.
          </p>
        }

        <button
          type="submit"
          class="btn-primary w-full text-lg"
          [disabled]="busy() || !title.trim() || store.units().length === 0"
        >
          <app-icon name="plus" /> {{ busy() ? 'جاري الإنشاء…' : 'إنشاء' }}
        </button>
      </form>
    </app-sheet>
  `,
})
export class CreateCycle {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  readonly open = input(false);
  readonly closed = output<void>();

  protected readonly type = signal<CycleType>('monthly');
  protected readonly busy = signal(false);
  protected title = '';
  protected amount = 0;
  protected date = todayIso();

  protected readonly occupied = computed(() => this.store.units().filter((u) => u.is_occupied).length);
  protected readonly vacant = computed(() => this.store.units().filter((u) => !u.is_occupied).length);
  protected readonly money = (v: number) => formatMoney(Number(v) || 0, this.store.building()?.currency ?? '');

  constructor() {
    // Reset the form with smart defaults every time the sheet opens.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.type.set('monthly');
        this.title = this.suggestMonthTitle();
        this.amount = Number(this.store.building()?.default_monthly_fee ?? 0);
        this.date = todayIso();
      });
    });
  }

  /** Current Arabic month, or the next one if the current month already exists. */
  private suggestMonthTitle(): string {
    const existing = new Set(this.store.cycles().map((c) => c.title.trim()));
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const t = `${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (!existing.has(t)) return t;
    }
    return currentMonthTitle();
  }

  protected setType(t: CycleType): void {
    this.type.set(t);
    if (t === 'special') {
      this.title = '';
    } else {
      this.title = this.suggestMonthTitle();
      this.amount = Number(this.store.building()?.default_monthly_fee ?? 0);
    }
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      const cycle = await this.store.createCycle({
        title: this.title.trim(),
        cycle_type: this.type(),
        amount: Number(this.amount) || 0,
        date: this.date || todayIso(),
      });
      this.toast.success(`تم إنشاء "${cycle.title}" لكل الشقق ✓`);
      this.closed.emit();
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا ننشئ الدورة'));
    } finally {
      this.busy.set(false);
    }
  }
}
