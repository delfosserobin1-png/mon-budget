import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateWith, commit, balances, op, transfer, TODAY } from './helpers.js';
import { apply, cloneState, isEmpty } from '../../www/js/core/changeset.js';
import { KIND, makeRecurring } from '../../www/js/core/schema.js';
import { computeBalances } from '../../www/js/core/balances.js';
import { planSetChecked } from '../../www/js/core/operations.js';
import { planCloseEnvelope, planReopenEnvelope } from '../../www/js/core/envelopes.js';
import {
  occurrenceDate, firstKOnOrAfter, nextOccurrence, tick, planSaveRecurring, planDeleteRecurring,
  planSetRecurringActive, countBackfill, HORIZON_DAYS,
} from '../../www/js/core/recurring.js';
import { addDays } from '../../www/js/core/dates.js';

const ctx = { today: TODAY }; // 2026-11-15
const ENV = { id: 'env_a', name: 'Vacances' };
const occurrences = (state, ruleId) => state.operations.filter((o) => o.recurringId === ruleId).sort((a, b) => a.date.localeCompare(b.date));
const runTick = (state, options) => apply(cloneState(state), tick(state, options));
/** Crée une règle et renvoie [nouvel état, id de la règle]. */
function createRule(state, input, options = ctx) {
  const plan = planSaveRecurring(state, input, options);
  return [commit(state, plan), plan.rule.id];
}

test('échéances : une règle mensuelle du 31 ne dérive jamais', () => {
  const rule = makeRecurring({ label: 'Loyer', amount: -30000, frequency: 'monthly', startDate: '2026-01-31' });
  const dates = Array.from({ length: 14 }, (_, k) => occurrenceDate(rule, k));
  assert.deepEqual(dates.slice(0, 6), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  assert.equal(dates[13], '2027-02-28');
  assert.equal(firstKOnOrAfter(rule, '2026-03-01'), 2);
  assert.equal(nextOccurrence(rule, '2026-03-01'), '2026-03-31');
});

test('échéances : intervalles (toutes les 2 semaines, tous les 3 mois, 29 février annuel)', () => {
  const biweekly = makeRecurring({ label: 'x', amount: -1, frequency: 'weekly', interval: 2, startDate: '2026-11-02' });
  assert.deepEqual([0, 1, 2].map((k) => occurrenceDate(biweekly, k)), ['2026-11-02', '2026-11-16', '2026-11-30']);
  const quarterly = makeRecurring({ label: 'x', amount: -1, frequency: 'monthly', interval: 3, startDate: '2026-11-30' });
  assert.deepEqual([0, 1, 2].map((k) => occurrenceDate(quarterly, k)), ['2026-11-30', '2027-02-28', '2027-05-30']);
  const leap = makeRecurring({ label: 'x', amount: -1, frequency: 'yearly', startDate: '2028-02-29' });
  assert.deepEqual([0, 1, 4].map((k) => occurrenceDate(leap, k)), ['2028-02-29', '2029-02-28', '2032-02-29']);
});

test('création dans le futur : uniquement des échéances simulées et cochées, jusqu\'à l\'horizon', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Abonnement', amount: -999, frequency: 'monthly', startDate: '2026-12-05' }, ctx);
  state = commit(state, plan);
  const occ = occurrences(state, plan.rule.id);
  assert.ok(occ.length >= 5 && occ.length <= 6);
  assert.ok(occ.every((o) => o.simulated && o.checked && o.amount === -999 && o.label === 'Abonnement'));
  assert.equal(occ[0].date, '2026-12-05');
  assert.ok(occ.at(-1).date <= addDays(TODAY, HORIZON_DAYS));
  assert.equal(balances(state).available, 0);
});

test('création dans le passé : l\'historique devient réel, le futur reste simulé, sans doublon', () => {
  let state = stateWith();
  const input = { label: 'Salaire', amount: 220000, frequency: 'monthly', startDate: '2026-08-30' };
  assert.equal(countBackfill(input, TODAY), 3);
  const plan = planSaveRecurring(state, input, ctx);
  state = commit(state, plan);
  const occ = occurrences(state, plan.rule.id);
  assert.deepEqual(occ.filter((o) => !o.simulated).map((o) => o.date), ['2026-08-30', '2026-09-30', '2026-10-30']);
  assert.equal(occ.find((o) => o.simulated).date, '2026-11-30');
  assert.equal(balances(state).available, 660000);
  // Un second passage le même jour ne crée rien
  assert.equal(isEmpty(tick(state, ctx)), true);
  assert.equal(new Set(occ.map((o) => o.date)).size, occ.length);
});

test('création dans le passé sans reconstituer l\'historique', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Salaire', amount: 220000, frequency: 'monthly', startDate: '2026-08-30' }, { today: TODAY, backfill: false });
  state = commit(state, plan);
  const occ = occurrences(state, plan.rule.id);
  assert.equal(occ[0].date, '2026-11-30');
  assert.ok(occ.every((o) => o.simulated));
});

test('une échéance datée d\'aujourd\'hui est réelle tout de suite', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Loyer', amount: -30000, frequency: 'monthly', startDate: TODAY }, ctx);
  state = commit(state, plan);
  const occ = occurrences(state, plan.rule.id);
  assert.equal(occ[0].date, TODAY);
  assert.equal(occ[0].simulated, false);
  assert.equal(balances(state).available, -30000);
});

test('le jour venu : une échéance cochée devient réelle, une décochée reste en attente', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Abonnement', amount: -1000, frequency: 'weekly', startDate: '2026-11-18' }, ctx);
  state = commit(state, plan);
  const second = occurrences(state, plan.rule.id)[1];
  assert.equal(second.date, '2026-11-25');
  state = commit(state, planSetChecked(state, [second.id], false));
  state = runTick(state, { today: '2026-11-26' });
  const occ = occurrences(state, plan.rule.id);
  assert.equal(occ[0].simulated, false);
  assert.equal(occ[1].simulated, true, 'décochée : elle attend une confirmation');
  assert.equal(occ[1].checked, false);
  assert.equal(computeBalances(state, { upTo: '2026-11-26' }).available, -1000);
});

test('rattrapage : si l\'appli n\'a pas été ouverte pendant deux mois, les échéances cochées sont toutes passées en réel', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Loyer', amount: -30000, frequency: 'monthly', startDate: '2026-12-03' }, ctx);
  state = commit(state, plan);
  state = runTick(state, { today: '2027-02-10' });
  const real = occurrences(state, plan.rule.id).filter((o) => !o.simulated).map((o) => o.date);
  assert.deepEqual(real, ['2026-12-03', '2027-01-03', '2027-02-03']);
  // et l'horizon a avancé d'autant
  assert.ok(occurrences(state, plan.rule.id).at(-1).date > '2027-07-01');
});

test('dépense récurrente d\'enveloppe : complément automatique seulement quand elle devient réelle', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 }), transfer(null, 'env_a', 5000)] });
  const plan = planSaveRecurring(state, { label: 'Forfait', amount: -8000, frequency: 'monthly', startDate: '2026-11-20', envelopeId: 'env_a' }, ctx);
  state = commit(state, plan);
  assert.equal(state.operations.filter((o) => o.auto === 'topup').length, 0, 'pas de complément tant que c\'est simulé');
  state = runTick(state, { today: '2026-11-20' });
  const topups = state.operations.filter((o) => o.auto === 'topup');
  assert.equal(topups.length, 1);
  assert.equal(topups[0].amount, 3000);
  assert.deepEqual(balances(state, { upTo: '2026-11-20' }), { available: 92000, total: 92000, envelopes: { env_a: 0 } });
});

test('virement récurrent sortant d\'une enveloppe : plafonné à ce qu\'elle contient', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 }), transfer(null, 'env_a', 3000)] });
  const plan = planSaveRecurring(state, { kind: KIND.TRANSFER, label: 'Retour', amount: 10000, from: 'env_a', to: null, frequency: 'monthly', startDate: '2026-11-20' }, ctx);
  state = commit(state, plan);
  state = runTick(state, { today: '2026-12-21' });
  const real = occurrences(state, plan.rule.id).filter((o) => !o.simulated);
  assert.deepEqual(real.map((o) => [o.date, o.amount]), [['2026-11-20', 3000]], 'la 2e échéance, sans rien à virer, est abandonnée');
  assert.equal(balances(state, { upTo: '2026-12-21' }).envelopes.env_a, 0);
});

test('virement récurrent entrant et dépense récurrente le même jour : pas de complément inutile', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 })] });
  const tr = planSaveRecurring(state, { kind: KIND.TRANSFER, label: 'Épargne', amount: 5000, from: null, to: 'env_a', frequency: 'monthly', startDate: '2026-11-20' }, ctx);
  state = commit(state, tr);
  const ex = planSaveRecurring(state, { label: 'Forfait', amount: -5000, frequency: 'monthly', startDate: '2026-11-20', envelopeId: 'env_a' }, ctx);
  state = commit(state, ex);
  state = runTick(state, { today: '2026-11-20' });
  assert.equal(state.operations.filter((o) => o.auto === 'topup').length, 0);
  assert.equal(balances(state, { upTo: '2026-11-20' }).envelopes.env_a, 0);
});

test('modifier une règle : l\'historique réel ne bouge pas, le futur est recalculé, les décochées restent décochées', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Abonnement', amount: -1000, frequency: 'monthly', startDate: '2026-09-10' }, ctx);
  state = commit(state, plan);
  const before = occurrences(state, plan.rule.id);
  const future = before.filter((o) => o.simulated);
  state = commit(state, planSetChecked(state, [future[1].id], false));
  const edited = planSaveRecurring(state, { id: plan.rule.id, amount: -1500, label: 'Abonnement +' }, ctx);
  state = commit(state, edited);
  const after = occurrences(state, plan.rule.id);
  assert.deepEqual(after.filter((o) => !o.simulated).map((o) => [o.date, o.amount, o.label]), [
    ['2026-09-10', -1000, 'Abonnement'], ['2026-10-10', -1000, 'Abonnement'], ['2026-11-10', -1000, 'Abonnement'],
  ]);
  const newFuture = after.filter((o) => o.simulated);
  assert.deepEqual(newFuture.map((o) => o.date), future.map((o) => o.date));
  assert.ok(newFuture.every((o) => o.amount === -1500 && o.label === 'Abonnement +'));
  assert.equal(newFuture[1].checked, false);
  assert.equal(newFuture[0].checked, true);
});

test('modifier une règle le jour d\'une échéance déjà réelle ne la recrée pas', () => {
  let state = stateWith();
  const plan = planSaveRecurring(state, { label: 'Loyer', amount: -30000, frequency: 'monthly', startDate: TODAY }, ctx);
  state = commit(state, plan);
  state = commit(state, planSaveRecurring(state, { id: plan.rule.id, amount: -31000 }, ctx));
  const occ = occurrences(state, plan.rule.id);
  assert.equal(occ.filter((o) => o.date === TODAY).length, 1);
  assert.equal(occ[0].amount, -30000);
  assert.equal(occ[1].amount, -31000);
});

test('supprimer une règle : seulement le futur, ou tout l\'historique', () => {
  const [base, id] = createRule(stateWith(), { label: 'Abo', amount: -1000, frequency: 'monthly', startDate: '2026-09-10' });
  const futureOnly = commit(base, planDeleteRecurring(base, id, 'future', ctx));
  assert.equal(futureOnly.recurring.length, 0);
  assert.equal(futureOnly.operations.length, 3);
  assert.ok(futureOnly.operations.every((o) => !o.simulated && o.recurringId === null));
  const all = planDeleteRecurring(base, id, 'all', ctx);
  assert.equal(all.removedReal, 3);
  assert.equal(commit(base, all).operations.length, 0);
});

test('supprimer tout l\'historique est refusé si une enveloppe se retrouverait à découvert', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000, date: '2026-08-01' })] });
  let id;
  [state, id] = createRule(state, { kind: KIND.TRANSFER, label: 'Épargne', amount: 5000, from: null, to: 'env_a', frequency: 'monthly', startDate: '2026-09-01' });
  state = apply(state, { put: { operations: [...stateWith({ operations: [op({ amount: -12000, envelopeId: 'env_a' })] }).operations] }, del: {} });
  const plan = planDeleteRecurring(state, id, 'all', ctx);
  assert.equal(plan.ok, false);
  assert.equal(planDeleteRecurring(state, id, 'future', ctx).ok, true);
});

test('pause puis reprise : pas de rattrapage de la période en pause', () => {
  let state = stateWith();
  let id;
  [state, id] = createRule(state, { label: 'Salle de sport', amount: -3000, frequency: 'monthly', startDate: '2026-10-05' });
  state = commit(state, planSetRecurringActive(state, id, false, ctx));
  assert.equal(occurrences(state, id).filter((o) => o.simulated).length, 0);
  state = runTick(state, { today: '2027-02-20' });
  assert.equal(occurrences(state, id).length, 2, 'rien de nouveau pendant la pause');
  state = commit(state, planSetRecurringActive(state, id, true, { today: '2027-02-20' }));
  const occ = occurrences(state, id);
  assert.deepEqual(occ.filter((o) => !o.simulated).map((o) => o.date), ['2026-10-05', '2026-11-05']);
  assert.equal(occ.find((o) => o.simulated).date, '2027-03-05');
});

test('clôturer une enveloppe met ses récurrences en pause, la rouvrir les relance', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 })] });
  let recE;
  let recOther;
  [state, recE] = createRule(state, { kind: KIND.TRANSFER, label: 'Épargne', amount: 5000, from: null, to: 'env_a', frequency: 'monthly', startDate: '2026-12-01' });
  [state, recOther] = createRule(state, { label: 'Loyer', amount: -30000, frequency: 'monthly', startDate: '2026-12-01' });
  state = commit(state, planCloseEnvelope(state, 'env_a', { today: TODAY, sweep: true }));
  assert.equal(state.recurring.find((r) => r.id === recE).active, false);
  assert.equal(state.recurring.find((r) => r.id === recE).pausedBy, 'env_a');
  assert.equal(state.recurring.find((r) => r.id === recOther).active, true);
  assert.equal(occurrences(state, recE).length, 0);
  const reopen = planReopenEnvelope(state, 'env_a', { today: '2027-01-15' });
  assert.equal(reopen.resumed, 1);
  state = commit(state, reopen);
  assert.equal(state.recurring.find((r) => r.id === recE).active, true);
  assert.equal(occurrences(state, recE)[0].date, '2027-02-01');
});

test('date de fin et horizon étendu pour une projection lointaine', () => {
  let state = stateWith();
  let recF;
  let recG;
  [state, recF] = createRule(state, { label: 'Crédit', amount: -10000, frequency: 'monthly', startDate: '2026-12-01', endDate: '2027-02-15' });
  assert.deepEqual(occurrences(state, recF).map((o) => o.date), ['2026-12-01', '2027-01-01', '2027-02-01']);
  [state, recG] = createRule(state, { label: 'Loyer', amount: -30000, frequency: 'monthly', startDate: '2026-12-01' });
  const near = occurrences(state, recG).length;
  state = runTick(state, { today: TODAY, upTo: '2028-01-01' });
  const far = occurrences(state, recG);
  assert.ok(far.length > near);
  assert.equal(far.at(-1).date, '2028-01-01');
});

test('validations d\'une règle', () => {
  const state = stateWith({ envelopes: [ENV, { id: 'env_c', name: 'Fermée', closed: true }] });
  assert.equal(planSaveRecurring(state, { label: '', amount: -1, startDate: TODAY }, ctx).ok, false);
  assert.equal(planSaveRecurring(state, { label: 'x', amount: 0, startDate: TODAY }, ctx).ok, false);
  assert.equal(planSaveRecurring(state, { label: 'x', amount: -1 }, ctx).ok, false);
  assert.equal(planSaveRecurring(state, { label: 'x', amount: -1, startDate: TODAY, endDate: '2026-01-01' }, ctx).ok, false);
  assert.equal(planSaveRecurring(state, { label: 'x', amount: 100, startDate: TODAY, envelopeId: 'env_a' }, ctx).errors[0].code, 'credit-in-envelope');
  assert.equal(planSaveRecurring(state, { label: 'x', amount: -100, startDate: TODAY, envelopeId: 'env_c' }, ctx).errors[0].code, 'closed-envelope');
  assert.equal(planSaveRecurring(state, { kind: KIND.TRANSFER, label: 'x', amount: 100, from: null, to: null, startDate: TODAY }, ctx).ok, false);
});
