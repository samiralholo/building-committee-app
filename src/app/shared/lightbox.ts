import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { Icon } from './icon';

/** Full-screen receipt viewer. Tap the photo to zoom ×2.5 and drag/scroll around; pinch works too. */
@Component({
  selector: 'app-lightbox',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'src() && closed.emit()' },
  template: `
    @if (src(); as url) {
      <div class="fixed inset-0 z-50 flex flex-col bg-black/95 animate-fade-in" role="dialog" aria-modal="true" [attr.aria-label]="title()">
        <div class="flex items-center gap-2 p-3 text-white">
          <div class="min-w-0 flex-1">
            <p class="truncate font-bold">{{ title() }}</p>
            @if (subtitle()) {
              <p class="num text-sm text-white/80">{{ subtitle() }}</p>
            }
          </div>
          <button
            type="button"
            class="btn-icon text-white hover:bg-white/10"
            [attr.aria-label]="zoomed() ? 'تصغير' : 'تكبير'"
            (click)="zoomed.set(!zoomed())"
          >
            <app-icon [name]="zoomed() ? 'minus' : 'search'" [size]="24" />
          </button>
          <a class="btn-icon text-white hover:bg-white/10" [href]="url" target="_blank" rel="noopener" aria-label="فتح الصورة الأصلية">
            <app-icon name="external" [size]="22" />
          </a>
          <button type="button" class="btn-icon text-white hover:bg-white/10" aria-label="إغلاق" (click)="closed.emit()">
            <app-icon name="x" [size]="28" />
          </button>
        </div>
        <div
          class="min-h-0 flex-1 overflow-auto overscroll-contain"
          [class.flex]="!zoomed()"
          [class.items-center]="!zoomed()"
          [class.justify-center]="!zoomed()"
          style="touch-action: pan-x pan-y pinch-zoom"
        >
          <img
            [src]="url"
            [alt]="'فاتورة: ' + title()"
            class="select-none"
            [class]="zoomed() ? 'max-w-none w-[250%] cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain p-2'"
            (click)="zoomed.set(!zoomed())"
            draggable="false"
          />
        </div>
        <p class="pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-sm text-white/70">
          {{ zoomed() ? 'اسحب لتشوف باقي الفاتورة · اضغط للتصغير' : 'اضغط على الصورة للتكبير' }}
        </p>
      </div>
    }
  `,
})
export class Lightbox {
  readonly src = input<string | null>(null);
  readonly title = input('');
  readonly subtitle = input('');
  readonly closed = output<void>();
  protected readonly zoomed = signal(false);

  constructor() {
    effect(() => {
      const open = !!this.src();
      if (!open) this.zoomed.set(false);
      document.body.style.overflow = open ? 'hidden' : '';
    });
  }
}
