import { Injectable, computed, inject, signal } from '@angular/core';
import { AccessService } from '../../core/access.service';
import { RECEIPTS_BUCKET } from '../../core/config';
import { deriveStatus, remaining } from '../../core/format';
import { BillingCycle, Building, CycleType, Expense, Payment, Unit, UnitGroup } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';

const SELECTED_BUILDING_KEY = 'bc:admin-building';

export type UnitDraft = Pick<Unit, 'label' | 'floor' | 'resident_name' | 'whatsapp_phone' | 'is_occupied'>;
export type ExpenseDraft = Pick<Expense, 'title' | 'category' | 'amount' | 'expense_date' | 'cycle_id' | 'notes'>;

function sortUnits(list: Unit[]): Unit[] {
  return [...list].sort((a, b) => a.sort_order - b.sort_order || a.floor - b.floor || a.label.localeCompare(b.label, 'ar'));
}

function sortCycles(list: BillingCycle[]): BillingCycle[] {
  return [...list].sort((a, b) => b.cycle_date.localeCompare(a.cycle_date) || b.created_at.localeCompare(a.created_at));
}

function sortExpenses(list: Expense[]): Expense[] {
  return [...list].sort((a, b) => b.expense_date.localeCompare(a.expense_date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

/** Single source of truth for the admin portal. Provided by AdminShell. */
@Injectable()
export class AdminStore {
  private readonly db = inject(SupabaseService).client;
  private readonly accessService = inject(AccessService);

  readonly buildings = signal<Building[]>([]);
  readonly buildingId = signal<string | null>(null);
  readonly units = signal<Unit[]>([]);
  readonly cycles = signal<BillingCycle[]>([]);
  readonly payments = signal<Payment[]>([]);
  readonly expenses = signal<Expense[]>([]);
  /** Saved subscriber groups (e.g. «مشتركو المصعد») with their member unit ids. */
  readonly groups = signal<UnitGroup[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  /** Super Admin inspection: data is shown, every mutation is hidden (RLS also blocks it). */
  readonly readOnly = signal(false);

  readonly building = computed(() => this.buildings().find((b) => b.id === this.buildingId()) ?? null);
  readonly latestCycle = computed(() => this.cycles()[0] ?? null);

  /** The cycle chosen on the dashboard / payments grid (shared, defaults to latest). */
  readonly selectedCycleId = signal<string | null>(null);
  readonly selectedCycle = computed(
    () => this.cycles().find((c) => c.id === this.selectedCycleId()) ?? this.latestCycle(),
  );

  readonly totalCollected = computed(() => this.payments().reduce((s, p) => s + Number(p.amount_paid), 0));
  readonly totalExpenses = computed(() => this.expenses().reduce((s, e) => s + Number(e.amount), 0));
  readonly fundBalance = computed(() => this.totalCollected() - this.totalExpenses());
  readonly totalArrears = computed(() => this.payments().reduce((s, p) => s + remaining(p), 0));

  paymentsFor(cycleId: string | null | undefined): Payment[] {
    return cycleId ? this.payments().filter((p) => p.cycle_id === cycleId) : [];
  }

  /** Unit ids that have a row in this cycle (the cycle's "included units"). */
  includedUnitIds(cycleId: string | null | undefined): string[] {
    return this.paymentsFor(cycleId).map((p) => p.unit_id);
  }

  // ---------------------------------------------------------------- loading

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      // Only the buildings this user is ASSIGNED to (a superadmin can read all, but manages only assigned ones).
      const acc = await this.accessService.load();
      const ids = acc?.buildings.map((b) => b.id) ?? [];
      let list: Building[] = [];
      if (ids.length) {
        const { data, error } = await this.db.from('buildings').select('*').in('id', ids).order('created_at');
        if (error) throw error;
        list = (data ?? []) as Building[];
      }
      this.buildings.set(list);
      let preferred: string | null = null;
      try {
        preferred = localStorage.getItem(SELECTED_BUILDING_KEY);
      } catch {
        /* ignore */
      }
      const chosen = list.find((b) => b.id === preferred) ?? list[0] ?? null;
      this.buildingId.set(chosen?.id ?? null);
      if (chosen) await this.loadBuildingData(chosen.id);
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Read-only load of ONE building (Super Admin inspection page). */
  async loadSingle(id: string): Promise<void> {
    this.readOnly.set(true);
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const { data, error } = await this.db.from('buildings').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      const b = data as Building | null;
      this.buildings.set(b ? [b] : []);
      this.buildingId.set(b?.id ?? null);
      if (b) await this.loadBuildingData(b.id);
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async switchBuilding(id: string): Promise<void> {
    this.buildingId.set(id);
    this.selectedCycleId.set(null);
    try {
      localStorage.setItem(SELECTED_BUILDING_KEY, id);
    } catch {
      /* ignore */
    }
    this.loading.set(true);
    try {
      await this.loadBuildingData(id);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadBuildingData(buildingId: string): Promise<void> {
    const [units, cycles, payments, expenses] = await Promise.all([
      this.db.from('units').select('*').eq('building_id', buildingId),
      this.db.from('billing_cycles').select('*').eq('building_id', buildingId),
      this.db.from('payments').select('*').eq('building_id', buildingId),
      this.db.from('expenses').select('*').eq('building_id', buildingId),
    ]);
    const err = units.error ?? cycles.error ?? payments.error ?? expenses.error;
    if (err) throw err;
    // Groups are a convenience: never block the admin screens if they can't load.
    await this.loadGroups(buildingId).catch(() => this.groups.set([]));
    this.units.set(sortUnits((units.data ?? []) as Unit[]));
    this.cycles.set(sortCycles((cycles.data ?? []) as BillingCycle[]));
    this.payments.set((payments.data ?? []) as Payment[]);
    this.expenses.set(sortExpenses((expenses.data ?? []) as Expense[]));
  }

  private async loadGroups(buildingId: string): Promise<void> {
    const { data: gs, error } = await this.db.from('unit_groups').select('*').eq('building_id', buildingId);
    if (error) throw error;
    const groups = (gs ?? []) as Omit<UnitGroup, 'unit_ids'>[];
    let members: { group_id: string; unit_id: string }[] = [];
    if (groups.length) {
      const { data: ms, error: mErr } = await this.db
        .from('unit_group_members')
        .select('group_id, unit_id')
        .in('group_id', groups.map((g) => g.id));
      if (mErr) throw mErr;
      members = (ms ?? []) as typeof members;
    }
    this.groups.set(
      groups
        .map((g) => ({ ...g, unit_ids: members.filter((m) => m.group_id === g.id).map((m) => m.unit_id) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    );
  }

  private requireBuilding(): Building {
    const b = this.building();
    if (!b) throw new Error('no building');
    return b;
  }

  // ---------------------------------------------------------------- building

  async updateBuilding(patch: Partial<Omit<Building, 'id' | 'owner_id' | 'created_at'>>): Promise<void> {
    const b = this.requireBuilding();
    const { data, error } = await this.db.from('buildings').update(patch).eq('id', b.id).select().single();
    if (error) throw error;
    this.buildings.update((list) => list.map((x) => (x.id === b.id ? (data as Building) : x)));
  }

  // ---------------------------------------------------------------- cycles

  /** unitIds omitted = every unit (vacant ones exempt), exactly as before. */
  async createCycle(input: {
    title: string;
    cycle_type: CycleType;
    amount: number;
    date: string;
    unitIds?: string[];
  }): Promise<BillingCycle> {
    const b = this.requireBuilding();
    if (input.unitIds && input.unitIds.length === 0) throw new Error('no units selected');
    const { data, error } = await this.db.rpc('create_billing_cycle', {
      p_building_id: b.id,
      p_title: input.title,
      p_cycle_type: input.cycle_type,
      p_amount: input.amount,
      p_cycle_date: input.date,
      ...(input.unitIds ? { p_unit_ids: input.unitIds } : {}),
    });
    if (error) throw error;
    const cycle = data as BillingCycle;
    const { data: rows, error: pErr } = await this.db.from('payments').select('*').eq('cycle_id', cycle.id);
    if (pErr) throw pErr;
    this.cycles.update((list) => sortCycles([...list, cycle]));
    this.payments.update((list) => [...list, ...((rows ?? []) as Payment[])]);
    this.selectedCycleId.set(cycle.id);
    return cycle;
  }

  async deleteCycle(cycle: BillingCycle): Promise<void> {
    const { error } = await this.db.from('billing_cycles').delete().eq('id', cycle.id);
    if (error) throw error;
    this.cycles.update((list) => list.filter((c) => c.id !== cycle.id));
    this.payments.update((list) => list.filter((p) => p.cycle_id !== cycle.id));
    this.expenses.update((list) => list.map((e) => (e.cycle_id === cycle.id ? { ...e, cycle_id: null } : e)));
    if (this.selectedCycleId() === cycle.id) this.selectedCycleId.set(null);
  }

  /**
   * Make the cycle cover exactly `unitIds`: adds rows (unpaid at the cycle amount; vacant → exempt)
   * and deletes rows of units taken out. Rows with money paid are only removed when `allowPaidRemoval`.
   */
  async setCycleUnits(cycle: BillingCycle, unitIds: string[], allowPaidRemoval = false): Promise<{ added: number; removed: number }> {
    const b = this.requireBuilding();
    const wanted = new Set(unitIds);
    const current = this.paymentsFor(cycle.id);
    const currentIds = new Set(current.map((p) => p.unit_id));
    const toAdd = this.units().filter((u) => wanted.has(u.id) && !currentIds.has(u.id));
    const toRemove = current.filter((p) => !wanted.has(p.unit_id));
    if (!allowPaidRemoval && toRemove.some((p) => Number(p.amount_paid) > 0)) throw new Error('paid units selected for removal');
    if (wanted.size === 0) throw new Error('no units selected');

    if (toAdd.length) {
      const { data, error } = await this.db
        .from('payments')
        .insert(
          toAdd.map((u) => ({
            building_id: b.id,
            cycle_id: cycle.id,
            unit_id: u.id,
            amount_due: u.is_occupied ? cycle.default_amount : 0,
            amount_paid: 0,
            status: u.is_occupied ? 'unpaid' : 'exempt',
          })),
        )
        .select();
      if (error) throw error;
      this.payments.update((list) => [...list, ...((data ?? []) as Payment[])]);
    }
    if (toRemove.length) {
      const ids = toRemove.map((p) => p.id);
      const { error } = await this.db.from('payments').delete().in('id', ids);
      if (error) throw error;
      const gone = new Set(ids);
      this.payments.update((list) => list.filter((p) => !gone.has(p.id)));
    }
    return { added: toAdd.length, removed: toRemove.length };
  }

  // ---------------------------------------------------------------- groups

  /** Create (or update by id / same name) a subscriber group with its members, in one call. */
  async saveGroup(name: string, unitIds: string[], groupId?: string): Promise<UnitGroup> {
    const b = this.requireBuilding();
    const { data, error } = await this.db.rpc('save_unit_group', {
      p_building_id: b.id,
      p_name: name.trim(),
      p_unit_ids: unitIds,
      ...(groupId ? { p_group_id: groupId } : {}),
    });
    if (error) throw error;
    await this.loadGroups(b.id);
    const saved = data as Omit<UnitGroup, 'unit_ids'>;
    return this.groups().find((g) => g.id === saved.id) ?? { ...saved, unit_ids: unitIds };
  }

  /** Deletes only the group (units and payment history are untouched). */
  async deleteGroup(group: UnitGroup): Promise<void> {
    const { error } = await this.db.from('unit_groups').delete().eq('id', group.id);
    if (error) throw error;
    this.groups.update((list) => list.filter((g) => g.id !== group.id));
  }

  // ---------------------------------------------------------------- payments

  private replacePayment(next: Payment): void {
    this.payments.update((list) => list.map((p) => (p.id === next.id ? next : p)));
  }

  /** One tap: full amount paid. Optimistic, reverts on failure. */
  async markPaid(payment: Payment): Promise<void> {
    const optimistic: Payment = {
      ...payment,
      amount_paid: Number(payment.amount_due),
      status: 'paid',
      paid_at: new Date().toISOString(),
    };
    this.replacePayment(optimistic);
    const { data, error } = await this.db
      .from('payments')
      .update({ amount_paid: optimistic.amount_paid, status: 'paid', paid_at: optimistic.paid_at })
      .eq('id', payment.id)
      .select()
      .single();
    if (error) {
      this.replacePayment(payment);
      throw error;
    }
    this.replacePayment(data as Payment);
  }

  async updatePayment(
    payment: Payment,
    changes: { amount_due: number; amount_paid: number; exempt: boolean; notes: string | null },
  ): Promise<void> {
    const status = deriveStatus(changes.amount_due, changes.amount_paid, changes.exempt);
    const patch = {
      amount_due: changes.exempt ? 0 : changes.amount_due,
      amount_paid: changes.exempt ? 0 : changes.amount_paid,
      status,
      notes: changes.notes,
      paid_at: status === 'paid' ? (payment.paid_at ?? new Date().toISOString()) : status === 'partial' ? payment.paid_at : null,
    };
    this.replacePayment({ ...payment, ...patch });
    const { data, error } = await this.db.from('payments').update(patch).eq('id', payment.id).select().single();
    if (error) {
      this.replacePayment(payment);
      throw error;
    }
    this.replacePayment(data as Payment);
  }

  // ---------------------------------------------------------------- units

  async saveUnit(draft: UnitDraft, existing?: Unit): Promise<void> {
    const b = this.requireBuilding();
    if (existing) {
      const { data, error } = await this.db.from('units').update(draft).eq('id', existing.id).select().single();
      if (error) throw error;
      this.units.update((list) => sortUnits(list.map((u) => (u.id === existing.id ? (data as Unit) : u))));
    } else {
      const nextOrder = Math.max(0, ...this.units().map((u) => u.sort_order)) + 1;
      const { data, error } = await this.db
        .from('units')
        .insert({ ...draft, building_id: b.id, sort_order: nextOrder })
        .select()
        .single();
      if (error) throw error;
      this.units.update((list) => sortUnits([...list, data as Unit]));
    }
  }

  async deleteUnit(unit: Unit): Promise<void> {
    const { error } = await this.db.from('units').delete().eq('id', unit.id);
    if (error) throw error;
    this.units.update((list) => list.filter((u) => u.id !== unit.id));
    this.payments.update((list) => list.filter((p) => p.unit_id !== unit.id));
    this.groups.update((list) => list.map((g) => ({ ...g, unit_ids: g.unit_ids.filter((id) => id !== unit.id) })));
  }

  /** Swap with the neighbour above/below. Re-numbers everything so order is always clean. */
  async moveUnit(unit: Unit, direction: -1 | 1): Promise<void> {
    const list = [...this.units()];
    const i = list.findIndex((u) => u.id === unit.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const before = this.units();
    const renumbered = list.map((u, idx) => ({ ...u, sort_order: idx + 1 }));
    this.units.set(renumbered);
    const changed = renumbered.filter((u) => before.find((b) => b.id === u.id)?.sort_order !== u.sort_order);
    const results = await Promise.all(
      changed.map((u) => this.db.from('units').update({ sort_order: u.sort_order }).eq('id', u.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      this.units.set(before);
      throw failed.error;
    }
  }

  // ---------------------------------------------------------------- expenses

  async saveExpense(draft: ExpenseDraft, existing?: Expense, receipt?: Blob | null): Promise<void> {
    const b = this.requireBuilding();
    let saved: Expense;
    if (existing) {
      const { data, error } = await this.db.from('expenses').update(draft).eq('id', existing.id).select().single();
      if (error) throw error;
      saved = data as Expense;
    } else {
      const { data, error } = await this.db
        .from('expenses')
        .insert({ ...draft, building_id: b.id })
        .select()
        .single();
      if (error) throw error;
      saved = data as Expense;
    }

    if (receipt) {
      const path = `${b.id}/${saved.id}.jpg`;
      const { error: upErr } = await this.db.storage
        .from(RECEIPTS_BUCKET)
        .upload(path, receipt, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
      if (upErr) {
        this.upsertExpenseLocal(saved);
        throw upErr;
      }
      const { data: pub } = this.db.storage.from(RECEIPTS_BUCKET).getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Date.now()}`; // cache-bust when a receipt is replaced
      const { data, error } = await this.db
        .from('expenses')
        .update({ receipt_url: url })
        .eq('id', saved.id)
        .select()
        .single();
      if (error) throw error;
      saved = data as Expense;
    }
    this.upsertExpenseLocal(saved);
  }

  async removeReceipt(expense: Expense): Promise<void> {
    const b = this.requireBuilding();
    await this.db.storage.from(RECEIPTS_BUCKET).remove([`${b.id}/${expense.id}.jpg`]);
    const { data, error } = await this.db
      .from('expenses')
      .update({ receipt_url: null })
      .eq('id', expense.id)
      .select()
      .single();
    if (error) throw error;
    this.upsertExpenseLocal(data as Expense);
  }

  async deleteExpense(expense: Expense): Promise<void> {
    const b = this.requireBuilding();
    const { error } = await this.db.from('expenses').delete().eq('id', expense.id);
    if (error) throw error;
    if (expense.receipt_url) {
      await this.db.storage.from(RECEIPTS_BUCKET).remove([`${b.id}/${expense.id}.jpg`]);
    }
    this.expenses.update((list) => list.filter((e) => e.id !== expense.id));
  }

  private upsertExpenseLocal(e: Expense): void {
    this.expenses.update((list) => sortExpenses([...list.filter((x) => x.id !== e.id), e]));
  }

  reset(): void {
    this.buildings.set([]);
    this.buildingId.set(null);
    this.units.set([]);
    this.cycles.set([]);
    this.payments.set([]);
    this.expenses.set([]);
    this.groups.set([]);
    this.selectedCycleId.set(null);
  }
}
