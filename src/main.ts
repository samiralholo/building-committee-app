import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Capture the install prompt as early as possible: Chrome may fire it before Angular boots.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  (window as unknown as { __bcInstallPrompt?: Event }).__bcInstallPrompt = event;
  window.dispatchEvent(new Event('bc-install-available'));
});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
