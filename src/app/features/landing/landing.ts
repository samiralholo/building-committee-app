import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { slugify } from '../../core/format';
import { forgetSlug, getLandingState, readLastSlug } from '../../core/public-api';
import { Icon } from '../../shared/icon';

/**
 * Root route `/`:
 *  1. remembered building (installed PWA icon) → validate → open it
 *  2. exactly one active building → open it
 *  3. otherwise → ask for the building code
 * `history.state.stay` (from "try another code" links) skips the auto-redirects.
 */
@Component({
  selector: 'app-landing',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (checking()) {
      <main class="flex min-h-dvh flex-col items-center justify-center gap-4 px-5" aria-busy="true">
        <div class="flex size-20 items-center justify-center rounded-3xl bg-brand text-white shadow-lg">
          <app-icon name="building" [size]="44" />
        </div>
        <div class="skeleton h-5 w-40"></div>
        <p class="sr-only">جاري فتح صفحة البناء…</p>
      </main>
    } @else {
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
            spellcheck="false"
            placeholder="مثال: yasmin-a"
            [(ngModel)]="slugValue"
          />
          <p class="text-sm text-ink-soft">مكتوب تحت الـ QR الملصوق بالمصعد</p>
          @if (notFound()) {
            <p class="rounded-xl bg-unpaid-bg px-3 py-2 font-semibold text-unpaid" role="alert">
              ما لقينا بناء بهالرمز. تأكد منه وجرّب مرة ثانية.
            </p>
          }
          <button type="submit" class="btn-primary w-full text-lg" [disabled]="!slugValue.trim() || busy()">
            {{ busy() ? 'جاري البحث…' : 'افتح صفحة البناء' }}
            <app-icon name="chevronLeft" />
          </button>
        </form>

        <a routerLink="/admin/login" class="btn-ghost mx-auto text-base">
          <app-icon name="shield" />
          دخول المشرف
        </a>
      </main>
    }
  `,
})
export class Landing {
  private readonly router = inject(Router);
  protected slugValue = '';
  protected readonly checking = signal(true);
  protected readonly busy = signal(false);
  protected readonly notFound = signal(false);

  constructor() {
    void this.decide();
  }

  private async decide(): Promise<void> {
    const stay = history.state?.['stay'] === true;
    if (stay) {
      this.checking.set(false);
      return;
    }
    const remembered = readLastSlug();
    try {
      const state = await getLandingState(remembered || undefined);
      if (remembered) {
        if (state.resolved_slug) {
          await this.open(state.resolved_slug);
          return;
        }
        forgetSlug(remembered); // building renamed away / deleted / deactivated
      }
      if (state.building_count === 1 && state.single_slug) {
        await this.open(state.single_slug);
        return;
      }
    } catch {
      // Offline: an installed app still opens the remembered building (it shows its saved copy).
      if (remembered) {
        await this.open(remembered);
        return;
      }
    }
    this.checking.set(false);
  }

  private open(slug: string): Promise<boolean> {
    return this.router.navigate(['/b', slug], { replaceUrl: true });
  }

  protected async go(): Promise<void> {
    const slug = slugify(this.slugValue);
    if (!slug) return;
    this.busy.set(true);
    this.notFound.set(false);
    try {
      const state = await getLandingState(slug);
      if (state.resolved_slug) await this.open(state.resolved_slug);
      else this.notFound.set(true);
    } catch {
      await this.open(slug); // offline: let the building page show its own message
    } finally {
      this.busy.set(false);
    }
  }
}
