// Outils communs aux tests unitaires : fabriquer un état, appliquer un plan, lire les soldes.
import assert from 'node:assert/strict';
import { emptyState, makeOperation, makeEnvelope, makeTag, KIND } from '../../www/js/core/schema.js';
import { apply, cloneState } from '../../www/js/core/changeset.js';
import { computeBalances } from '../../www/js/core/balances.js';

export const TODAY = '2026-11-15';

export function stateWith({ operations = [], envelopes = [], tags = [], recurring = [] } = {}) {
  const state = emptyState();
  state.envelopes = envelopes.map((e) => makeEnvelope(e));
  state.tags = tags.map((t) => makeTag(t));
  state.operations = operations.map((o) => makeOperation(o));
  state.recurring = recurring;
  return state;
}

/** Valide un plan réussi et renvoie le nouvel état (l'état d'origine n'est pas modifié). */
export function commit(state, plan) {
  assert.equal(plan.ok, true, `plan refusé : ${JSON.stringify(plan.errors)}`);
  return apply(cloneState(state), plan.cs);
}

export function balances(state, options = { upTo: TODAY }) {
  const b = computeBalances(state, options);
  return { available: b.available, total: b.total, envelopes: Object.fromEntries(b.envelopes) };
}

export const op = (fields) => ({ kind: KIND.OPERATION, date: TODAY, ...fields });
export const transfer = (from, to, amount, fields = {}) => ({ kind: KIND.TRANSFER, from, to, amount, date: TODAY, ...fields });
