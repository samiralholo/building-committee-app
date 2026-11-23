import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { Icon } from './icon';

/** Bottom sheet on phones, centered dialog on larger screens. */
@Component({
  selector: 'app-sheet',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'open() && closed.emit()' },
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
        <button
          type="button"
          class="absolute inset-0 bg-slate-900/50 animate-fade-in"
          aria-label="إغلاق"
          (click)="closed.emit()"
        ></button>
        <section
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="title()"
          class="relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl animate-slide-up sm:max-w-lg sm:rounded-3xl"
          [class.sm:max-w-2xl]="wide()"
        >
          <header class="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 class="text-lg font-bold text-ink">{{ title() }}</h2>
            <button type="button" class="btn-icon" aria-label="إغلاق" (click)="closed.emit()">
              <app-icon name="x" [size]="22" />
            </button>
          </header>
          <div class="overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <ng-content />
          </div>
        </section>
      </div>
    }
  `,
})
export class Sheet {
  readonly open = input(false);
  readonly title = input('');
  readonly wide = input(false);
  readonly closed = output<void>();

  constructor() {
    effect(() => {
      document.body.style.overflow = this.open() ? 'hidden' : '';
    });
  }
}
