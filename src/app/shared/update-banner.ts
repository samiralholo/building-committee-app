import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { Icon } from './icon';

/** Non-intrusive "new version" banner when a fresh deploy is ready in the service worker. */
@Component({
  selector: 'app-update-banner',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ready()) {
      <div class="no-print fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md animate-slide-up sm:bottom-4" role="status">
        <button
          type="button"
          class="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-start font-bold text-white shadow-2xl"
          (click)="reload()"
        >
          <app-icon name="refresh" [size]="22" />
          <span class="flex-1">يتوفر تحديث جديد — اضغط للتحديث</span>
        </button>
      </div>
    }
  `,
})
export class UpdateBanner {
  private readonly sw = inject(SwUpdate);
  protected readonly ready = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    const sub = this.sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.ready.set(true));
    this.sw.unrecoverable.subscribe(() => location.reload());

    // Installed apps stay open for days: look for a new deploy when the app comes back to the foreground.
    const check = () => {
      if (document.visibilityState === 'visible') void this.sw.checkForUpdate().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', check);
    });
  }

  protected async reload(): Promise<void> {
    try {
      await this.sw.activateUpdate();
    } finally {
      location.reload();
    }
  }
}
