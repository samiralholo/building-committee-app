import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../core/supabase.service';
import { ToastService, arabicError } from '../core/toast.service';
import { Sheet } from './sheet';

/** Lets any signed-in admin replace the initial password the Super Admin sent them. */
@Component({
  selector: 'app-change-password',
  imports: [FormsModule, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sheet [open]="open()" title="تغيير كلمة السر" (closed)="closed.emit()">
      <form class="space-y-4" (ngSubmit)="save()">
        <div>
          <label class="label" for="new-pw">كلمة السر الجديدة</label>
          <input id="new-pw" name="pw" type="password" dir="ltr" class="field text-start" autocomplete="new-password" minlength="8" required [(ngModel)]="pw" />
          <p class="mt-1 text-sm text-ink-soft">8 أحرف على الأقل</p>
        </div>
        <div>
          <label class="label" for="new-pw2">أعد كتابتها</label>
          <input id="new-pw2" name="pw2" type="password" dir="ltr" class="field text-start" autocomplete="new-password" required [(ngModel)]="pw2" />
        </div>
        @if (pw2 && pw !== pw2) {
          <p class="font-semibold text-unpaid">الكلمتين مش متطابقتين</p>
        }
        <button type="submit" class="btn-primary w-full text-lg" [disabled]="busy() || pw.length < 8 || pw !== pw2">حفظ</button>
      </form>
    </app-sheet>
  `,
})
export class ChangePassword {
  private readonly db = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  readonly open = input(false);
  readonly closed = output<void>();
  protected readonly busy = signal(false);
  protected pw = '';
  protected pw2 = '';

  constructor() {
    effect(() => {
      if (this.open()) {
        this.pw = '';
        this.pw2 = '';
      }
    });
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      const { error } = await this.db.auth.updateUser({ password: this.pw });
      if (error) throw error;
      this.toast.success('تم تغيير كلمة السر ✓');
      this.closed.emit();
    } catch (err) {
      this.toast.error(arabicError(err, 'ما تغيّرت كلمة السر'));
    } finally {
      this.busy.set(false);
    }
  }
}
