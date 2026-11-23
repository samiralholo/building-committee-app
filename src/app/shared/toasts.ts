import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { Icon } from './icon';

@Component({
  selector: 'app-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3"
      aria-live="polite"
      role="status"
    >
      @for (t of toast.toasts(); track t.id) {
        <button
          type="button"
          (click)="toast.dismiss(t.id)"
          class="pointer-events-auto flex min-h-12 w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-start font-semibold shadow-lg animate-slide-down"
          [class]="
            t.kind === 'success'
              ? 'bg-paid text-white'
              : t.kind === 'error'
                ? 'bg-unpaid text-white'
                : 'bg-ink text-white'
          "
        >
          <app-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'" [size]="22" />
          <span class="flex-1">{{ t.message }}</span>
        </button>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toast = inject(ToastService);
}
