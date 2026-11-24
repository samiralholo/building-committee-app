import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { InstallService } from '../core/install.service';
import { Icon } from './icon';
import { Sheet } from './sheet';

@Component({
  selector: 'app-install-banner',
  imports: [Icon, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (install.canOffer()) {
      <section class="flex items-center gap-3 rounded-2xl border border-brand/25 bg-brand-soft/50 p-3" aria-label="تثبيت التطبيق">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
          <app-icon name="download" [size]="22" />
        </div>
        <p class="min-w-0 flex-1 text-sm leading-snug font-bold text-ink">
          ثبّت التطبيق على شاشة هاتفك لمتابعة الدفعات بضغطة واحدة
        </p>
        <button type="button" class="btn-primary shrink-0 px-3 text-sm" (click)="onInstall()">تثبيت</button>
        <button type="button" class="btn-icon -me-2 shrink-0" aria-label="إخفاء" (click)="install.dismiss()">
          <app-icon name="x" [size]="20" />
        </button>
      </section>
    }

    <app-sheet [open]="iosGuide()" title="إضافة التطبيق للشاشة الرئيسية" (closed)="iosGuide.set(false)">
      <ol class="space-y-4">
        <li class="flex items-center gap-4 rounded-2xl bg-page p-4">
          <span class="num flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-white">1</span>
          <div class="flex-1">
            <p class="text-lg font-bold">اضغط زر المشاركة</p>
            <p class="text-ink-soft">المربع مع السهم لفوق ⬆️ تحت الشاشة (أو فوق على الآيباد)</p>
          </div>
          <span class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-sky-600">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
            </svg>
          </span>
        </li>
        <li class="flex items-center gap-4 rounded-2xl bg-page p-4">
          <span class="num flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-white">2</span>
          <div class="flex-1">
            <p class="text-lg font-bold">اختر «إضافة إلى الشاشة الرئيسية»</p>
            <p class="text-ink-soft">بعدين اضغط «إضافة». بيطلع أيقونة لجنة البناء على شاشتك.</p>
          </div>
          <span class="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-ink">
            <app-icon name="plus" [size]="26" />
          </span>
        </li>
      </ol>
      <button type="button" class="btn-primary mt-5 w-full text-lg" (click)="iosGuide.set(false); install.dismiss()">تمام، فهمت</button>
    </app-sheet>
  `,
})
export class InstallBanner {
  protected readonly install = inject(InstallService);
  protected readonly iosGuide = signal(false);

  protected async onInstall(): Promise<void> {
    const result = await this.install.install();
    if (result === 'ios-guide') this.iosGuide.set(true);
  }
}
