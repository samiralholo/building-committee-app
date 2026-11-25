import { BillingCycle, Building, Expense, Payment, Unit } from './models';
import { CATEGORY_META, STATUS_META, formatDate, remaining } from './format';

type Cell = string | number | null | undefined;

function escapeCell(value: Cell): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** UTF-8 with BOM so Microsoft Excel shows Arabic correctly. */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function cycleReportRows(opts: {
  building: Building;
  cycle: BillingCycle;
  units: Unit[];
  payments: Payment[];
  expenses: Expense[];
}): Cell[][] {
  const { building, cycle, units, payments, expenses } = opts;
  const byUnit = new Map(payments.filter((p) => p.cycle_id === cycle.id).map((p) => [p.unit_id, p]));
  const cycleExpenses = expenses.filter((e) => e.cycle_id === cycle.id);

  const rows: Cell[][] = [
    [building.name],
    ['الدورة', cycle.title],
    ['العملة', building.currency],
    ['الشقق المشمولة', `${payments.filter((p) => p.cycle_id === cycle.id).length} من ${units.length}`],
    [],
    ['الدفعات'],
    ['الشقة', 'الطابق', 'الساكن', 'الحالة', 'المطلوب', 'المدفوع', 'الباقي', 'تاريخ الدفع', 'ملاحظات'],
  ];
  let due = 0;
  let paid = 0;
  for (const u of units) {
    const p = byUnit.get(u.id);
    if (!p) continue;
    due += Number(p.amount_due);
    paid += Number(p.amount_paid);
    rows.push([
      u.label,
      u.floor,
      u.resident_name,
      STATUS_META[p.status].label,
      Number(p.amount_due),
      Number(p.amount_paid),
      remaining(p),
      p.paid_at ? formatDate(p.paid_at) : '',
      p.notes ?? '',
    ]);
  }
  rows.push(['المجموع', '', '', '', due, paid, Math.max(due - paid, 0)]);

  rows.push([], ['المصاريف'], ['البند', 'النوع', 'التاريخ', 'المبلغ', 'ملاحظات', 'رابط الفاتورة']);
  let spent = 0;
  for (const e of cycleExpenses) {
    spent += Number(e.amount);
    rows.push([e.title, CATEGORY_META[e.category].label, formatDate(e.expense_date), Number(e.amount), e.notes ?? '', e.receipt_url ?? '']);
  }
  rows.push(['المجموع', '', '', spent]);
  return rows;
}
