import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-cycle-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="sr-only" for="admin-cycle">الدورة</label>
    <select id="admin-cycle" class="field font-bold" (change)="onChange($event)">
      @for (c of store.cycles(); track c.id) {
        <option [value]="c.id" [selected]="c.id === store.selectedCycle()?.id">
          {{ c.title }}{{ c.cycle_type === 'special' ? ' (دفعة خاصة)' : '' }}
        </option>
      }
    </select>
  `,
})
export class CycleSelect {
  protected readonly store = inject(AdminStore);

  protected onChange(event: Event): void {
    this.store.selectedCycleId.set((event.target as HTMLSelectElement).value);
  }
}
