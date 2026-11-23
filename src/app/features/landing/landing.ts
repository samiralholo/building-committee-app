import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DEFAULT_BUILDING_SLUG, LAST_SLUG_STORAGE_KEY } from '../../core/config';
import { slugify } from '../../core/format';
import { Icon } from '../../shared/icon';

function readLastSlug(): string {
  try {
    return localStorage.getItem(LAST_SLUG_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

@Component({
  selector: 'app-landing',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <div class="text-center">
        <div class="mx-auto mb-5 flex size-20 items-center justify-center rounded-3xl bg-brand text-white shadow-lg">
          <app-icon name="building" [size]="44" />
        </div>
        <h1 class="text-3xl font-extrabold text-ink">لجنة البناء</h1>
        <p class="mt-3 text-lg leading-relaxed text-ink-soft">
          ورقة المصعد صارت على تلفونك.<br />
          شوف مين دفع، وين انصرفت المصاري، وأرقام الطوارئ.
        </p>
      </div>

      <form class="card space-y-3 p-5" (ngSubmit)="go()">
        <label class="label" for="slug">رمز البناء</label>
        <input
          id="slug"
          name="slug"
          class="field text-start"
          dir="ltr"
          autocomplete="off"
          autocapitalize="off"
          placeholder="al-yasmin-14"
          [(ngModel)]="slugValue"
        />
        <p class="text-sm text-ink-soft">مكتوب تحت الـ QR الملصوق بالمصعد</p>
        <button type="submit" class="btn-primary w-full text-lg" [disabled]="!slugValue.trim()">
          افتح صفحة البناء
          <app-icon name="chevronLeft" />
        </button>
        @if (lastSlug()) {
          <a class="btn-secondary w-full" [routerLink]="['/b', lastSlug()]">
            <app-icon name="home" />
            رجوع لبنائي ({{ lastSlug() }})
          </a>
        }
      </form>

      <a routerLink="/admin/login" class="btn-ghost mx-auto">
        <app-icon name="shield" />
        دخول المشرف
      </a>
    </main>
  `,
})
export class Landing {
  private readonly router = inject(Router);
  protected slugValue = '';
  protected readonly lastSlug = signal(readLastSlug());

  constructor() {
    // Pilot mode: one building → open its page directly.
    // Residents who installed the app return to their own building.
    const target = DEFAULT_BUILDING_SLUG || this.lastSlug();
    const cameFromInside = history.state?.['stay'] === true;
    if (target && !cameFromInside) {
      void this.router.navigate(['/b', target], { replaceUrl: true });
    }
  }

  protected go(): void {
    const slug = slugify(this.slugValue);
    if (slug) void this.router.navigate(['/b', slug]);
  }
}
