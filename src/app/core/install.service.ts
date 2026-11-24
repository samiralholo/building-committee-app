import { Injectable, computed, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'bc:install-dismissed-at';
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/i.test(ua) || iPadOs;
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/** "Add to home screen" for residents: native prompt on Android/Chrome, a visual guide on iOS. */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred = signal<BeforeInstallPromptEvent | null>(
    ((window as unknown as { __bcInstallPrompt?: BeforeInstallPromptEvent }).__bcInstallPrompt ?? null),
  );
  private readonly dismissed = signal(recentlyDismissed());
  private readonly installed = signal(isStandalone());

  readonly ios = isIos();
  /** Show the banner: not installed, not dismissed lately, and installable (native prompt or iOS). */
  readonly canOffer = computed(
    () => !this.installed() && !this.dismissed() && (this.deferred() !== null || this.ios),
  );

  constructor() {
    window.addEventListener('bc-install-available', () => {
      this.deferred.set(
        (window as unknown as { __bcInstallPrompt?: BeforeInstallPromptEvent }).__bcInstallPrompt ?? null,
      );
    });
    window.addEventListener('appinstalled', () => this.installed.set(true));
  }

  /** Returns 'ios-guide' when the caller should show the manual iOS steps. */
  async install(): Promise<'installed' | 'dismissed' | 'ios-guide'> {
    const evt = this.deferred();
    if (!evt) return 'ios-guide';
    await evt.prompt();
    const choice = await evt.userChoice;
    this.deferred.set(null);
    if (choice.outcome === 'accepted') {
      this.installed.set(true);
      return 'installed';
    }
    return 'dismissed';
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }
}
