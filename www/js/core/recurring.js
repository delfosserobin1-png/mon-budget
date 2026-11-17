// Récurrences : abonnements, salaires, loyers… ou virements automatiques vers une enveloppe.
//
// Principe :
//  - Une règle produit une échéance par période. Les échéances sont calculées à partir de la date
//    de départ (« la k-ième échéance »), jamais à partir de l'échéance précédente : une règle du 31
//    donne 31 janv., 28 févr., 31 mars… sans dérive.
//  - Les échéances à venir sont créées à l'avance (jusqu'à un horizon glissant) comme opérations
//    SIMULÉES et cochées : elles comptent dans le solde estimé, pas dans le solde réel.
//  - Le jour venu, une échéance cochée devient réelle toute seule. Une échéance décochée reste en
//    attente : c'est à l'utilisateur de la confirmer ou de la supprimer.
//  - Une dépense récurrente réelle qui mettrait son enveloppe à découvert déclenche un virement de
//    complément automatique ; un virement récurrent sortant d'une enveloppe trop peu garnie est
//    plafonné à ce qu'elle contient.

import { Draft } from './changeset.js';
import { KIND, makeOperation, makeRecurring } from './schema.js';
import { addDays, addMonths, isValidISO } from './dates.js';
import { envelopeLowPoint, findEnvelopeShortfalls } from './balances.js';
import { formatAmount } from './money.js';

export const HORIZON_DAYS = 180;
const MAX_K = 20000;

const err = (field, message, code = 'invalid', data = null) => ({ field, message, code, data });

/** Date de la k-ième échéance d'une règle (k = 0 → date de départ). */
export function occurrenceDate(rule, k) {
  const step = k * rule.interval;
  if (rule.frequency === 'weekly') return addDays(rule.startDate, 7 * step);
  if (rule.frequency === 'yearly') return addMonths(rule.startDate, 12 * step);
  return addMonths(rule.startDate, step);
}

/** Numéro de la première échéance tombant à `date` ou après. */
export function firstKOnOrAfter(rule, date) {
  let k = 0;
  while (k < MAX_K && occurrenceDate(rule, k) < date) k++;
  return k;
}

function withinEnd(rule, date) {
  return !rule.endDate || date <= rule.endDate;
}

/** Prochaine échéance à partir d'une date (pour l'affichage et le tri), ou null si la règle est finie. */
export function nextOccurrence(rule, fromDate) {
  const date = occurrenceDate(rule, firstKOnOrAfter(rule, fromDate));
  return withinEnd(rule, date) ? date : null;
}

function ruleIsUsable(state, rule) {
  if (!rule.active) return false;
  const ids = rule.kind === KIND.TRANSFER ? [rule.from, rule.to] : [rule.envelopeId];
  for (const id of ids) {
    if (id === null) continue;
    const env = state.envelopes.find((e) => e.id === id);
    if (!env || env.closed) return false;
  }
  return true;
}

function occurrenceOperation(rule, date, simulated, checked = true) {
  const common = { date, recurringId: rule.id, simulated, checked, label: rule.label };
  if (rule.kind === KIND.TRANSFER) {
    return makeOperation({ ...common, kind: KIND.TRANSFER, from: rule.from, to: rule.to, amount: rule.amount });
  }
  return makeOperation({
    ...common,
    kind: KIND.OPERATION,
    amount: rule.amount,
    counterparty: rule.counterparty,
    comment: rule.comment,
    importance: rule.importance,
    tags: rule.tags,
    envelopeId: rule.envelopeId,
  });
}

// Ordre de traitement dans une même journée : d'abord l'argent qui arrive dans les enveloppes,
// puis le reste — pour ne pas déclencher de complément inutile.
function rank(op) {
  if (op.kind === KIND.TRANSFER) return op.to !== null && op.from === null ? 0 : 1;
  return op.amount > 0 ? 2 : 3;
}

/** Rend réelle une échéance dans le brouillon, en appliquant les garde-fous des enveloppes. */
function realize(draft, op) {
  let real = { ...op, simulated: false, checked: true };
  if (real.kind === KIND.TRANSFER && real.from !== null) {
    // Ce que l'enveloppe peut céder sans passer en négatif (échéance non comptée : elle est simulée ou absente).
    const available = Math.max(0, envelopeLowPoint(draft.state, real.from, real.date));
    if (available <= 0) {
      draft.del('operations', real.id);
      return;
    }
    if (real.amount > available) real = { ...real, amount: available };
  }
  draft.put('operations', real);
  if (real.kind === KIND.OPERATION && real.envelopeId && real.amount < 0) {
    const low = envelopeLowPoint(draft.state, real.envelopeId, real.date);
    if (low < 0) {
      draft.put(
        'operations',
        makeOperation({ kind: KIND.TRANSFER, from: null, to: real.envelopeId, amount: -low, date: real.date, auto: 'topup', label: 'Complément automatique' }),
      );
    }
  }
}

/**
 * Met les récurrences à jour : crée les échéances manquantes jusqu'à l'horizon et rend réelles
 * celles dont la date est arrivée. À appeler au démarrage de l'appli, après toute modification d'une
 * règle, et avant d'afficher une projection (avec `upTo` = date de la projection).
 * Travaille dans un brouillon existant (pour s'enchaîner avec d'autres modifications).
 */
export function tickInto(draft, { today, upTo = null }) {
  let horizon = addDays(today, HORIZON_DAYS);
  if (upTo && upTo > horizon) horizon = upTo;

  // 1. Nouvelles échéances à créer
  const created = [];
  for (const rule of draft.state.recurring.slice()) {
    if (!ruleIsUsable(draft.state, rule)) continue;
    let k = rule.nextK;
    while (k < MAX_K) {
      const date = occurrenceDate(rule, k);
      if (date > horizon || !withinEnd(rule, date)) break;
      created.push(occurrenceOperation(rule, date, date > today));
      k++;
    }
    if (k !== rule.nextK) draft.put('recurring', { ...rule, nextK: k });
  }
  for (const op of created) if (op.simulated) draft.put('operations', op);

  // 2. Échéances à rendre réelles : celles créées directement dans le passé + les simulations
  //    cochées dont la date est arrivée — dans l'ordre chronologique.
  const due = created.filter((op) => !op.simulated);
  for (const op of draft.state.operations) {
    if (op.recurringId && op.simulated && op.checked && op.date <= today) due.push(op);
  }
  due.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b)));
  for (const op of due) realize(draft, op);
  return draft;
}

export function tick(state, options) {
  return tickInto(new Draft(state), options).cs;
}

function lastRealDate(state, ruleId) {
  let last = null;
  for (const op of state.operations) {
    if (op.recurringId === ruleId && !op.simulated && (!last || op.date > last)) last = op.date;
  }
  return last;
}

/** Première échéance à générer après une modification ou une reprise : à partir d'aujourd'hui, sans doublon. */
function resumeK(state, rule, today) {
  const last = lastRealDate(state, rule.id);
  let k = firstKOnOrAfter(rule, today);
  while (k < MAX_K && last && occurrenceDate(rule, k) <= last) k++;
  return k;
}

function validateRule(state, rule, existing) {
  const errors = [];
  if (!rule.label) errors.push(err('label', 'Donne un nom à cette récurrence.'));
  if (!isValidISO(rule.startDate) || rule.startDate === '1970-01-01') errors.push(err('startDate', 'Indique la date de la première échéance.'));
  if (rule.endDate && rule.endDate < rule.startDate) errors.push(err('endDate', 'La date de fin est avant la première échéance.'));
  if (rule.kind === KIND.TRANSFER) {
    if (rule.amount <= 0) errors.push(err('amount', 'Indique un montant supérieur à zéro.'));
    if (rule.from === rule.to) errors.push(err('to', 'Choisis deux comptes différents.'));
  } else if (rule.amount === 0) {
    errors.push(err('amount', 'Indique un montant supérieur à zéro.'));
  }
  const refs = rule.kind === KIND.TRANSFER ? [['from', rule.from], ['to', rule.to]] : [['envelopeId', rule.envelopeId]];
  for (const [field, id] of refs) {
    if (id === null) continue;
    const env = state.envelopes.find((e) => e.id === id);
    if (!env) errors.push(err(field, "Cette enveloppe n'existe plus.", 'missing-envelope'));
    else if (env.closed && existing?.[field] !== id) errors.push(err(field, `« ${env.name} » est clôturée.`, 'closed-envelope'));
  }
  if (rule.kind === KIND.OPERATION && rule.envelopeId && rule.amount > 0) {
    errors.push(err('envelopeId', "Une enveloppe ne reçoit de l'argent que par virement : choisis le type « Virement ».", 'credit-in-envelope'));
  }
  return errors;
}

/** Nombre d'échéances passées qu'une nouvelle règle créerait si on reconstitue l'historique. */
export function countBackfill(input, today) {
  const rule = makeRecurring(input);
  if (!isValidISO(rule.startDate) || rule.startDate >= today) return 0;
  let n = 0;
  for (let k = 0; k < MAX_K; k++) {
    const date = occurrenceDate(rule, k);
    if (date >= today || !withinEnd(rule, date)) break;
    n++;
  }
  return n;
}

/**
 * Crée ou modifie une règle de récurrence.
 * backfill (création seulement) : true = recrée aussi les échéances passées depuis la date de
 * départ ; false = commence à la prochaine échéance.
 * Une modification ne touche jamais l'historique réel : seules les échéances à venir sont recalculées.
 */
export function planSaveRecurring(state, input, { today, backfill = true }) {
  const existing = input.id ? state.recurring.find((r) => r.id === input.id) : null;
  if (input.id && !existing) return { ok: false, errors: [err('id', "Cette récurrence n'existe plus.", 'missing')] };
  const knownTags = new Set(state.tags.map((t) => t.id));
  let rule = makeRecurring({ ...(existing || {}), ...input });
  rule = { ...rule, tags: rule.tags.filter((id) => knownTags.has(id)) };
  const errors = validateRule(state, rule, existing);
  if (errors.length) return { ok: false, errors };

  const draft = new Draft(state);
  if (existing) {
    // On retire les échéances pas encore réelles (en mémorisant celles que l'utilisateur avait décochées).
    const unchecked = new Set();
    for (const op of state.operations) {
      if (op.recurringId === rule.id && op.simulated) {
        if (!op.checked) unchecked.add(op.date);
        draft.del('operations', op.id);
      }
    }
    rule = { ...rule, nextK: resumeK(draft.state, rule, today), pausedBy: rule.active ? null : rule.pausedBy ?? null };
    draft.put('recurring', rule);
    tickInto(draft, { today });
    for (const op of draft.state.operations.slice()) {
      if (op.recurringId === rule.id && op.simulated && unchecked.has(op.date)) draft.put('operations', { ...op, checked: false });
    }
  } else {
    rule = { ...rule, nextK: backfill ? 0 : firstKOnOrAfter(rule, today) };
    draft.put('recurring', rule);
    tickInto(draft, { today });
  }
  return { ok: true, cs: draft.cs, rule: draft.get('recurring', rule.id) };
}

/**
 * Supprime une règle.
 * mode 'future' : garde l'historique réel (détaché de la règle), retire les échéances à venir.
 * mode 'all'    : retire aussi toutes les opérations réelles que la règle avait créées.
 */
export function planDeleteRecurring(state, id, mode, { today }) {
  const rule = state.recurring.find((r) => r.id === id);
  if (!rule) return { ok: false, errors: [err('id', "Cette récurrence n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  let removedReal = 0;
  for (const op of state.operations) {
    if (op.recurringId !== id) continue;
    if (op.simulated) draft.del('operations', op.id);
    else if (mode === 'all') {
      draft.del('operations', op.id);
      removedReal++;
    } else draft.put('operations', { ...op, recurringId: null });
  }
  draft.del('recurring', id);
  const shortfalls = findEnvelopeShortfalls(state, draft.state, today);
  if (shortfalls.length) {
    const names = shortfalls.map((s) => `« ${state.envelopes.find((e) => e.id === s.envelopeId)?.name} » (${formatAmount(s.shortfall)})`).join(', ');
    return {
      ok: false,
      errors: [err('id', `Supprimer l'historique mettrait à découvert : ${names}. Supprime seulement les échéances à venir, ou vide d'abord ces enveloppes.`, 'insufficient')],
    };
  }
  return { ok: true, cs: draft.cs, removedReal };
}

/** Met une règle en pause (les échéances futures disparaissent) ou la relance à partir d'aujourd'hui. */
export function setActiveInto(draft, id, active, { today, pausedBy = null }) {
  const rule = draft.get('recurring', id);
  if (!rule || rule.active === active) return;
  if (!active) {
    for (const op of draft.state.operations.slice()) {
      if (op.recurringId === id && op.simulated && op.date > today) draft.del('operations', op.id);
    }
    draft.put('recurring', { ...rule, active: false, pausedBy });
  } else {
    const resumed = { ...rule, active: true, pausedBy: null };
    draft.put('recurring', { ...resumed, nextK: resumeK(draft.state, resumed, today) });
  }
}

export function planSetRecurringActive(state, id, active, { today }) {
  if (!state.recurring.some((r) => r.id === id)) return { ok: false, errors: [err('id', "Cette récurrence n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  setActiveInto(draft, id, active, { today });
  if (active) tickInto(draft, { today });
  return { ok: true, cs: draft.cs };
}

/** La règle touche-t-elle cette enveloppe (comme dépense ou comme virement) ? */
export function ruleTouchesEnvelope(rule, envelopeId) {
  return rule.envelopeId === envelopeId || rule.from === envelopeId || rule.to === envelopeId;
}
