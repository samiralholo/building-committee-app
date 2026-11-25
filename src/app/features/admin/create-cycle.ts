import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ARABIC_MONTHS, currentMonthTitle, formatMoney, todayIso } from '../../core/format';
import { CycleType } from '../../core/models';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { AdminStore } from './admin-store';
import { UnitPicker } from './unit-picker';

@Component({
  selector: 'app-create-cycle',
  imports: [FormsModule, Sheet, Icon, UnitPicker],
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

        <!-- Who pays this cycle? Default = everyone (1 click, as always) -->
        <div>
          <span class="label">مين بيدفع هالدورة؟</span>
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="الشقق المشمولة">
            <button type="button" role="radio" class="chip h-auto min-h-14 justify-center py-2 text-center leading-tight whitespace-normal"
              [class.chip-active]="scope() === 'all'" [attr.aria-checked]="scope() === 'all'" (click)="scope.set('all')">
              كل الشقق المأهولة<br /><span class="num text-xs opacity-90">{{ occupied() }} شقة</span>
            </button>
            <button type="button" role="radio" class="chip h-auto min-h-14 justify-center py-2 text-center leading-tight whitespace-normal"
              [class.chip-active]="scope() === 'selected'" [attr.aria-checked]="scope() === 'selected'" (click)="chooseSelected()">
              شقق محددة / مجموعة اشتراك
              @if (scope() === 'selected') {<br /><span class="num text-xs opacity-90">{{ selectedIds().length }} شقة</span>}
            </button>
          </div>
        </div>

        @if (scope() === 'selected') {
          <app-unit-picker [units]="store.units()" [groups]="store.groups()" [(selected)]="selectedIds" />

          <button type="button" role="switch" [attr.aria-checked]="saveAsGroup()"
            class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-page px-4 py-2 text-start"
            (click)="saveAsGroup.set(!saveAsGroup())">
            <span class="font-bold">حفظ هذه الشقق كمجموعة للاستخدام الشهري</span>
            <span class="toggle" [attr.aria-checked]="saveAsGroup()" aria-hidden="true"><span class="toggle-knob"></span></span>
          </button>
          @if (saveAsGroup()) {
            <div>
              <label class="label" for="cy-group">اسم المجموعة</label>
              <input id="cy-group" name="groupName" class="field" placeholder="مشتركو المصعد" [(ngModel)]="groupName" />
              <p class="mt-1 text-sm text-ink-soft">إذا في مجموعة بنفس الاسم، بتتحدّث بهالشقق.</p>
            </div>
          }
          @if (selectedIds().length === 0) {
            <p class="rounded-xl bg-partial-bg p-3 font-semibold text-partial" role="alert">اختر شقة وحدة على الأقل</p>
          }
        } @else {
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
        }

        @if (store.units().length === 0) {
          <p class="rounded-xl bg-partial-bg p-3 font-semibold text-partial">
            ما في شقق بعد. أضف الشقق من قسم "الشقق" أولاً.
          </p>
        }

        <button
          type="submit"
          class="btn-primary w-full text-lg"
          [disabled]="busy() || !title.trim() || store.units().length === 0 || (scope() === 'selected' && (selectedIds().length === 0 || (saveAsGroup() && !groupName.trim())))"
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
  protected readonly scope = signal<'all' | 'selected'>('all');
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly saveAsGroup = signal(false);
  protected groupName = '';
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
        this.scope.set('all');
        this.selectedIds.set([]);
        this.saveAsGroup.set(false);
        this.groupName = '';
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

  /** Opening "selected": pre-pick the only saved group, else start from all occupied units. */
  protected chooseSelected(): void {
    this.scope.set('selected');
    if (this.selectedIds().length) return;
    const groups = this.store.groups();
    const ids = groups.length === 1 ? groups[0].unit_ids : this.store.units().filter((u) => u.is_occupied).map((u) => u.id);
    const valid = new Set(this.store.units().map((u) => u.id));
    this.selectedIds.set(ids.filter((id) => valid.has(id)));
    if (groups.length === 1) this.groupName = groups[0].name;
  }

  protected async submit(): Promise<void> {
    const selective = this.scope() === 'selected';
    const unitIds = selective ? this.selectedIds() : undefined;
    if (selective && unitIds!.length === 0) {
      this.toast.error('اختر شقة وحدة على الأقل');
      return;
    }
    this.busy.set(true);
    try {
      if (selective && this.saveAsGroup() && this.groupName.trim()) {
        await this.store.saveGroup(this.groupName, unitIds!);
      }
      const cycle = await this.store.createCycle({
        title: this.title.trim(),
        cycle_type: this.type(),
        amount: Number(this.amount) || 0,
        date: this.date || todayIso(),
        unitIds,
      });
      this.toast.success(
        selective ? `تم إنشاء "${cycle.title}" لـ ${unitIds!.length} شقة ✓` : `تم إنشاء "${cycle.title}" لكل الشقق ✓`,
      );
      this.closed.emit();
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا ننشئ الدورة'));
    } finally {
      this.busy.set(false);
    }
  }
}
