import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { slugify } from '../../core/format';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { AdminStore } from './admin-store';

/** Shown when the logged-in admin doesn't own any building yet. */
@Component({
  selector: 'app-create-building',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-lg">
      <div class="mb-5 text-center">
        <div class="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <app-icon name="building" [size]="34" />
        </div>
        <h2 class="text-2xl font-extrabold">أهلاً! خلّينا نضيف بنايتك</h2>
        <p class="mt-1 text-ink-soft">دقيقة وحدة وبتصير جاهز تسجّل الدفعات.</p>
      </div>
      <form class="card space-y-4 p-5" (ngSubmit)="create()">
        <div>
          <label class="label" for="b-name">اسم البناء</label>
          <input id="b-name" name="name" class="field" placeholder="بناء الياسمين - مدخل أ" required [(ngModel)]="name" />
        </div>
        <div>
          <label class="label" for="b-slug">رمز البناء (للرابط والـ QR)</label>
          <input
            id="b-slug"
            name="slug"
            class="field text-start"
            dir="ltr"
            placeholder="al-yasmin-14"
            required
            [(ngModel)]="slug"
            (blur)="slug = slugify(slug)"
          />
          <p class="mt-1 text-sm text-ink-soft">حروف إنجليزية صغيرة وأرقام وشرطات. مثال: al-yasmin-14</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="b-fee">الاشتراك الشهري</label>
            <input id="b-fee" name="fee" type="number" inputmode="decimal" min="0" class="field num" [(ngModel)]="fee" />
          </div>
          <div>
            <label class="label" for="b-cur">العملة</label>
            <input id="b-cur" name="currency" class="field" [(ngModel)]="currency" />
          </div>
        </div>
        <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || !name.trim() || !slug.trim()">
          <app-icon name="plus" /> إنشاء البناء
        </button>
      </form>
    </div>
  `,
})
export class CreateBuilding {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);
  protected readonly slugify = slugify;
  protected readonly busy = signal(false);
  protected name = '';
  protected slug = '';
  protected fee = 0;
  protected currency = 'ل.س';

  protected async create(): Promise<void> {
    this.slug = slugify(this.slug);
    this.busy.set(true);
    try {
      await this.store.createBuilding({
        name: this.name.trim(),
        slug: this.slug,
        currency: this.currency.trim() || 'ل.س',
        default_monthly_fee: Number(this.fee) || 0,
      });
      this.toast.success('تم إنشاء البناء ✓ أضف الشقق من قسم "الشقق"');
    } catch (err) {
      this.toast.error(arabicError(err, 'ما قدرنا ننشئ البناء'));
    } finally {
      this.busy.set(false);
    }
  }
}
