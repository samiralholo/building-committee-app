import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toasts } from './shared/toasts';
import { UpdateBanner } from './shared/update-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toasts, UpdateBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-toasts />
    <app-update-banner />
  `,
})
export class App {}
