import { unitPlace } from '../../core/format';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Unit, UnitGroup } from '../../core/models';
import { isValidPhone, phoneDigits, prettyPhone, tidyPhoneInput } from '../../core/phone';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/sheet';
import { AdminStore } from './admin-store';
import { UnitPicker } from './unit-picker';

@Component({
  selector: 'app-units',
  imports: [FormsModule, RouterLink, Icon, Sheet, UnitPicker],
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

        <!-- مجموعات الاشتراك (e.g. elevator subscribers) -->
        <section class="card space-y-2 p-3" aria-label="مجموعات الاشتراك">
          <div class="flex items-center justify-between gap-2 ps-1">
            <h3 class="flex items-center gap-2 font-extrabold"><app-icon name="users" [size]="20" /> مجموعات الاشتراك</h3>
            <button type="button" class="btn-secondary px-3 text-sm" [disabled]="store.units().length === 0" (click)="openGroup(null)">
              <app-icon name="plus" [size]="18" /> مجموعة جديدة
            </button>
          </div>
          @for (g of store.groups(); track g.id) {
            <button type="button" class="flex min-h-12 w-full items-center gap-3 rounded-xl bg-page px-4 py-2 text-start" (click)="openGroup(g)">
              <span class="min-w-0 flex-1 truncate font-bold">{{ g.name }}</span>
              <span class="num rounded-full bg-brand-soft px-2.5 py-0.5 text-sm text-brand">{{ g.unit_ids.length }} شقة</span>
              <app-icon name="pencil" [size]="18" class="text-ink-soft" />
            </button>
          } @empty {
            <p class="px-1 text-sm text-ink-soft">
              مثلاً «مشتركو المصعد» أو «مشتركو الأمبير»: احفظ الشقق مرة وحدة، وكل شهر اختارها بضغطة عند إنشاء الدورة.
            </p>
          }
        </section>

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
                  {{ unitPlace(u.label, u.floor) }}
                  @if (u.whatsapp_phone) {
                    · <span dir="ltr" class="num font-normal">{{ pretty(u.whatsapp_phone) }}</span>
                  }
                </p>
              </div>
              <div class="flex">
                <button type="button" class="btn-icon" aria-label="لفوق" [disabled]="first || moving()" (click)="move(u, -1)">
                  <app-icon name="arrowUp" [size]="18" />
                </button>
                <button type="button" class="btn-icon" aria-label="لتحت" [disabled]="last || moving()" (click)="move(u, 1)">
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
              @if (phone && valid(phone)) {
                ✓ <span dir="ltr" class="num">{{ pretty(phone) }}</span>
              } @else if (phone) {
                <span class="text-unpaid">الرقم ناقص — اكتبه مع رمز الدولة أو بصيغة 09…</span>
              } @else {
                مثال: 0933123456 أو 963933123456 — بيتحول تلقائياً
              }
            </p>
          </div>
          <button
            type="button"
            role="switch"
            [attr.aria-checked]="occupied"
            class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-page px-4 text-start"
            (click)="occupied = !occupied"
          >
            <span class="font-bold">{{ occupied ? 'مسكونة' : 'فارغة (معفاة من الدفع)' }}</span>
            <span class="toggle" [attr.aria-checked]="occupied" aria-hidden="true"><span class="toggle-knob"></span></span>
          </button>

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

      <app-sheet [open]="groupOpen()" [title]="editingGroup() ? 'تعديل المجموعة' : 'مجموعة اشتراك جديدة'" [wide]="true" (closed)="groupOpen.set(false)">
        <form class="space-y-4" (ngSubmit)="saveGroup()">
          <div>
            <label class="label" for="g-name">اسم المجموعة</label>
            <input id="g-name" name="gname" class="field" required placeholder="مشتركو المصعد" [(ngModel)]="groupName" />
          </div>
          <app-unit-picker [units]="store.units()" [(selected)]="groupIds" />
          <button type="submit" class="btn-primary w-full text-lg" [disabled]="busyGroup() || !groupName.trim()">
            حفظ ({{ groupIds().length }} شقة)
          </button>
          @if (editingGroup(); as g) {
            @if (!confirmGroupDelete()) {
              <button type="button" class="btn-ghost w-full text-unpaid" (click)="confirmGroupDelete.set(true)">
                <app-icon name="trash" [size]="18" /> حذف المجموعة
              </button>
            } @else {
              <p class="text-center font-bold text-unpaid">بتنحذف المجموعة بس — الشقق والدفعات القديمة بتضل متل ما هي.</p>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" class="btn-danger" [disabled]="busyGroup()" (click)="deleteGroup(g)">نعم، احذف</button>
                <button type="button" class="btn-secondary" (click)="confirmGroupDelete.set(false)">إلغاء</button>
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

  protected readonly normalize = tidyPhoneInput;
  protected readonly valid = isValidPhone;
  protected readonly pretty = prettyPhone;
  protected readonly unitPlace = unitPlace;

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<Unit | null>(null);
  protected readonly saving = signal(false);
  protected readonly moving = signal(false);
  protected readonly confirmDelete = signal(false);

  // subscriber groups
  protected readonly groupOpen = signal(false);
  protected readonly editingGroup = signal<UnitGroup | null>(null);
  protected readonly groupIds = signal<string[]>([]);
  protected readonly busyGroup = signal(false);
  protected readonly confirmGroupDelete = signal(false);
  protected groupName = '';

  protected openGroup(g: UnitGroup | null): void {
    this.editingGroup.set(g);
    this.groupName = g?.name ?? '';
    this.groupIds.set(g ? [...g.unit_ids] : []);
    this.confirmGroupDelete.set(false);
    this.groupOpen.set(true);
  }

  protected async saveGroup(): Promise<void> {
    this.busyGroup.set(true);
    try {
      await this.store.saveGroup(this.groupName, this.groupIds(), this.editingGroup()?.id);
      this.toast.success('تم حفظ المجموعة ✓');
      this.groupOpen.set(false);
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظت المجموعة'));
    } finally {
      this.busyGroup.set(false);
    }
  }

  protected async deleteGroup(g: UnitGroup): Promise<void> {
    this.busyGroup.set(true);
    try {
      await this.store.deleteGroup(g);
      this.toast.success('تم حذف المجموعة');
      this.groupOpen.set(false);
    } catch (err) {
      this.toast.error(arabicError(err));
    } finally {
      this.busyGroup.set(false);
    }
  }

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
    const phone = phoneDigits(this.phone);
    if (this.phone.trim() && !phone) {
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
