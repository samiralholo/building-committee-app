import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Unit } from '../../core/models';
import { isValidPhone, normalizePhone, prettyPhone } from '../../core/phone';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-units',
  imports: [FormsModule, RouterLink, Icon, Sheet],
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
          <h2 class="text-xl font-extrabold">
            الشقق <span class="num text-base text-ink-soft">({{ store.units().length }})</span>
          </h2>
          <button type="button" class="btn-primary" (click)="openNew()"><app-icon name="plus" /> إضافة شقة</button>
        </div>

        <ul class="space-y-2">
          @for (u of store.units(); track u.id; let first = $first, last = $last) {
            <li class="card flex items-center gap-1 p-2 ps-3">
              <div class="min-w-0 flex-1 py-1">
                <p class="truncate font-bold">
                  {{ u.resident_name }}
                  @if (!u.is_occupied) {
                    <span class="ms-1 rounded-full bg-exempt-bg px-2 py-0.5 text-xs text-exempt">فارغة</span>
                  }
                </p>
                <p class="truncate text-sm text-ink-soft">
                  {{ u.label }} · طابق {{ u.floor }}
                  @if (u.whatsapp_phone) {
                    · <span dir="ltr" class="num font-normal">{{ pretty(u.whatsapp_phone) }}</span>
                  }
                </p>
              </div>
              <div class="flex flex-col">
                <button type="button" class="btn-icon size-10" aria-label="لفوق" [disabled]="first || moving()" (click)="move(u, -1)">
                  <app-icon name="arrowUp" [size]="18" />
                </button>
                <button type="button" class="btn-icon size-10" aria-label="لتحت" [disabled]="last || moving()" (click)="move(u, 1)">
                  <app-icon name="arrowDown" [size]="18" />
                </button>
              </div>
              <button type="button" class="btn-icon" aria-label="تعديل" (click)="openEdit(u)">
                <app-icon name="pencil" />
              </button>
            </li>
          } @empty {
            <li class="card p-8 text-center text-ink-soft">
              <app-icon name="users" [size]="36" class="mx-auto mb-2 text-slate-400" />
              <p class="text-lg font-semibold">ما في شقق بعد</p>
              <p>أضف كل شقة مع اسم الساكن ورقم الواتساب.</p>
            </li>
          }
        </ul>
      </div>

      <app-sheet [open]="formOpen()" [title]="editing() ? 'تعديل شقة' : 'شقة جديدة'" (closed)="formOpen.set(false)">
        <form class="space-y-4" (ngSubmit)="save()">
          <div class="grid grid-cols-[1fr_6rem] gap-3">
            <div>
              <label class="label" for="u-label">اسم الشقة</label>
              <input id="u-label" name="label" class="field" required placeholder="طابق 2 - يمين" [(ngModel)]="label" />
            </div>
            <div>
              <label class="label" for="u-floor">الطابق</label>
              <input id="u-floor" name="floor" type="number" inputmode="numeric" class="field num" [(ngModel)]="floor" />
            </div>
          </div>
          <div>
            <label class="label" for="u-name">اسم الساكن</label>
            <input id="u-name" name="resident" class="field" required placeholder="أبو أحمد" [(ngModel)]="residentName" />
          </div>
          <div>
            <label class="label" for="u-phone">رقم الواتساب (اختياري)</label>
            <input
              id="u-phone"
              name="phone"
              type="tel"
              inputmode="tel"
              dir="ltr"
              class="field num text-start"
              placeholder="0933 123 456"
              [(ngModel)]="phone"
              (blur)="phone = normalize(phone)"
            />
            <p class="mt-1 text-sm text-ink-soft">
              @if (phone && valid(normalize(phone))) {
                ✓ <span dir="ltr" class="num">{{ pretty(phone) }}</span>
              } @else if (phone) {
                <span class="text-unpaid">الرقم ناقص — اكتبه مع رمز الدولة أو بصيغة 09…</span>
              } @else {
                مثال: 0933123456 أو 963933123456 — بيتحول تلقائياً
              }
            </p>
          </div>
          <div class="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-page px-4">
            <span class="font-bold">{{ occupied ? 'مسكونة' : 'فارغة (معفاة من الدفع)' }}</span>
            <button
              type="button"
              class="toggle"
              role="switch"
              [attr.aria-checked]="occupied"
              aria-label="مسكونة"
              (click)="occupied = !occupied"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <button type="submit" class="btn-primary w-full text-lg" [disabled]="saving() || !label.trim() || !residentName.trim()">
            حفظ
          </button>

          @if (editing()) {
            @if (!confirmDelete()) {
              <button type="button" class="btn-ghost w-full text-unpaid" (click)="confirmDelete.set(true)">
                <app-icon name="trash" [size]="18" /> حذف الشقة
              </button>
            } @else {
              <p class="text-center font-bold text-unpaid">رح تنحذف كل دفعات هالشقة كمان. أكيد؟</p>
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
export class Units {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  protected readonly normalize = normalizePhone;
  protected readonly valid = isValidPhone;
  protected readonly pretty = prettyPhone;

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Unit | null>(null);
  protected readonly saving = signal(false);
  protected readonly moving = signal(false);
  protected readonly confirmDelete = signal(false);

  protected label = '';
  protected floor = 1;
  protected residentName = '';
  protected phone = '';
  protected occupied = true;

  protected openNew(): void {
    const last = this.store.units().at(-1);
    this.editing.set(null);
    this.label = '';
    this.floor = last?.floor ?? 1;
    this.residentName = '';
    this.phone = '';
    this.occupied = true;
    this.confirmDelete.set(false);
    this.formOpen.set(true);
  }

  protected openEdit(u: Unit): void {
    this.editing.set(u);
    this.label = u.label;
    this.floor = u.floor;
    this.residentName = u.resident_name;
    this.phone = u.whatsapp_phone ?? '';
    this.occupied = u.is_occupied;
    this.confirmDelete.set(false);
    this.formOpen.set(true);
  }

  protected async save(): Promise<void> {
    const phone = normalizePhone(this.phone);
    if (phone && !isValidPhone(phone)) {
      this.toast.error('رقم الواتساب غير صحيح');
      return;
    }
    this.saving.set(true);
    try {
      await this.store.saveUnit(
        {
          label: this.label.trim(),
          floor: Math.trunc(Number(this.floor) || 0),
          resident_name: this.residentName.trim(),
          whatsapp_phone: phone || null,
          is_occupied: this.occupied,
        },
        this.editing() ?? undefined,
      );
      this.toast.success('تم الحفظ ✓');
      this.formOpen.set(false);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظت الشقة'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async move(u: Unit, dir: -1 | 1): Promise<void> {
    this.moving.set(true);
    try {
      await this.store.moveUnit(u, dir);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا نغيّر الترتيب'));
    } finally {
      this.moving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const u = this.editing();
    if (!u) return;
    try {
      await this.store.deleteUnit(u);
      this.toast.success('تم حذف الشقة');
      this.formOpen.set(false);
    } catch (err) {
      this.toast.error(arabicError(err));
    }
  }
}
