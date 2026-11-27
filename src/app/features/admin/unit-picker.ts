import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { Unit, UnitGroup } from '../../core/models';
import { floorName, formatNumber } from '../../core/format';
import { Icon } from '../../shared/icon';

interface FloorBlock {
  floor: number;
  units: Unit[];
}

/**
 * Fast unit checklist for non-technical admins:
 *  saved-group chips (1 tap) · select all / none · per-floor checkbox · live "X من Y" counter.
 * Two-way bound: [(selected)] holds the chosen unit ids.
 */
@Component({
  selector: 'app-unit-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3">
      @if (groups().length) {
        <div>
          <p class="label">مجموعات محفوظة</p>
          <div class="flex flex-wrap gap-2" role="group" aria-label="مجموعات الاشتراك">
            @for (g of groups(); track g.id) {
              <button type="button" class="chip" [class.chip-active]="isGroupSelected(g)" (click)="applyGroup(g)">
                <app-icon name="users" [size]="16" /> {{ g.name }} ({{ fmt(g.unit_ids.length) }})
              </button>
            }
          </div>
        </div>
      }

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="rounded-full bg-brand-soft px-3 py-1.5 font-bold text-brand" aria-live="polite">
          تم اختيار <span class="num">{{ fmt(selected().length) }}</span> من <span class="num">{{ fmt(units().length) }}</span> شقة
        </p>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary px-3 text-sm" (click)="selectAll()">تحديد الكل</button>
          <button type="button" class="btn-ghost px-3 text-sm" (click)="clear()">إلغاء الكل</button>
        </div>
      </div>

      <div class="space-y-2">
        @for (f of floors(); track f.floor) {
          <fieldset class="overflow-hidden rounded-2xl border border-line">
            <legend class="sr-only">{{ floorName(f.floor) }}</legend>
            <button
              type="button"
              role="checkbox"
              [attr.aria-checked]="floorState(f) === 'all' ? 'true' : floorState(f) === 'some' ? 'mixed' : 'false'"
              class="flex min-h-12 w-full items-center gap-3 bg-page px-4 text-start font-bold"
              (click)="toggleFloor(f)"
            >
              <span class="flex size-6 shrink-0 items-center justify-center rounded-md border-2"
                [class]="floorState(f) === 'none' ? 'border-slate-300 bg-white' : 'border-brand bg-brand text-white'">
                @if (floorState(f) === 'all') { <app-icon name="check" [size]="16" [stroke]="3" /> }
                @if (floorState(f) === 'some') { <app-icon name="minus" [size]="16" [stroke]="3" /> }
              </span>
              <span class="flex-1">{{ floorName(f.floor) }}</span>
              <span class="num text-sm text-ink-soft">{{ countOn(f) }}/{{ f.units.length }}</span>
            </button>
            <ul class="divide-y divide-line">
              @for (u of f.units; track u.id) {
                <li>
                  <button
                    type="button"
                    role="checkbox"
                    [attr.aria-checked]="isOn(u.id)"
                    class="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-start"
                    (click)="toggle(u.id)"
                  >
                    <span class="flex size-6 shrink-0 items-center justify-center rounded-md border-2"
                      [class]="isOn(u.id) ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'">
                      @if (isOn(u.id)) { <app-icon name="check" [size]="16" [stroke]="3" /> }
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-semibold">{{ u.resident_name }}</span>
                      <span class="block truncate text-sm text-ink-soft">{{ u.label }}</span>
                    </span>
                    @if (!u.is_occupied) {
                      <span class="rounded-full bg-exempt-bg px-2 py-0.5 text-xs font-bold text-exempt">فارغة</span>
                    }
                  </button>
                </li>
              }
            </ul>
          </fieldset>
        }
      </div>
    </div>
  `,
})
export class UnitPicker {
  readonly units = input.required<Unit[]>();
  readonly groups = input<UnitGroup[]>([]);
  readonly selected = model<string[]>([]);

  protected readonly fmt = formatNumber;
  protected readonly floorName = floorName;
  private readonly selectedSet = computed(() => new Set(this.selected()));

  protected readonly floors = computed<FloorBlock[]>(() => {
    const map = new Map<number, Unit[]>();
    for (const u of this.units()) {
      if (!map.has(u.floor)) map.set(u.floor, []);
      map.get(u.floor)!.push(u);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([floor, units]) => ({ floor, units }));
  });

  protected isOn(id: string): boolean {
    return this.selectedSet().has(id);
  }

  protected countOn(f: FloorBlock): number {
    return f.units.filter((u) => this.isOn(u.id)).length;
  }

  protected floorState(f: FloorBlock): 'all' | 'some' | 'none' {
    const n = this.countOn(f);
    return n === 0 ? 'none' : n === f.units.length ? 'all' : 'some';
  }

  protected isGroupSelected(g: UnitGroup): boolean {
    const sel = this.selectedSet();
    return g.unit_ids.length > 0 && sel.size === g.unit_ids.length && g.unit_ids.every((id) => sel.has(id));
  }

  protected toggle(id: string): void {
    const next = new Set(this.selectedSet());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.emit(next);
  }

  protected toggleFloor(f: FloorBlock): void {
    const next = new Set(this.selectedSet());
    const turnOn = this.floorState(f) !== 'all';
    for (const u of f.units) {
      if (turnOn) next.add(u.id);
      else next.delete(u.id);
    }
    this.emit(next);
  }

  protected applyGroup(g: UnitGroup): void {
    const valid = new Set(this.units().map((u) => u.id));
    this.emit(new Set(g.unit_ids.filter((id) => valid.has(id))));
  }

  protected selectAll(): void {
    this.emit(new Set(this.units().map((u) => u.id)));
  }

  protected clear(): void {
    this.emit(new Set());
  }

  /** Keep the building's display order. */
  private emit(set: Set<string>): void {
    this.selected.set(this.units().map((u) => u.id).filter((id) => set.has(id)));
  }
}
