// Calcul des soldes. Vocabulaire :
//  - « Compte courant » : l'argent disponible, qui n'est rangé dans aucune enveloppe.
//  - « Solde total »    : compte courant + contenu de toutes les enveloppes. C'est ce total que
//                          connaît la banque (elle ignore les enveloppes, internes à l'appli).
// Un virement interne déplace de l'argent entre le compte courant et une enveloppe (ou entre deux
// enveloppes) : il ne change jamais le solde total.

import { KIND } from './schema.js';

/** Effet (en centimes, signé) d'une opération sur le compte courant. */
export function availableDelta(op) {
  if (op.kind === KIND.TRANSFER) {
    if (op.from === null && op.to !== null) return -op.amount;
    if (op.to === null && op.from !== null) return op.amount;
    return 0;
  }
  return op.envelopeId ? 0 : op.amount;
}

/** Effet (en centimes, signé) d'une opération sur une enveloppe donnée. */
export function envelopeDelta(op, envelopeId) {
  if (op.kind === KIND.TRANSFER) {
    let delta = 0;
    if (op.to === envelopeId) delta += op.amount;
    if (op.from === envelopeId) delta -= op.amount;
    return delta;
  }
  return op.envelopeId === envelopeId ? op.amount : 0;
}

/** Effet sur le solde total (0 pour un virement interne). */
export function totalDelta(op) {
  return op.kind === KIND.TRANSFER ? 0 : op.amount;
}

export function touchesAvailable(op) {
  if (op.kind === KIND.TRANSFER) return op.from === null || op.to === null;
  return !op.envelopeId;
}

export function touchesEnvelope(op, envelopeId) {
  if (op.kind === KIND.TRANSFER) return op.from === envelopeId || op.to === envelopeId;
  return op.envelopeId === envelopeId;
}

/**
 * L'opération compte-t-elle dans un solde ?
 *  - upTo        : date limite incluse (null = pas de limite).
 *  - simulations : 'none' (réel seulement — défaut), 'checked' (réel + simulations cochées), 'all'.
 */
export function isCounted(op, { upTo = null, simulations = 'none' } = {}) {
  if (upTo && op.date > upTo) return false;
  if (!op.simulated) return true;
  if (simulations === 'all') return true;
  return simulations === 'checked' && op.checked;
}

/**
 * Tous les soldes en un seul passage.
 * Renvoie { available, envelopes: Map(idEnveloppe → centimes), envelopesTotal, total }.
 */
export function computeBalances(state, options = {}) {
  const envelopes = new Map(state.envelopes.map((e) => [e.id, 0]));
  let available = 0;
  for (const op of state.operations) {
    if (!isCounted(op, options)) continue;
    if (op.kind === KIND.TRANSFER) {
      if (op.from === null) available -= op.amount;
      else if (envelopes.has(op.from)) envelopes.set(op.from, envelopes.get(op.from) - op.amount);
      if (op.to === null) available += op.amount;
      else if (envelopes.has(op.to)) envelopes.set(op.to, envelopes.get(op.to) + op.amount);
    } else if (op.envelopeId && envelopes.has(op.envelopeId)) {
      envelopes.set(op.envelopeId, envelopes.get(op.envelopeId) + op.amount);
    } else {
      available += op.amount;
    }
  }
  let envelopesTotal = 0;
  for (const v of envelopes.values()) envelopesTotal += v;
  return { available, envelopes, envelopesTotal, total: available + envelopesTotal };
}

export function envelopeBalance(state, envelopeId, options = {}) {
  let balance = 0;
  for (const op of state.operations) {
    if (isCounted(op, options)) balance += envelopeDelta(op, envelopeId);
  }
  return balance;
}

/**
 * Point le plus bas que le solde RÉEL d'une enveloppe atteindra à partir de `fromDate`
 * (opérations réelles déjà datées dans le futur comprises). C'est ce point bas qui ne doit jamais
 * passer sous zéro : « une enveloppe ne peut pas être en négatif ».
 * Les mouvements d'une même journée sont regroupés (l'ordre dans la journée n'a pas de sens).
 */
export function envelopeLowPoint(state, envelopeId, fromDate) {
  let base = 0;
  const later = new Map();
  for (const op of state.operations) {
    if (op.simulated) continue;
    const delta = envelopeDelta(op, envelopeId);
    if (!delta) continue;
    if (op.date <= fromDate) base += delta;
    else later.set(op.date, (later.get(op.date) || 0) + delta);
  }
  let low = base;
  let running = base;
  for (const date of [...later.keys()].sort()) {
    running += later.get(date);
    if (running < low) low = running;
  }
  return low;
}

/**
 * Compare deux états et renvoie les enveloppes dont le point bas réel devient négatif (ou plus
 * négatif qu'avant) : [{ envelopeId, shortfall }] où shortfall est le montant manquant (positif).
 */
export function findEnvelopeShortfalls(before, after, today) {
  const out = [];
  const existedBefore = new Set(before.envelopes.map((e) => e.id));
  for (const env of after.envelopes) {
    const lowAfter = envelopeLowPoint(after, env.id, today);
    if (lowAfter >= 0) continue;
    const lowBefore = existedBefore.has(env.id) ? envelopeLowPoint(before, env.id, today) : 0;
    if (lowAfter < lowBefore) out.push({ envelopeId: env.id, shortfall: -lowAfter });
  }
  return out;
}

/** Montant qu'on peut encore sortir d'une enveloppe à une date donnée sans jamais la rendre négative. */
export function envelopeSpendable(state, envelopeId, date, today) {
  return Math.max(0, envelopeLowPoint(state, envelopeId, date > today ? date : today));
}

/** Montant affiché d'une opération selon le point de vue : null = compte courant, sinon id d'enveloppe. */
export function deltaFor(op, perspective) {
  return perspective === null ? availableDelta(op) : envelopeDelta(op, perspective);
}

/**
 * Projection du compte courant d'aujourd'hui jusqu'à `upTo` : opérations réelles déjà datées dans
 * le futur + simulations cochées.
 * Renvoie { start, end, totalEnd, low: { date, amount } } où `low` est le point le plus bas atteint
 * en fin de journée sur la période (aujourd'hui compris).
 */
export function projectAvailable(state, { today, upTo }) {
  const options = { simulations: 'checked' };
  const startBalances = computeBalances(state, { ...options, upTo: today });
  const byDay = new Map();
  for (const op of state.operations) {
    if (op.date <= today || op.date > upTo) continue;
    if (op.simulated && !op.checked) continue;
    const delta = availableDelta(op);
    if (delta) byDay.set(op.date, (byDay.get(op.date) || 0) + delta);
  }
  let running = startBalances.available;
  let low = { date: today, amount: running };
  for (const date of [...byDay.keys()].sort()) {
    running += byDay.get(date);
    if (running < low.amount) low = { date, amount: running };
  }
  const endBalances = upTo > today ? computeBalances(state, { ...options, upTo }) : startBalances;
  return { start: startBalances.available, end: endBalances.available, totalEnd: endBalances.total, low };
}
