import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CATEGORY_META, CATEGORY_OPTIONS, formatDate, formatMoney, todayIso } from '../../core/format';
import { compressImage, formatBytes } from '../../core/image-compress';
import { Expense, ExpenseCategory } from '../../core/models';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Lightbox } from '../../shared/lightbox';
import { Sheet } from '../../shared/sheet';
import { AdminStore } from './admin-store';

interface Compressed {
  blob: Blob;
  previewUrl: string;
  before: number;
  after: number;
}

@Component({
  selector: 'app-expenses',
  imports: [FormsModule, RouterLink, Icon, Sheet, Lightbox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!store.building()) {
      <div class="card p-8 text-center">
        <p class="text-lg font-bold">أنشئ البناء أولاً</p>
        <a routerLink="/admin" class="btn-primary mt-4">للرئيسية</a>
      </div>
    } @else {
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-xl font-extrabold">المصاريف</h2>
          <button type="button" class="btn-primary" (click)="openNew()">
            <app-icon name="plus" /> إضافة مصروف
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto] items-center gap-2">
          <select class="field font-bold" aria-label="فلترة حسب الدورة" (change)="cycleFilter.set($any($event.target).value)">
            <option value="all">كل المصاريف</option>
            @for (c of store.cycles(); track c.id) {
              <option [value]="c.id">{{ c.title }}</option>
            }
            <option value="none">بدون دورة</option>
          </select>
          <span class="num rounded-xl bg-unpaid-bg px-4 py-3 text-unpaid">{{ money(total()) }}</span>
        </div>

        <ul class="space-y-2">
          @for (e of list(); track e.id) {
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
                <p class="text-sm text-ink-soft">
                  {{ categoryMeta[e.category].label }} · {{ fmtDate(e.expense_date) }}
                  @if (cycleTitle(e.cycle_id); as t) {
                    · {{ t }}
                  }
                </p>
                <p class="num text-base">{{ money(e.amount) }}</p>
              </div>
              <button type="button" class="btn-icon" aria-label="تعديل" (click)="openEdit(e)">
                <app-icon name="pencil" />
              </button>
            </li>
          } @empty {
            <li class="card p-8 text-center text-ink-soft">
              <app-icon name="receipt" [size]="36" class="mx-auto mb-2 text-slate-400" />
              <p class="text-lg font-semibold">ما في مصاريف مسجلة</p>
              <p>سجّل فاتورة الكهرباء أو صيانة المصعد مع صورة الفاتورة.</p>
            </li>
          }
        </ul>
      </div>

      <app-lightbox
        [src]="viewing()?.receipt_url ?? null"
        [title]="viewing()?.title ?? ''"
        [subtitle]="viewing() ? money(viewing()!.amount) + ' · ' + fmtDate(viewing()!.expense_date) : ''"
        (closed)="viewing.set(null)"
      />

      <app-sheet [open]="formOpen()" [title]="editing() ? 'تعديل مصروف' : 'مصروف جديد'" (closed)="close()">
        <form class="space-y-4" (ngSubmit)="save()">
          <div>
            <label class="label" for="ex-title">شو المصروف؟</label>
            <input id="ex-title" name="title" class="field" required placeholder="فاتورة كهرباء الدرج" [(ngModel)]="title" />
          </div>

          <div>
            <span class="label">النوع</span>
            <div class="grid grid-cols-3 gap-2">
              @for (c of categories; track c.value) {
                <button
                  type="button"
                  class="chip justify-center px-2"
                  [class.chip-active]="category() === c.value"
                  (click)="category.set(c.value)"
                >
                  <app-icon [name]="categoryMeta[c.value].icon" [size]="16" /> {{ c.label }}
                </button>
              }
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="ex-amount">المبلغ</label>
              <input
                id="ex-amount"
                name="amount"
                type="number"
                inputmode="decimal"
                min="0"
                required
                class="field num text-lg"
                [(ngModel)]="amount"
              />
            </div>
            <div>
              <label class="label" for="ex-date">التاريخ</label>
              <input id="ex-date" name="date" type="date" class="field" [(ngModel)]="date" />
            </div>
          </div>

          <div>
            <label class="label" for="ex-cycle">مصاريف أي شهر؟</label>
            <select id="ex-cycle" name="cycle" class="field" [(ngModel)]="cycleId">
              <option [ngValue]="null">بدون دورة</option>
              @for (c of store.cycles(); track c.id) {
                <option [ngValue]="c.id">{{ c.title }}</option>
              }
            </select>
          </div>

          <div>
            <label class="label" for="ex-notes">ملاحظة (اختياري)</label>
            <input id="ex-notes" name="notes" class="field" [(ngModel)]="notes" />
          </div>

          <!-- Receipt photo -->
          <div class="rounded-2xl border-2 border-dashed border-line p-3">
            <span class="label">صورة الفاتورة</span>
            @if (compressed(); as c) {
              <img [src]="c.previewUrl" alt="معاينة الفاتورة" class="max-h-56 w-full rounded-xl object-contain" />
              <p class="mt-2 flex items-center justify-center gap-2 rounded-xl bg-paid-bg px-3 py-2 text-center font-bold text-paid">
                <app-icon name="check" [size]="18" [stroke]="3" />
                انضغطت الصورة:
                <span dir="ltr" class="num">{{ bytes(c.before) }} → {{ bytes(c.after) }}</span>
              </p>
              <button type="button" class="btn-ghost mt-1 w-full" (click)="clearCompressed()">
                <app-icon name="x" [size]="18" /> إلغاء الصورة
              </button>
            } @else if (editing()?.receipt_url && !removeExisting()) {
              <img [src]="editing()!.receipt_url" alt="الفاتورة الحالية" class="max-h-56 w-full rounded-xl object-contain" />
              <div class="mt-2 grid grid-cols-2 gap-2">
                <label class="btn-secondary cursor-pointer">
                  <app-icon name="camera" /> تبديل
                  <input type="file" accept="image/*" class="sr-only" (change)="onFile($event)" />
                </label>
                <button type="button" class="btn-ghost text-unpaid" (click)="removeExisting.set(true)">
                  <app-icon name="trash" [size]="18" /> حذف الصورة
                </button>
              </div>
            } @else {
              <label class="btn-secondary w-full cursor-pointer" [class.opacity-50]="compressing()">
                <app-icon name="camera" />
                {{ compressing() ? 'جاري ضغط الصورة…' : 'صوّر الفاتورة أو اختر من المعرض' }}
                <input type="file" accept="image/*" class="sr-only" [disabled]="compressing()" (change)="onFile($event)" />
              </label>
              <p class="mt-1 text-center text-xs text-ink-soft">بتنضغط تلقائياً لأقل من 150 ك.ب لتوفير الإنترنت</p>
            }
          </div>

          <button type="submit" class="btn-primary w-full text-lg" [disabled]="saving() || compressing() || !title.trim()">
            {{ saving() ? 'جاري الحفظ…' : 'حفظ' }}
          </button>

          @if (editing()) {
            @if (!confirmDelete()) {
              <button type="button" class="btn-ghost w-full text-unpaid" (click)="confirmDelete.set(true)">
                <app-icon name="trash" [size]="18" /> حذف المصروف
              </button>
            } @else {
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="btn-danger" (click)="remove()">نعم، احذف</button>
                <button type="button" class="btn-secondary" (click)="confirmDelete.set(false)">إلغاء</button>
              </div>
            }
          }
        </form>
      </app-sheet>
    }
  `,
})
export class Expenses {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  protected readonly categoryMeta = CATEGORY_META;
  protected readonly categories = CATEGORY_OPTIONS;
  protected readonly fmtDate = formatDate;
  protected readonly bytes = formatBytes;
  protected readonly money = (v: number) => formatMoney(v, this.store.building()?.currency ?? '');

  protected readonly cycleFilter = signal<string>('all');
  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Expense | null>(null);
  protected readonly category = signal<ExpenseCategory>('general');
  protected readonly compressed = signal<Compressed | null>(null);
  protected readonly compressing = signal(false);
  protected readonly removeExisting = signal(false);
  protected readonly saving = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly viewing = signal<Expense | null>(null);

  protected title = '';
  protected amount: number | null = null;
  protected date = todayIso();
  protected cycleId: string | null = null;
  protected notes = '';

  protected readonly list = computed(() => {
    const f = this.cycleFilter();
    const all = this.store.expenses();
    if (f === 'all') return all;
    if (f === 'none') return all.filter((e) => !e.cycle_id);
    return all.filter((e) => e.cycle_id === f);
  });
  protected readonly total = computed(() => this.list().reduce((s, e) => s + Number(e.amount), 0));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearCompressed());
  }

  protected cycleTitle(id: string | null): string {
    return id ? (this.store.cycles().find((c) => c.id === id)?.title ?? '') : '';
  }

  protected openNew(): void {
    this.editing.set(null);
    this.title = '';
    this.amount = null;
    this.date = todayIso();
    this.cycleId = this.store.latestCycle()?.id ?? null;
    this.notes = '';
    this.category.set('general');
    this.resetPhotoState();
    this.formOpen.set(true);
  }

  protected openEdit(e: Expense): void {
    this.editing.set(e);
    this.title = e.title;
    this.amount = Number(e.amount);
    this.date = e.expense_date;
    this.cycleId = e.cycle_id;
    this.notes = e.notes ?? '';
    this.category.set(e.category);
    this.resetPhotoState();
    this.formOpen.set(true);
  }

  protected close(): void {
    this.formOpen.set(false);
    this.clearCompressed();
  }

  private resetPhotoState(): void {
    this.clearCompressed();
    this.removeExisting.set(false);
    this.confirmDelete.set(false);
  }

  protected clearCompressed(): void {
    const c = this.compressed();
    if (c) URL.revokeObjectURL(c.previewUrl);
    this.compressed.set(null);
  }

  protected async onFile(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toast.error('اختر صورة فقط');
      return;
    }
    this.compressing.set(true);
    try {
      const result = await compressImage(file);
      this.clearCompressed();
      this.compressed.set({
        blob: result.blob,
        previewUrl: URL.createObjectURL(result.blob),
        before: result.originalBytes,
        after: result.blob.size,
      });
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا نقرأ الصورة، جرّب صورة ثانية'));
    } finally {
      this.compressing.set(false);
    }
  }

  protected async save(): Promise<void> {
    const amount = Number(this.amount);
    if (!this.title.trim() || !Number.isFinite(amount) || amount < 0) {
      this.toast.error('اكتب اسم المصروف والمبلغ');
      return;
    }
    this.saving.set(true);
    try {
      const existing = this.editing() ?? undefined;
      if (existing?.receipt_url && this.removeExisting() && !this.compressed()) {
        await this.store.removeReceipt(existing);
      }
      await this.store.saveExpense(
        {
          title: this.title.trim(),
          category: this.category(),
          amount,
          expense_date: this.date || todayIso(),
          cycle_id: this.cycleId,
          notes: this.notes.trim() || null,
        },
        existing,
        this.compressed()?.blob ?? null,
      );
      this.toast.success('تم حفظ المصروف ✓');
      this.close();
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظ المصروف'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    try {
      await this.store.deleteExpense(e);
      this.toast.success('تم حذف المصروف');
      this.close();
    } catch (err) {
      this.toast.error(arabicError(err));
    }
  }
}
