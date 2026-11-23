import { BillingCycle, Building, Expense, Payment, Unit } from './models';
import { formatMoney, remaining } from './format';

export function publicBuildingUrl(slug: string): string {
  return `${location.origin}/b/${slug}`;
}

const HONORIFIC = /^(أبو|ابو|أم|ام|عائلة|آل|السيد|السيدة|الأستاذ|الاستاذ|الأستاذة|الدكتور|د\.|الحاج|الحاجة)\s/;

/** "أبو أحمد" stays as is; a bare name gets the polite "أبو/أم" from the paper sheet. */
export function politeName(name: string): string {
  const n = name.trim();
  return HONORIFIC.test(n) ? n : `أبو/أم ${n}`;
}

export function whatsappReminder(opts: {
  building: Building;
  cycle: BillingCycle;
  unit: Unit;
  payment: Payment;
}): string {
  const { building, cycle, unit, payment } = opts;
  return [
    `السلام عليكم ${politeName(unit.resident_name)}، تحية طيبة.`,
    `تذكير لطيف بمستحقات لجنة البناء (${building.name}) عن دورة: ${cycle.title}.`,
    `المبلغ المتبقي: ${formatMoney(remaining(payment), building.currency)}.`,
    `يمكنك مراجعة كافة التفاصيل والفواتير من هنا: ${publicBuildingUrl(building.slug)}`,
    `شكراً لتعاونكم.`,
  ].join('\n');
}

export function whatsappMonthlyReport(opts: {
  building: Building;
  cycle: BillingCycle;
  units: Unit[];
  payments: Payment[];
  expenses: Expense[];
  fundBalance: number;
}): string {
  const { building, cycle, units, payments, expenses, fundBalance } = opts;
  const money = (v: number) => formatMoney(v, building.currency);
  const name = (u: Unit) => (building.hide_resident_names ? u.label : `${u.label} - ${u.resident_name}`);
  const byUnit = new Map(payments.filter((p) => p.cycle_id === cycle.id).map((p) => [p.unit_id, p]));
  const rows = units.map((u) => ({ u, p: byUnit.get(u.id) })).filter((r): r is { u: Unit; p: Payment } => !!r.p);

  const paid = rows.filter((r) => r.p.status === 'paid');
  const partial = rows.filter((r) => r.p.status === 'partial');
  const unpaid = rows.filter((r) => r.p.status === 'unpaid');
  const cycleExpenses = expenses.filter((e) => e.cycle_id === cycle.id);
  const expensesTotal = cycleExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const collected = rows.reduce((s, r) => s + Number(r.p.amount_paid), 0);

  const lines: string[] = [
    `🏢 *${building.name}*`,
    `📅 ${cycle.title}`,
    '',
    `💰 رصيد صندوق البناء: *${money(fundBalance)}*`,
    `📥 المقبوض هالدورة: ${money(collected)}`,
    '',
    `✅ خالص (${paid.length}):`,
    ...(paid.length ? paid.map((r) => `• ${name(r.u)}`) : ['• لا أحد بعد']),
  ];
  if (partial.length) {
    lines.push('', `⏳ دفع جزء (${partial.length}):`);
    lines.push(...partial.map((r) => `• ${name(r.u)} — الباقي ${money(remaining(r.p))}`));
  }
  lines.push('', `❌ غير مدفوع (${unpaid.length}):`);
  lines.push(...(unpaid.length ? unpaid.map((r) => `• ${name(r.u)}`) : ['• الكل دفع، شكراً 🌷']));
  lines.push('', `🧾 مصاريف الشهر: ${money(expensesTotal)}`);
  lines.push(...cycleExpenses.map((e) => `• ${e.title}: ${money(Number(e.amount))}`));
  lines.push('', `🔗 كل التفاصيل والفواتير: ${publicBuildingUrl(building.slug)}`);
  return lines.join('\n');
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}
