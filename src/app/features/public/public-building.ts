import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CATEGORY_META,
  formatDate,
  formatMoney,
  formatNumber,
  formatRelative,
  remaining,
} from '../../core/format';
import { Expense, Payment, PublicDashboard, PublicUnit } from '../../core/models';
import { prettyPhone, telHref, waHref } from '../../core/phone';
import { PublicApiError, forgetSlug, getPublicDashboard, rememberSlug } from '../../core/public-api';
import { Icon, IconName } from '../../shared/icon';
import { InstallBanner } from '../../shared/install-banner';
import { Lightbox } from '../../shared/lightbox';
import { Sheet } from '../../shared/sheet';
import { StatusBadge } from '../../shared/status-badge';

type Tab = 'payments' | 'expenses' | 'services';
type StatusFilter = 'all' | 'paid' | 'owing';

interface Row {
  unit: PublicUnit;
  payment: Payment | undefined;
}

const cacheKey = (slug: string) => `bc:dash:${slug}`;

function readCache(slug: string): PublicDashboard | null {
  try {
    const raw = localStorage.getItem(cacheKey(slug));
    return raw ? (JSON.parse(raw) as PublicDashboard) : null;
  } catch {
    return null;
  }
}

function writeCache(slug: string, data: PublicDashboard): void {
  try {
    localStorage.setItem(cacheKey(slug), JSON.stringify(data));
  } catch {
    /* storage full or blocked — not important */
  }
}

@Component({
  selector: 'app-public-building',
  imports: [RouterLink, Icon, Sheet, StatusBadge, InstallBanner, Lightbox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-building.html',
})
export class PublicBuilding {
  private readonly router = inject(Router);

  /** Route param `/b/:slug` (bound via withComponentInputBinding). */
  readonly slug = input.required<string>();

  protected readonly data = signal<PublicDashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly error = signal<'not-found' | 'network' | 'config' | null>(null);
  protected readonly offline = signal(false);

  protected readonly tabs: ReadonlyArray<{ id: Tab; label: string; icon: IconName }> = [
    { id: 'payments', label: 'الدفعات', icon: 'coins' },
    { id: 'expenses', label: 'المصاريف', icon: 'receipt' },
    { id: 'services', label: 'خدمات البناء', icon: 'phone' },
  ];
  protected readonly tab = signal<Tab>('payments');
  protected readonly selectedCycleId = linkedSignal(() => this.data()?.cycles[0]?.id ?? '');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly floorFilter = signal<number | null>(null);
  protected readonly expenseCycleFilter = signal<string>('all');
  protected readonly openUnitId = signal<string | null>(null);
  protected readonly receipt = signal<Expense | null>(null);
  protected readonly announcementOpen = signal(false);

  private skipNextLoad = false;

  protected readonly fmtMoney = (v: number | null | undefined) => formatMoney(v, this.currency());
  protected readonly fmtNum = formatNumber;
  protected readonly fmtDate = formatDate;
  protected readonly fmtRelative = formatRelative;
  protected readonly remaining = remaining;
  protected readonly categoryMeta = CATEGORY_META;
  protected readonly telHref = telHref;
  protected readonly waHref = waHref;
  protected readonly prettyPhone = prettyPhone;

  protected readonly currency = computed(() => this.data()?.building.currency ?? '');
  protected readonly cycles = computed(() => this.data()?.cycles ?? []);
  protected readonly selectedCycle = computed(() => this.cycles().find((c) => c.id === this.selectedCycleId()) ?? null);

  protected readonly floors = computed(() =>
    [...new Set((this.data()?.units ?? []).map((u) => u.floor))].sort((a, b) => a - b),
  );

  private readonly paymentsByCycle = computed(() => {
    const map = new Map<string, Map<string, Payment>>();
    for (const p of this.data()?.payments ?? []) {
      if (!map.has(p.cycle_id)) map.set(p.cycle_id, new Map());
      map.get(p.cycle_id)!.set(p.unit_id, p);
    }
    return map;
  });

  protected readonly allRows = computed<Row[]>(() => {
    const byUnit = this.paymentsByCycle().get(this.selectedCycleId()) ?? new Map<string, Payment>();
    return (this.data()?.units ?? []).map((unit) => ({ unit, payment: byUnit.get(unit.id) }));
  });

  protected readonly rows = computed<Row[]>(() => {
    const status = this.statusFilter();
    const floor = this.floorFilter();
    return this.allRows().filter((r) => {
      if (floor !== null && r.unit.floor !== floor) return false;
      if (status === 'paid') return r.payment?.status === 'paid';
      if (status === 'owing') return r.payment?.status === 'unpaid' || r.payment?.status === 'partial';
      return true;
    });
  });

  protected readonly progress = computed(() => {
    const billable = this.allRows().filter((r) => r.payment && r.payment.status !== 'exempt');
    const paid = billable.filter((r) => r.payment!.status === 'paid').length;
    const collected = billable.reduce((s, r) => s + Number(r.payment!.amount_paid), 0);
    const due = billable.reduce((s, r) => s + Number(r.payment!.amount_due), 0);
    return {
      paid,
      total: billable.length,
      collected,
      due,
      percent: billable.length ? Math.round((paid / billable.length) * 100) : 0,
    };
  });

  protected readonly expenses = computed(() => {
    const filter = this.expenseCycleFilter();
    const list = this.data()?.expenses ?? [];
    return filter === 'all' ? list : list.filter((e) => e.cycle_id === filter);
  });
  protected readonly expensesTotal = computed(() => this.expenses().reduce((s, e) => s + Number(e.amount), 0));

  protected readonly openUnit = computed(() => this.data()?.units.find((u) => u.id === this.openUnitId()) ?? null);
  protected readonly openUnitHistory = computed(() => {
    const unit = this.openUnit();
    if (!unit) return [];
    return this.cycles()
      .map((cycle) => ({ cycle, payment: this.paymentsByCycle().get(cycle.id)?.get(unit.id) }))
      .filter((h): h is { cycle: (typeof h)['cycle']; payment: Payment } => !!h.payment);
  });

  constructor() {
    effect(() => {
      const slug = this.slug().toLowerCase();
      if (this.skipNextLoad) {
        this.skipNextLoad = false;
        return;
      }
      // untracked: load() reads data(); tracking it here would re-run this effect on every response.
      untracked(() => {
        this.data.set(null);
        void this.load(slug);
      });
    });

    // Refresh when the resident comes back to the app (installed PWA stays open for days).
    const onVisible = () => {
      if (document.visibilityState === 'visible' && this.data()) void this.load(this.slug().toLowerCase(), true);
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
  }

  /**
   * Network first, always: residents must never see a stale "غير مدفوع" after the admin marked it paid.
   * The saved copy is only shown when the network fails (with a clear offline notice).
   */
  protected async load(slug: string, silent = false): Promise<void> {
    if (silent) this.refreshing.set(true);
    else this.loading.set(!this.data());

    let dash: PublicDashboard | null;
    try {
      dash = await getPublicDashboard(slug);
    } catch (err) {
      this.loading.set(false);
      this.refreshing.set(false);
      if (err instanceof PublicApiError && err.kind === 'config') {
        this.error.set('config');
        return;
      }
      const cached = this.data() ?? readCache(slug);
      if (cached) {
        this.data.set(cached);
        this.offline.set(true);
      } else {
        this.error.set('network');
      }
      return;
    }

    this.loading.set(false);
    this.refreshing.set(false);
    if (!dash) {
      this.data.set(null);
      this.error.set('not-found');
      forgetSlug(slug);
      return;
    }
    this.error.set(null);
    this.offline.set(false);
    this.data.set(dash);

    const canonical = dash.building.slug;
    writeCache(canonical, dash);
    rememberSlug(canonical);
    document.title = `${dash.building.name} — صندوق البناء`;
    if (canonical !== slug) {
      // Old QR code / renamed building → show the current address without reloading.
      this.skipNextLoad = true;
      void this.router.navigate(['/b', canonical], { replaceUrl: true });
    }
  }

  protected onCycleChange(event: Event): void {
    this.selectedCycleId.set((event.target as HTMLSelectElement).value);
  }

  protected onFloorChange(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    this.floorFilter.set(v === '' ? null : Number(v));
  }

  protected onExpenseCycleChange(event: Event): void {
    this.expenseCycleFilter.set((event.target as HTMLSelectElement).value);
  }

  protected cycleTitle(id: string | null): string {
    return this.cycles().find((c) => c.id === id)?.title ?? '';
  }

  protected openExpense(e: Expense): void {
    if (e.receipt_url) this.receipt.set(e);
  }
}
