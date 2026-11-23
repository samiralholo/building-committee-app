import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PaymentStatus } from '../core/models';
import { STATUS_META } from '../core/format';
import { Icon } from './icon';

@Component({
  selector: 'app-status-badge',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold whitespace-nowrap"
      [class]="meta().classes"
      [class.text-sm]="!large()"
      [class.text-base]="large()"
    >
      <app-icon [name]="meta().icon" [size]="large() ? 18 : 16" [stroke]="3" />
      {{ meta().label }}
    </span>
  `,
})
export class StatusBadge {
  readonly status = input.required<PaymentStatus>();
  readonly large = input(false);
  protected readonly meta = computed(() => STATUS_META[this.status()]);
}
