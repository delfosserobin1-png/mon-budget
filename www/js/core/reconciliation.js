// Rapprochement avec la banque.
//
// La banque ne connaît pas les enveloppes : on compare donc toujours son solde au SOLDE TOTAL de
// l'appli (compte courant + enveloppes), sur les opérations réelles uniquement.
// Une opération pointée sur un relevé porte la date à laquelle la banque l'a comptée (`bank.date`) :
// c'est cette date qui sert ici, pour retrouver exactement le solde imprimé sur le relevé même
// quand un paiement par carte est débité quelques jours après l'achat.

import { Draft } from './changeset.js';
import { KIND, makeOperation, makeReconciliation } from './schema.js';
import { isValidISO } from './dates.js';

const err = (field, message, code = 'invalid') => ({ field, message, code });

/** Date à laquelle la banque a compté (ou comptera) l'opération. */
export function bankDate(op) {
  return op.bank?.date || op.date;
}

/** Solde total « vu de la banque » à une date (incluse). */
export function bankBalanceAt(state, date) {
  let total = 0;
  for (const op of state.operations) {
    if (op.simulated || op.kind === KIND.TRANSFER) continue;
    if (bankDate(op) <= date) total += op.amount;
  }
  return total;
}

/** Enregistre un constat : solde réel lu sur le relevé, solde calculé par l'appli, écart. */
export function planReconciliation(state, { date, realBalance, statementId = null }) {
  const errors = [];
  if (!isValidISO(date)) errors.push(err('date', 'Indique la date du constat.'));
  if (!Number.isInteger(realBalance)) errors.push(err('realBalance', 'Indique le solde affiché par ta banque.'));
  if (errors.length) return { ok: false, errors };
  const record = makeReconciliation({ date, realBalance, computedBalance: bankBalanceAt(state, date), statementId });
  const draft = new Draft(state);
  draft.put('reconciliations', record);
  return { ok: true, cs: draft.cs, record };
}

/** Crée l'opération d'ajustement qui absorbe l'écart d'un constat (sur le compte courant). */
export function planAdjustment(state, reconciliationId) {
  const rec = state.reconciliations.find((r) => r.id === reconciliationId);
  if (!rec) return { ok: false, errors: [err('id', "Ce constat n'existe plus.", 'missing')] };
  if (rec.adjustmentOperationId && state.operations.some((o) => o.id === rec.adjustmentOperationId)) {
    return { ok: false, errors: [err('id', 'Cet écart a déjà été ajusté.', 'already')] };
  }
  if (rec.gap === 0) return { ok: false, errors: [err('id', "Il n'y a aucun écart à ajuster.", 'no-gap')] };
  const op = makeOperation({ kind: KIND.ADJUSTMENT, date: rec.date, amount: rec.gap, label: 'Ajustement de rapprochement' });
  const draft = new Draft(state);
  draft.put('operations', op);
  draft.put('reconciliations', { ...rec, adjustmentOperationId: op.id });
  return { ok: true, cs: draft.cs, op };
}

/** Supprime un constat (l'éventuelle opération d'ajustement reste : elle se supprime depuis les opérations). */
export function planDeleteReconciliation(state, id) {
  if (!state.reconciliations.some((r) => r.id === id)) return { ok: false, errors: [err('id', "Ce constat n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  draft.del('reconciliations', id);
  return { ok: true, cs: draft.cs };
}

/** Solde de départ : première mise en route de l'appli, ou écart antérieur à un relevé. */
export function planOpeningBalance(state, { date, amount, label = 'Solde de départ' }) {
  const errors = [];
  if (!isValidISO(date)) errors.push(err('date', 'Indique une date valide.'));
  if (!Number.isInteger(amount)) errors.push(err('amount', 'Indique le solde de ton compte.'));
  if (errors.length) return { ok: false, errors };
  const draft = new Draft(state);
  // Un seul solde de départ : s'il en existe déjà un, on le remplace.
  for (const old of state.operations) if (old.auto === 'opening') draft.del('operations', old.id);
  const op = makeOperation({ kind: KIND.ADJUSTMENT, date, amount, label, auto: 'opening' });
  draft.put('operations', op);
  return { ok: true, cs: draft.cs, op };
}

/** Le solde de départ enregistré, s'il existe. */
export function openingOperation(state) {
  return state.operations.find((op) => op.auto === 'opening' && !op.simulated) || null;
}

/** Modifie un ajustement existant (date, montant, libellé, commentaire). */
export function planSaveAdjustment(state, input) {
  const existing = state.operations.find((o) => o.id === input.id);
  if (!existing || existing.kind !== KIND.ADJUSTMENT) return { ok: false, errors: [err('id', "Cet ajustement n'existe plus.", 'missing')] };
  const errors = [];
  if (!isValidISO(input.date)) errors.push(err('date', 'Indique une date valide.'));
  if (!Number.isInteger(input.amount) || input.amount === 0) errors.push(err('amount', 'Indique un montant différent de zéro.'));
  if (errors.length) return { ok: false, errors };
  const op = makeOperation({ ...existing, date: input.date, amount: input.amount, label: input.label ?? existing.label, comment: input.comment ?? existing.comment, updatedAt: new Date().toISOString() });
  const draft = new Draft(state);
  draft.put('operations', op);
  return { ok: true, cs: draft.cs, op };
}
