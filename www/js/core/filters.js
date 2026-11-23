// Recherche et filtres de la liste des opérations (logique pure, sans interface).

import { KIND, importanceLabel } from './schema.js';
import { addMonths, endOfMonth, formatDate, startOfMonth } from './dates.js';
import { formatForInput } from './money.js';
import { matchesQuery } from './text.js';
import { deltaFor, touchesAvailable, touchesEnvelope } from './balances.js';
import { moveLabel } from './operations.js';

export const PERIODS = Object.freeze([
  { id: 'all', label: 'Tout' },
  { id: 'month', label: 'Ce mois' },
  { id: 'lastMonth', label: 'Mois dernier' },
  { id: '3months', label: '3 mois' },
  { id: 'year', label: 'Cette année' },
  { id: 'custom', label: 'Dates au choix' },
]);

export const TYPES = Object.freeze([
  { id: 'expense', label: 'Sorties' },
  { id: 'income', label: 'Entrées' },
  { id: 'transfer', label: "Mouvements d'enveloppes" },
  { id: 'adjustment', label: 'Ajustements' },
]);

export function emptyFilter() {
  return {
    query: '',
    period: 'all',
    from: null,
    to: null,
    types: [],
    tags: [],
    untagged: false,
    account: 'all', // 'all' | 'available' (compte courant) | identifiant d'enveloppe
    importance: [],
    minAmount: null, // en centimes, sur la valeur absolue
    maxAmount: null,
    withPhoto: false,
    unpointed: false,
    counterparty: '',
  };
}

/** Nombre de critères actifs (hors recherche texte) — affiché sur le bouton « Filtres ». */
export function activeCount(filter) {
  let n = 0;
  if (filter.period !== 'all') n++;
  if (filter.types.length) n++;
  if (filter.tags.length || filter.untagged) n++;
  if (filter.account !== 'all') n++;
  if (filter.importance.length) n++;
  if (filter.minAmount != null || filter.maxAmount != null) n++;
  if (filter.withPhoto) n++;
  if (filter.unpointed) n++;
  if (filter.counterparty) n++;
  return n;
}

export function isFilterActive(filter) {
  return activeCount(filter) > 0 || filter.query.trim() !== '';
}

/** Bornes de dates d'un filtre ({ from, to }, null = pas de borne). */
export function resolvePeriod(filter, today) {
  const monthStart = startOfMonth(today);
  switch (filter.period) {
    case 'month':
      return { from: monthStart, to: endOfMonth(today) };
    case 'lastMonth': {
      const start = addMonths(monthStart, -1);
      return { from: start, to: endOfMonth(start) };
    }
    case '3months':
      return { from: addMonths(monthStart, -2), to: endOfMonth(today) };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom':
      return { from: filter.from || null, to: filter.to || null };
    default:
      return { from: null, to: null };
  }
}

export function typeOf(op) {
  if (op.kind === KIND.TRANSFER) return 'transfer';
  if (op.kind === KIND.ADJUSTMENT) return 'adjustment';
  return op.amount < 0 ? 'expense' : 'income';
}

function haystack(state, op, names) {
  const partsList = [op.label, op.counterparty, op.comment, formatDate(op.date), formatForInput(op.amount)];
  for (const id of op.tags) partsList.push(names.tags.get(id) || '');
  if (op.envelopeId) partsList.push(names.envelopes.get(op.envelopeId) || '');
  if (op.kind === KIND.TRANSFER) {
    // on retrouve un mouvement d'enveloppe par son nom actuel comme par l'ancien (« virement »)
    partsList.push('virement', 'mouvement', moveLabel(op.from, op.to), names.envelopes.get(op.from) || 'compte courant', names.envelopes.get(op.to) || 'compte courant');
  }
  if (op.importance) partsList.push(importanceLabel(op.importance));
  if (op.bank) partsList.push(op.bank.label, ...op.bank.details);
  return partsList.join(' ');
}

/**
 * Opérations qui passent le filtre. `base` permet de restreindre au préalable (réelles, simulées…).
 * L'ordre d'origine est conservé (voir sortForList).
 */
export function filterOperations(state, filter, { today, base = null } = {}) {
  const { from, to } = resolvePeriod(filter, today);
  const names = {
    tags: new Map(state.tags.map((t) => [t.id, t.name])),
    envelopes: new Map(state.envelopes.map((e) => [e.id, e.name])),
  };
  const query = filter.query.trim();
  const out = [];
  for (const op of base || state.operations) {
    if (from && op.date < from) continue;
    if (to && op.date > to) continue;
    if (filter.types.length && !filter.types.includes(typeOf(op))) continue;
    if (filter.account === 'available' && !touchesAvailable(op)) continue;
    if (filter.account !== 'all' && filter.account !== 'available' && !touchesEnvelope(op, filter.account)) continue;
    if (filter.tags.length || filter.untagged) {
      const hasWanted = filter.tags.some((id) => op.tags.includes(id));
      const isUntagged = filter.untagged && op.kind !== KIND.TRANSFER && op.tags.length === 0;
      if (!hasWanted && !isUntagged) continue;
    }
    if (filter.importance.length && !filter.importance.includes(op.importance || 'none')) continue;
    const abs = Math.abs(op.amount);
    if (filter.minAmount != null && abs < filter.minAmount) continue;
    if (filter.maxAmount != null && abs > filter.maxAmount) continue;
    if (filter.withPhoto && !op.photoIds.length) continue;
    if (filter.unpointed && (op.bank || op.kind !== KIND.OPERATION || op.simulated)) continue;
    if (filter.counterparty && !matchesQuery(`${op.counterparty} ${op.label}`, filter.counterparty)) continue;
    if (query && !matchesQuery(haystack(state, op, names), query)) continue;
    out.push(op);
  }
  return out;
}

/** Tri d'affichage : le plus récent en haut, le plus ancien en bas. */
export function sortNewestFirst(ops) {
  return ops.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ta = a.time || '';
    const tb = b.time || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/** Total d'une liste vue d'un compte (null = compte courant, 'total' = solde total, sinon enveloppe). */
export function listTotal(ops, perspective) {
  let sum = 0;
  for (const op of ops) {
    if (perspective === 'total') sum += op.kind === KIND.TRANSFER ? 0 : op.amount;
    else sum += deltaFor(op, perspective);
  }
  return sum;
}

/** Petites étiquettes qui résument le filtre en cours (« Ce mois », « Sorties », « Courses »…). */
export function describeFilter(state, filter) {
  const labels = [];
  if (filter.period === 'custom') {
    if (filter.from && filter.to) labels.push(`Du ${formatDate(filter.from)} au ${formatDate(filter.to)}`);
    else if (filter.from) labels.push(`Depuis le ${formatDate(filter.from)}`);
    else if (filter.to) labels.push(`Jusqu'au ${formatDate(filter.to)}`);
  } else if (filter.period !== 'all') {
    labels.push(PERIODS.find((p) => p.id === filter.period)?.label || '');
  }
  for (const t of filter.types) labels.push(TYPES.find((x) => x.id === t)?.label || '');
  if (filter.account === 'available') labels.push('Compte courant');
  else if (filter.account !== 'all') labels.push(state.envelopes.find((e) => e.id === filter.account)?.name || 'Enveloppe');
  for (const id of filter.tags) labels.push(state.tags.find((t) => t.id === id)?.name || 'Tag');
  if (filter.untagged) labels.push('Sans tag');
  for (const id of filter.importance) labels.push(id === 'none' ? 'Importance non précisée' : importanceLabel(id));
  if (filter.minAmount != null && filter.maxAmount != null) labels.push(`De ${formatForInput(filter.minAmount)} à ${formatForInput(filter.maxAmount)} €`);
  else if (filter.minAmount != null) labels.push(`Au moins ${formatForInput(filter.minAmount)} €`);
  else if (filter.maxAmount != null) labels.push(`Au plus ${formatForInput(filter.maxAmount)} €`);
  if (filter.withPhoto) labels.push('Avec photo');
  if (filter.unpointed) labels.push('Non pointées');
  if (filter.counterparty) labels.push(filter.counterparty);
  return labels.filter(Boolean);
}
