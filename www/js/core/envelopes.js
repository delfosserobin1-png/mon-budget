// Règles métier des enveloppes : création, objectif, clôture / réouverture, suppression.

import { Draft } from './changeset.js';
import { KIND, makeEnvelope, makeOperation } from './schema.js';
import { envelopeBalance, envelopeDelta, envelopeLowPoint, findEnvelopeShortfalls, touchesEnvelope } from './balances.js';
import { ruleTouchesEnvelope, setActiveInto, tickInto } from './recurring.js';
import { normalize } from './text.js';
import { addMonths, daysBetween, isValidISO, monthKey } from './dates.js';

const err = (field, message, code = 'invalid', data = null) => ({ field, message, code, data });

export function planSaveEnvelope(state, input) {
  const existing = input.id ? state.envelopes.find((e) => e.id === input.id) : null;
  if (input.id && !existing) return { ok: false, errors: [err('id', "Cette enveloppe n'existe plus.", 'missing')] };
  const env = makeEnvelope({ ...(existing || {}), ...input });
  const errors = [];
  if (!env.name) errors.push(err('name', 'Donne un nom à cette enveloppe.'));
  else if (state.envelopes.some((e) => e.id !== env.id && normalize(e.name) === normalize(env.name))) {
    errors.push(err('name', 'Une autre enveloppe porte déjà ce nom.', 'duplicate'));
  }
  if (input.goalAmount != null && input.goalAmount !== '' && (!Number.isInteger(input.goalAmount) || input.goalAmount < 0)) {
    errors.push(err('goalAmount', "L'objectif doit être un montant positif."));
  }
  if (input.goalDate && !isValidISO(input.goalDate)) errors.push(err('goalDate', 'Indique une date valide.'));
  if (errors.length) return { ok: false, errors };
  const draft = new Draft(state);
  draft.put('envelopes', env);
  return { ok: true, cs: draft.cs, envelope: env };
}

/**
 * Clôture une enveloppe (projet terminé). Ses récurrences sont mises en pause ; si `sweep` est vrai,
 * le solde restant est reversé au compte courant le jour même.
 */
export function planCloseEnvelope(state, id, { today, sweep = true }) {
  const env = state.envelopes.find((e) => e.id === id);
  if (!env) return { ok: false, errors: [err('id', "Cette enveloppe n'existe plus.", 'missing')] };
  if (env.closed) return { ok: false, errors: [err('id', 'Cette enveloppe est déjà clôturée.', 'already')] };
  const draft = new Draft(state);
  for (const rule of state.recurring) {
    if (rule.active && ruleTouchesEnvelope(rule, id)) setActiveInto(draft, rule.id, false, { today, pausedBy: id });
  }
  // Ce qu'on peut reverser sans que l'enveloppe passe en négatif plus tard (opérations réelles à venir comprises).
  const balance = Math.max(0, envelopeLowPoint(draft.state, id, today));
  let swept = 0;
  if (sweep && balance > 0) {
    swept = balance;
    draft.put('operations', makeOperation({ kind: KIND.TRANSFER, from: id, to: null, amount: balance, date: today, label: 'Clôture' }));
  }
  draft.put('envelopes', { ...env, closed: true, closedAt: today });
  return { ok: true, cs: draft.cs, swept };
}

/** Rouvre une enveloppe ; les récurrences que la clôture avait mises en pause repartent d'aujourd'hui. */
export function planReopenEnvelope(state, id, { today }) {
  const env = state.envelopes.find((e) => e.id === id);
  if (!env) return { ok: false, errors: [err('id', "Cette enveloppe n'existe plus.", 'missing')] };
  if (!env.closed) return { ok: false, errors: [err('id', "Cette enveloppe n'est pas clôturée.", 'already')] };
  const draft = new Draft(state);
  draft.put('envelopes', { ...env, closed: false, closedAt: null });
  let resumed = 0;
  for (const rule of state.recurring) {
    if (!rule.active && rule.pausedBy === id) {
      setActiveInto(draft, rule.id, true, { today });
      resumed++;
    }
  }
  tickInto(draft, { today });
  return { ok: true, cs: draft.cs, resumed };
}

/**
 * Supprime une enveloppe.
 * mode 'detach' : ses dépenses restent, rattachées au compte courant (le solde total ne bouge pas) ;
 * mode 'purge'  : ses dépenses sont supprimées aussi (le solde total change).
 * Dans les deux cas les virements avec le compte courant disparaissent (ils n'ont plus de sens) et
 * les virements avec une autre enveloppe deviennent des virements compte courant ↔ cette autre enveloppe.
 */
export function planDeleteEnvelope(state, id, mode, { today }) {
  const env = state.envelopes.find((e) => e.id === id);
  if (!env) return { ok: false, errors: [err('id', "Cette enveloppe n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  const stamp = new Date().toISOString();
  for (const op of state.operations) {
    if (!touchesEnvelope(op, id)) continue;
    if (op.kind === KIND.TRANSFER) {
      const other = op.from === id ? op.to : op.from;
      if (other === null) draft.del('operations', op.id);
      else draft.put('operations', { ...op, from: op.from === id ? null : op.from, to: op.to === id ? null : op.to, updatedAt: stamp });
    } else if (mode === 'purge') {
      draft.del('operations', op.id);
    } else {
      draft.put('operations', { ...op, envelopeId: null, updatedAt: stamp });
    }
  }
  for (const rule of state.recurring) {
    if (!ruleTouchesEnvelope(rule, id)) continue;
    if (rule.kind === KIND.TRANSFER) {
      const other = rule.from === id ? rule.to : rule.from;
      if (other === null) draft.del('recurring', rule.id);
      else draft.put('recurring', { ...rule, from: rule.from === id ? null : rule.from, to: rule.to === id ? null : rule.to });
    } else if (mode === 'purge') {
      draft.del('recurring', rule.id);
    } else {
      draft.put('recurring', { ...rule, envelopeId: null });
    }
  }
  for (const rule of state.rules) {
    if (rule.envelopeId === id) draft.put('rules', { ...rule, envelopeId: null });
  }
  draft.del('envelopes', id);
  const shortfalls = findEnvelopeShortfalls(state, draft.state, today);
  if (shortfalls.length) {
    return { ok: false, errors: [err('id', 'Cette suppression mettrait une autre enveloppe à découvert.', 'insufficient', shortfalls)] };
  }
  return { ok: true, cs: draft.cs };
}

/** Combien d'opérations et de virements touchent cette enveloppe (pour les messages de confirmation). */
export function envelopeUsage(state, id) {
  let operations = 0;
  let transfers = 0;
  for (const op of state.operations) {
    if (!touchesEnvelope(op, id)) continue;
    if (op.kind === KIND.TRANSFER) transfers++;
    else operations++;
  }
  const rules = state.recurring.filter((r) => ruleTouchesEnvelope(r, id)).length;
  return { operations, transfers, rules };
}

/**
 * Bilan d'une enveloppe sur une période (ou depuis toujours) : reçu, dépensé, rythme, objectif.
 * Ne compte que le réel jusqu'à `today`.
 */
export function envelopeReport(state, id, { today, from = null, to = null } = {}) {
  const env = state.envelopes.find((e) => e.id === id);
  const upper = to && to < today ? to : today;
  let received = 0;
  let sentBack = 0;
  let spent = 0;
  let refunded = 0;
  let count = 0;
  let firstDate = null;
  let lastDate = null;
  const byTag = new Map();
  const month = monthKey(today);
  let spentThisMonth = 0;
  let receivedThisMonth = 0;
  for (const op of state.operations) {
    if (op.simulated || op.date > today) continue;
    const delta = envelopeDelta(op, id);
    if (!delta) continue;
    if (monthKey(op.date) === month) {
      if (op.kind === KIND.TRANSFER && delta > 0) receivedThisMonth += delta;
      if (op.kind !== KIND.TRANSFER && delta < 0) spentThisMonth += -delta;
    }
    if ((from && op.date < from) || op.date > upper) continue;
    count++;
    if (!firstDate || op.date < firstDate) firstDate = op.date;
    if (!lastDate || op.date > lastDate) lastDate = op.date;
    if (op.kind === KIND.TRANSFER) {
      if (delta > 0) received += delta;
      else sentBack += -delta;
    } else if (delta < 0) {
      spent += -delta;
      const keys = op.tags.length ? op.tags : ['—'];
      for (const k of keys) byTag.set(k, (byTag.get(k) || 0) + -delta);
    } else {
      refunded += delta;
    }
  }
  const balance = envelopeBalance(state, id, { upTo: today });
  const report = { received, sentBack, spent, refunded, count, firstDate, lastDate, balance, spentThisMonth, receivedThisMonth, byTag };
  if (env?.goalAmount) {
    const missing = Math.max(0, env.goalAmount - balance);
    report.goal = { amount: env.goalAmount, date: env.goalDate, missing, progress: Math.min(1, Math.max(0, balance / env.goalAmount)) };
    if (env.goalDate && missing > 0 && env.goalDate > today) {
      // Nombre de mois restants (au moins 1) → effort mensuel pour atteindre l'objectif à temps.
      let months = 0;
      while (addMonths(today, months + 1) <= env.goalDate && months < 1200) months++;
      report.goal.perMonth = Math.ceil(missing / Math.max(1, months));
      report.goal.daysLeft = daysBetween(today, env.goalDate);
    }
  }
  return report;
}
