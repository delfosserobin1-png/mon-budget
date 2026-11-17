// Statistiques (calculs purs). Sauf mention contraire, on ne compte que les opérations RÉELLES,
// datées d'aujourd'hui au plus tard, et jamais les virements internes ni les ajustements : une
// dépense est une vraie sortie d'argent, un revenu une vraie entrée.

import { KIND, IMPORTANCE } from './schema.js';
import { addDays, addMonths, daysBetween, endOfMonth, monthKey, monthRange, startOfMonth } from './dates.js';
import { availableDelta, totalDelta } from './balances.js';
import { partyKey, titleCase } from './text.js';

/** Périodes proposées dans l'écran Stats. */
export function periodPresets(today) {
  const monthStart = startOfMonth(today);
  const lastStart = addMonths(monthStart, -1);
  const year = today.slice(0, 4);
  return [
    { id: 'month', label: 'Ce mois', from: monthStart, to: endOfMonth(today) },
    { id: 'lastMonth', label: 'Mois dernier', from: lastStart, to: endOfMonth(lastStart) },
    { id: '3months', label: '3 mois', from: addMonths(monthStart, -2), to: endOfMonth(today) },
    { id: '12months', label: '12 mois', from: addMonths(monthStart, -11), to: endOfMonth(today) },
    { id: 'year', label: year, from: `${year}-01-01`, to: `${year}-12-31` },
    { id: 'all', label: 'Tout', from: null, to: null },
  ];
}

/** Date de la plus ancienne opération réelle (ou aujourd'hui s'il n'y en a pas). */
export function firstRealDate(state, today) {
  let first = null;
  for (const op of state.operations) {
    if (op.simulated) continue;
    if (!first || op.date < first) first = op.date;
  }
  return first && first < today ? first : today;
}

/** Complète une période ouverte (« Tout ») avec de vraies bornes. */
export function resolveRange(state, range, today) {
  const from = range.from || startOfMonth(firstRealDate(state, today));
  const to = range.to || endOfMonth(today);
  return { ...range, from, to: to < from ? from : to };
}

function inScope(op, scope) {
  if (!scope || scope === 'all') return true;
  if (scope === 'available') return !op.envelopeId;
  return op.envelopeId === scope;
}

/** Dépenses et revenus réels de la période. scope : 'all' | 'available' | identifiant d'enveloppe. */
export function movements(state, { from, to, today, scope = 'all' }) {
  const upper = to && to < today ? to : today;
  const out = [];
  for (const op of state.operations) {
    if (op.simulated || op.kind !== KIND.OPERATION) continue;
    if (op.date > upper || (from && op.date < from)) continue;
    if (!inScope(op, scope)) continue;
    out.push(op);
  }
  return out;
}

function totalsOf(ops) {
  let income = 0;
  let expense = 0;
  for (const op of ops) {
    if (op.amount >= 0) income += op.amount;
    else expense += -op.amount;
  }
  return { income, expense, net: income - expense, count: ops.length };
}

/** Période précédente de même durée (mois entiers → mois entiers). */
export function previousRange({ from, to }) {
  if (!from || !to) return null;
  const wholeMonths = from === startOfMonth(from) && to === endOfMonth(to);
  if (wholeMonths) {
    const n = monthRange(monthKey(from), monthKey(to)).length;
    const prevFrom = addMonths(from, -n);
    return { from: prevFrom, to: endOfMonth(addMonths(prevFrom, n - 1)) };
  }
  const days = daysBetween(from, to) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** Résumé d'une période : revenus, dépenses, solde, rythme, et comparaison avec la période d'avant. */
export function summarize(state, range) {
  const ops = movements(state, range);
  const current = totalsOf(ops);
  const upper = range.to && range.to < range.today ? range.to : range.today;
  const days = range.from && range.from <= upper ? daysBetween(range.from, upper) + 1 : 0;
  let biggest = null;
  for (const op of ops) if (op.amount < 0 && (!biggest || op.amount < biggest.amount)) biggest = op;
  let prev = range.previous === false ? null : previousRange(range);
  // Période en cours (« Ce mois » un 15) : on compare à la même durée de la période d'avant (du 1er
  // au 15 du mois dernier), sinon un mois entamé paraîtrait toujours plus sage que le précédent.
  const partial = !!(prev && range.to > range.today && range.from <= range.today);
  if (partial) {
    const sameSpan = addDays(prev.from, daysBetween(range.from, range.today));
    prev = { from: prev.from, to: sameSpan < prev.to ? sameSpan : prev.to };
  }
  const hasHistory = prev && state.operations.some((op) => !op.simulated && op.kind === KIND.OPERATION && op.date <= prev.to);
  const previous = hasHistory ? totalsOf(movements(state, { ...range, from: prev.from, to: prev.to })) : null;
  return { ...current, days, perDay: days > 0 ? Math.round(current.expense / days) : 0, biggest, previous, previousRange: hasHistory ? prev : null, partial: partial && hasHistory };
}

/** Répartit un montant en n parts entières dont la somme est exacte. */
function splitEvenly(amount, n) {
  const base = Math.floor(amount / n);
  const rest = amount - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Dépenses par tag. Une dépense qui porte plusieurs tags est partagée à parts égales entre eux,
 * pour que le total des tranches reste égal au total des dépenses.
 * Renvoie [{ id (null = sans tag), name, color, amount, count, share }] du plus gros au plus petit.
 */
export function expensesByTag(state, range) {
  const buckets = new Map();
  const known = new Map(state.tags.map((t) => [t.id, t]));
  let total = 0;
  for (const op of movements(state, range)) {
    if (op.amount >= 0) continue;
    const amount = -op.amount;
    total += amount;
    const ids = op.tags.filter((id) => known.has(id));
    const keys = ids.length ? ids : [null];
    const sharesList = splitEvenly(amount, keys.length);
    keys.forEach((key, i) => {
      const b = buckets.get(key) || { id: key, amount: 0, count: 0 };
      b.amount += sharesList[i];
      b.count += 1;
      buckets.set(key, b);
    });
  }
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      name: b.id ? known.get(b.id).name : 'Sans tag',
      color: b.id ? known.get(b.id).color : 'ardoise',
      share: total ? b.amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'fr'));
}

/** Dépenses par niveau d'importance (Nécessité / Confort / Caprice / Non précisé). */
export function expensesByImportance(state, range) {
  const amounts = { necessite: 0, confort: 0, caprice: 0, none: 0 };
  let total = 0;
  for (const op of movements(state, range)) {
    if (op.amount >= 0) continue;
    amounts[op.importance || 'none'] += -op.amount;
    total += -op.amount;
  }
  const rows = IMPORTANCE.map((i) => ({ id: i.id, label: i.label, amount: amounts[i.id] }));
  rows.push({ id: 'none', label: 'Non précisé', amount: amounts.none });
  return rows.map((r) => ({ ...r, share: total ? r.amount / total : 0 }));
}

/** Mois par mois : revenus, dépenses, solde du mois, et dépenses par importance. */
export function monthlySeries(state, range) {
  const { from, to, today } = range;
  const lastKey = monthKey(to && to < today ? to : today);
  const keys = monthRange(monthKey(from), lastKey < monthKey(from) ? monthKey(from) : lastKey);
  const rows = new Map(keys.map((key) => [key, { key, income: 0, expense: 0, net: 0, importance: { necessite: 0, confort: 0, caprice: 0, none: 0 } }]));
  for (const op of movements(state, range)) {
    const row = rows.get(monthKey(op.date));
    if (!row) continue;
    if (op.amount >= 0) row.income += op.amount;
    else {
      row.expense += -op.amount;
      row.importance[op.importance || 'none'] += -op.amount;
    }
    row.net = row.income - row.expense;
  }
  return [...rows.values()];
}

/**
 * Évolution des soldes, jour par jour : compte courant et solde total.
 * Après aujourd'hui, la courbe devient une projection (opérations réelles déjà datées dans le
 * futur + simulations cochées) : chaque point porte `projected: true`.
 */
export function balanceSeries(state, { from, to, today }) {
  const byDay = new Map();
  let available = 0;
  let total = 0;
  for (const op of state.operations) {
    const counted = !op.simulated || (op.checked && op.date > today);
    if (!counted) continue;
    const dA = availableDelta(op);
    const dT = totalDelta(op);
    if (op.date < from) {
      available += dA;
      total += dT;
    } else if (op.date <= to) {
      const d = byDay.get(op.date) || { a: 0, t: 0 };
      d.a += dA;
      d.t += dT;
      byDay.set(op.date, d);
    }
  }
  const points = [];
  const length = daysBetween(from, to);
  for (let i = 0; i <= length; i++) {
    const date = addDays(from, i);
    const d = byDay.get(date);
    if (d) {
      available += d.a;
      total += d.t;
    }
    points.push({ date, available, total, projected: date > today });
  }
  return points;
}

/** Dépenses par enveloppe (et compte courant). */
export function expensesByEnvelope(state, range) {
  const buckets = new Map();
  let total = 0;
  for (const op of movements(state, { ...range, scope: 'all' })) {
    if (op.amount >= 0) continue;
    const key = op.envelopeId && state.envelopes.some((e) => e.id === op.envelopeId) ? op.envelopeId : null;
    buckets.set(key, (buckets.get(key) || 0) + -op.amount);
    total += -op.amount;
  }
  return [...buckets.entries()]
    .map(([id, amount]) => {
      const env = id ? state.envelopes.find((e) => e.id === id) : null;
      return { id, name: env ? env.name : 'Compte courant', color: env ? env.color : 'ardoise', amount, share: total ? amount / total : 0 };
    })
    .sort((a, b) => b.amount - a.amount);
}

/** Tiers chez qui on dépense le plus. */
export function topCounterparties(state, range, limit = 8) {
  const buckets = new Map();
  for (const op of movements(state, range)) {
    if (op.amount >= 0) continue;
    const raw = op.counterparty || op.label;
    const key = partyKey(raw);
    if (!key) continue;
    const b = buckets.get(key) || { key, amount: 0, count: 0, names: new Map() };
    b.amount += -op.amount;
    b.count += 1;
    b.names.set(raw, (b.names.get(raw) || 0) + 1);
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((b) => {
      const name = [...b.names.entries()].sort((x, y) => y[1] - x[1])[0][0];
      return { key: b.key, name: name === name.toUpperCase() ? titleCase(name) : name, amount: b.amount, count: b.count };
    });
}

/** Dépenses fixes (issues d'une récurrence) et variables (tout le reste). */
export function fixedVsVariable(state, range) {
  let fixed = 0;
  let variable = 0;
  for (const op of movements(state, range)) {
    if (op.amount >= 0) continue;
    if (op.recurringId) fixed += -op.amount;
    else variable += -op.amount;
  }
  return { fixed, variable, total: fixed + variable };
}

/** Dépenses par jour (Map "AAAA-MM-JJ" → centimes) pour le calendrier. */
export function dailyExpenses(state, range) {
  const days = new Map();
  for (const op of movements(state, range)) {
    if (op.amount >= 0) continue;
    days.set(op.date, (days.get(op.date) || 0) + -op.amount);
  }
  return days;
}

/** Écarts constatés lors des rapprochements, du plus ancien au plus récent. */
export function reconciliationSeries(state) {
  return state.reconciliations.slice().sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
}

/** Évolution en pourcentage entre deux valeurs (null si la base est nulle). */
export function variation(current, previous) {
  if (!previous) return null;
  return (current - previous) / Math.abs(previous);
}
