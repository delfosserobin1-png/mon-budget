import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateWith, commit, balances, op, transfer, TODAY } from './helpers.js';
import { apply, cloneState, invert, merge } from '../../www/js/core/changeset.js';
import { KIND } from '../../www/js/core/schema.js';
import { computeBalances, envelopeLowPoint, deltaFor, projectAvailable } from '../../www/js/core/balances.js';
import {
  planSaveOperation, topupChangeset, planCreditThenTransfer, planSaveTransfer, planDeleteOperations,
  planSetChecked, planConfirmSimulation, planAddTag, operationTitle, moveKind, moveLabel, moveTitle, moveDoneLabel, planSetEnvelope,
} from '../../www/js/core/operations.js';
import { planSaveEnvelope, planCloseEnvelope, planReopenEnvelope, planDeleteEnvelope, envelopeReport, envelopeUsage } from '../../www/js/core/envelopes.js';
import { planSaveTag, planDeleteTag, tagUsage } from '../../www/js/core/tags.js';
import { bankBalanceAt, planReconciliation, planAdjustment, planOpeningBalance, planDeleteReconciliation } from '../../www/js/core/reconciliation.js';

const ctx = { today: TODAY };
const ENV = { id: 'env_a', name: 'Projet Tartenpion' };
const ENV_B = { id: 'env_b', name: 'Vacances' };

test('soldes : un virement vers une enveloppe sort du compte courant sans changer le total', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000, label: 'Salaire' })] });
  state = commit(state, planSaveTransfer(state, { from: null, to: 'env_a', amount: 50000, date: TODAY }, ctx));
  assert.deepEqual(balances(state), { available: 50000, total: 100000, envelopes: { env_a: 50000 } });
});

test('soldes : une dépense d\'enveloppe ne touche pas le compte courant mais baisse le total', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 }), transfer(null, 'env_a', 50000)] });
  state = commit(state, planSaveOperation(state, { amount: -12000, date: TODAY, envelopeId: 'env_a', label: 'Matériel' }, ctx));
  assert.deepEqual(balances(state), { available: 50000, total: 88000, envelopes: { env_a: 38000 } });
});

test('soldes : les simulations et les opérations futures ne comptent pas dans le réel du jour', () => {
  const state = stateWith({
    operations: [
      op({ amount: 100000 }),
      op({ amount: -6000, simulated: true, checked: true, date: '2026-11-25' }),
      op({ amount: -2500, simulated: true, checked: false, date: '2026-11-26' }),
      op({ amount: -4000, date: '2026-11-20', label: 'Réelle à venir' }),
    ],
  });
  assert.equal(balances(state).available, 100000);
  assert.equal(computeBalances(state, { upTo: '2026-11-30' }).available, 96000);
  assert.equal(computeBalances(state, { upTo: '2026-11-30', simulations: 'checked' }).available, 90000);
  assert.equal(computeBalances(state, { upTo: '2026-11-30', simulations: 'all' }).available, 87500);
  assert.equal(computeBalances(state, { upTo: '2026-11-25', simulations: 'checked' }).available, 90000);
});

test('point de vue : un même virement est un débit pour le compte courant et un crédit pour l\'enveloppe', () => {
  const state = stateWith({ envelopes: [ENV, ENV_B], operations: [transfer(null, 'env_a', 5000), transfer('env_a', 'env_b', 2000)] });
  const [t1, t2] = state.operations;
  assert.equal(deltaFor(t1, null), -5000);
  assert.equal(deltaFor(t1, 'env_a'), 5000);
  assert.equal(deltaFor(t2, null), 0);
  assert.equal(deltaFor(t2, 'env_a'), -2000);
  assert.equal(deltaFor(t2, 'env_b'), 2000);
  assert.equal(operationTitle(state, t2), 'Projet Tartenpion → Vacances');
});

test('opération : validations de base', () => {
  const state = stateWith({ envelopes: [ENV, { ...ENV_B, closed: true }] });
  const bad = planSaveOperation(state, { amount: 0, date: 'pas une date' }, ctx);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.field).sort(), ['amount', 'date']);
  assert.equal(planSaveOperation(state, { amount: -100, date: TODAY, envelopeId: 'env_zzz' }, ctx).errors[0].code, 'missing-envelope');
  assert.equal(planSaveOperation(state, { amount: -100, date: TODAY, envelopeId: 'env_b' }, ctx).errors[0].code, 'closed-envelope');
});

test('opération : un revenu ne peut pas entrer directement dans une enveloppe', () => {
  const state = stateWith({ envelopes: [ENV] });
  const plan = planSaveOperation(state, { amount: 5000, date: TODAY, envelopeId: 'env_a' }, ctx);
  assert.equal(plan.ok, false);
  assert.equal(plan.errors[0].code, 'credit-in-envelope');
  // L'alternative proposée : revenu sur le compte courant + virement vers l'enveloppe
  const next = commit(state, planCreditThenTransfer(state, { amount: 5000, date: TODAY, envelopeId: 'env_a', label: 'Remboursement' }, ctx));
  assert.deepEqual(balances(next), { available: 0, total: 5000, envelopes: { env_a: 5000 } });
  assert.equal(next.operations.length, 2);
});

test('enveloppe jamais négative : une dépense trop forte propose un virement de complément', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 }), transfer(null, 'env_a', 10000)] });
  const plan = planSaveOperation(state, { amount: -15000, date: TODAY, envelopeId: 'env_a', label: 'Trop cher' }, ctx);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.topups, [{ envelopeId: 'env_a', amount: 5000, date: TODAY }]);
  const cs = merge(plan.cs, topupChangeset(state, plan.topups));
  state = apply(cloneState(state), cs);
  assert.deepEqual(balances(state), { available: 85000, total: 85000, envelopes: { env_a: 0 } });
  assert.equal(state.operations.filter((o) => o.auto === 'topup').length, 1);
});

test('enveloppe jamais négative : une simulation n\'est pas concernée', () => {
  const state = stateWith({ envelopes: [ENV], operations: [transfer(null, 'env_a', 10000)] });
  const plan = planSaveOperation(state, { amount: -50000, date: TODAY, envelopeId: 'env_a', simulated: true }, ctx);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.topups, []);
});

test('enveloppe jamais négative : on tient compte des dépenses réelles déjà datées dans le futur', () => {
  const state = stateWith({
    envelopes: [ENV],
    operations: [transfer(null, 'env_a', 10000), op({ amount: -8000, envelopeId: 'env_a', date: '2026-11-20' })],
  });
  assert.equal(envelopeLowPoint(state, 'env_a', TODAY), 2000);
  const plan = planSaveOperation(state, { amount: -5000, date: TODAY, envelopeId: 'env_a' }, ctx);
  assert.deepEqual(plan.topups, [{ envelopeId: 'env_a', amount: 3000, date: TODAY }]);
});

test('modifier une dépense d\'enveloppe ne recompte pas deux fois son ancien montant', () => {
  let state = stateWith({ envelopes: [ENV], operations: [transfer(null, 'env_a', 10000), op({ id: 'op_x', amount: -9000, envelopeId: 'env_a' })] });
  const same = planSaveOperation(state, { id: 'op_x', amount: -10000, date: TODAY, envelopeId: 'env_a' }, ctx);
  assert.deepEqual(same.topups, []);
  const more = planSaveOperation(state, { id: 'op_x', amount: -10500, date: TODAY, envelopeId: 'env_a' }, ctx);
  assert.deepEqual(more.topups, [{ envelopeId: 'env_a', amount: 500, date: TODAY }]);
});

test('virement : impossible de sortir plus que ce que contient l\'enveloppe', () => {
  const state = stateWith({ envelopes: [ENV, ENV_B], operations: [transfer(null, 'env_a', 10000)] });
  const tooMuch = planSaveTransfer(state, { from: 'env_a', to: null, amount: 10001, date: TODAY }, ctx);
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.errors[0].code, 'insufficient');
  assert.equal(planSaveTransfer(state, { from: 'env_a', to: 'env_b', amount: 10000, date: TODAY }, ctx).ok, true);
  assert.equal(planSaveTransfer(state, { from: 'env_a', to: 'env_a', amount: 100, date: TODAY }, ctx).ok, false);
  assert.equal(planSaveTransfer(state, { from: null, to: 'env_a', amount: 0, date: TODAY }, ctx).ok, false);
});

test('virement : réduire ou supprimer un virement entrant est refusé si des dépenses comptent dessus', () => {
  const state = stateWith({
    envelopes: [ENV],
    operations: [transfer(null, 'env_a', 10000, { id: 'op_t' }), op({ amount: -8000, envelopeId: 'env_a' })],
  });
  assert.equal(planSaveTransfer(state, { id: 'op_t', amount: 7000, date: TODAY }, ctx).ok, false);
  assert.equal(planSaveTransfer(state, { id: 'op_t', amount: 8000, date: TODAY }, ctx).ok, true);
  const del = planDeleteOperations(state, ['op_t'], ctx);
  assert.equal(del.ok, false);
  assert.equal(del.errors[0].code, 'insufficient');
});

test('suppression : détache l\'ajustement du constat de rapprochement concerné', () => {
  let state = stateWith({ operations: [op({ amount: 100000 })] });
  const rec = planReconciliation(state, { date: TODAY, realBalance: 101240 });
  state = commit(state, rec);
  const adj = planAdjustment(state, rec.record.id);
  state = commit(state, adj);
  assert.equal(balances(state).total, 101240);
  state = commit(state, planDeleteOperations(state, [adj.op.id], ctx));
  assert.equal(state.reconciliations[0].adjustmentOperationId, null);
  assert.equal(balances(state).total, 100000);
});

test('simulation : cocher, décocher, confirmer', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ id: 'op_s', amount: -3000, simulated: true, date: '2026-11-20' })] });
  assert.equal(state.operations[0].checked, true);
  state = commit(state, planSetChecked(state, ['op_s'], false));
  assert.equal(state.operations[0].checked, false);
  state = commit(state, planConfirmSimulation(state, 'op_s', ctx));
  assert.equal(state.operations[0].simulated, false);
  assert.equal(state.operations[0].checked, true);
  assert.equal(computeBalances(state, { upTo: '2026-11-20' }).available, -3000);
});

test('annulation : l\'inverse d\'un lot remet l\'état exactement comme avant', () => {
  const state = stateWith({ envelopes: [ENV], tags: [{ id: 'tag_1', name: 'Courses' }], operations: [op({ id: 'op_1', amount: 100000 }), transfer(null, 'env_a', 20000, { id: 'op_2' })] });
  const snapshot = JSON.stringify(state);
  const plan = planDeleteEnvelope(state, 'env_a', 'detach', ctx);
  const inverse = invert(state, plan.cs);
  const after = apply(cloneState(state), plan.cs);
  assert.notEqual(JSON.stringify(after), snapshot);
  const restored = apply(after, inverse);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)).operations.sort((a, b) => a.id.localeCompare(b.id)), JSON.parse(snapshot).operations);
  assert.deepEqual(restored.envelopes, state.envelopes);
});

test('enveloppe : nom obligatoire et unique, objectif', () => {
  let state = stateWith({ envelopes: [ENV] });
  assert.equal(planSaveEnvelope(state, { name: '  ' }).ok, false);
  assert.equal(planSaveEnvelope(state, { name: 'projet tartenpion' }).errors[0].code, 'duplicate');
  const plan = planSaveEnvelope(state, { name: 'Voyage', goalAmount: 300000, goalDate: '2027-05-15' });
  state = commit(state, plan);
  assert.equal(state.envelopes[1].goalAmount, 300000);
  state = commit(state, planSaveTransfer(state, { from: null, to: plan.envelope.id, amount: 60000, date: TODAY }, ctx));
  const report = envelopeReport(state, plan.envelope.id, ctx);
  assert.equal(report.goal.progress, 0.2);
  assert.equal(report.goal.missing, 240000);
  assert.equal(report.goal.perMonth, 40000); // 6 mois pleins restants jusqu'au 15-05-2027
});

test('enveloppe : clôture avec reversement du solde, puis réouverture', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 }), transfer(null, 'env_a', 30000), op({ amount: -10000, envelopeId: 'env_a' })] });
  const close = planCloseEnvelope(state, 'env_a', { today: TODAY, sweep: true });
  assert.equal(close.swept, 20000);
  state = commit(state, close);
  assert.equal(state.envelopes[0].closed, true);
  assert.deepEqual(balances(state), { available: 90000, total: 90000, envelopes: { env_a: 0 } });
  assert.equal(planSaveOperation(state, { amount: -100, date: TODAY, envelopeId: 'env_a' }, ctx).ok, false);
  state = commit(state, planReopenEnvelope(state, 'env_a', ctx));
  assert.equal(state.envelopes[0].closed, false);
});

test('enveloppe : suppression en gardant les dépenses (le total ne bouge pas)', () => {
  let state = stateWith({
    envelopes: [ENV, ENV_B],
    operations: [op({ amount: 100000 }), transfer(null, 'env_a', 30000), op({ id: 'op_d', amount: -10000, envelopeId: 'env_a' }), transfer('env_a', 'env_b', 5000, { id: 'op_ab' })],
  });
  const before = balances(state);
  assert.deepEqual(envelopeUsage(state, 'env_a'), { operations: 1, transfers: 2, rules: 0 });
  state = commit(state, planDeleteEnvelope(state, 'env_a', 'detach', ctx));
  const after = balances(state);
  assert.equal(after.total, before.total);
  assert.deepEqual(after.envelopes, { env_b: 5000 });
  assert.equal(after.available, 85000);
  assert.equal(state.operations.find((o) => o.id === 'op_d').envelopeId, null);
  const moved = state.operations.find((o) => o.id === 'op_ab');
  assert.equal(moved.from, null);
  assert.equal(moved.to, 'env_b');
});

test('enveloppe : suppression avec ses dépenses (le total remonte d\'autant)', () => {
  let state = stateWith({ envelopes: [ENV], operations: [op({ amount: 100000 }), transfer(null, 'env_a', 30000), op({ amount: -10000, envelopeId: 'env_a' })] });
  state = commit(state, planDeleteEnvelope(state, 'env_a', 'purge', ctx));
  assert.deepEqual(balances(state), { available: 100000, total: 100000, envelopes: {} });
  assert.equal(state.operations.length, 1);
});

test('tags : création sans doublon, suppression qui nettoie les opérations', () => {
  let state = stateWith({ tags: [{ id: 'tag_1', name: 'Courses' }], operations: [op({ id: 'op_1', amount: -500, tags: ['tag_1'] })] });
  assert.equal(planSaveTag(state, { name: 'courses' }).errors[0].code, 'duplicate');
  const created = planSaveTag(state, { name: 'Essence' });
  state = commit(state, created);
  state = commit(state, planAddTag(state, ['op_1'], created.tag.id));
  assert.deepEqual(state.operations[0].tags, ['tag_1', created.tag.id]);
  assert.equal(tagUsage(state, 'tag_1'), 1);
  state = commit(state, planDeleteTag(state, 'tag_1'));
  assert.deepEqual(state.operations[0].tags, [created.tag.id]);
  assert.equal(state.tags.length, 1);
});

test('rapprochement : compare le solde total (enveloppes comprises), jamais les simulations', () => {
  let state = stateWith({
    envelopes: [ENV],
    operations: [op({ amount: 100000, date: '2026-11-01' }), transfer(null, 'env_a', 40000, { date: '2026-11-02' }), op({ amount: -5000, envelopeId: 'env_a', date: '2026-11-03' }), op({ amount: -9999, simulated: true, date: '2026-11-04' })],
  });
  assert.equal(bankBalanceAt(state, '2026-11-02'), 100000);
  assert.equal(bankBalanceAt(state, '2026-11-10'), 95000);
  const plan = planReconciliation(state, { date: '2026-11-10', realBalance: 94000 });
  assert.equal(plan.record.gap, -1000);
  state = commit(state, plan);
  state = commit(state, planAdjustment(state, plan.record.id));
  assert.equal(bankBalanceAt(state, '2026-11-10'), 94000);
  assert.equal(planAdjustment(state, plan.record.id).ok, false, 'un écart ne s\'ajuste qu\'une fois');
  state = commit(state, planDeleteReconciliation(state, plan.record.id));
  assert.equal(state.reconciliations.length, 0);
  assert.equal(state.operations.filter((o) => o.kind === KIND.ADJUSTMENT).length, 1);
});

test('rapprochement : une opération pointée compte à la date de la banque', () => {
  const state = stateWith({
    operations: [
      op({ amount: 100000, date: '2026-07-01' }),
      op({ amount: -800, date: '2026-07-06', bank: { date: '2026-07-08', label: 'CARTE X1234 06/07 AUBERGE DU PONT' } }),
    ],
  });
  assert.equal(bankBalanceAt(state, '2026-07-07'), 100000);
  assert.equal(bankBalanceAt(state, '2026-07-08'), 99200);
  assert.equal(computeBalances(state, { upTo: '2026-07-07' }).total, 99200);
});

test('solde de départ', () => {
  let state = stateWith();
  state = commit(state, planOpeningBalance(state, { date: '2026-07-07', amount: 154230 }));
  assert.equal(balances(state).total, 154230);
  assert.equal(state.operations[0].kind, KIND.ADJUSTMENT);
});

test('virement : on peut le modifier pour qu\'il parte du compte courant (ou y arrive)', () => {
  let state = stateWith({
    envelopes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    operations: [transfer(null, 'a', 10000, { id: 't0' }), transfer(null, 'b', 2000, { id: 't2' }), transfer('a', 'b', 4000, { id: 't1' })],
  });
  // « de A vers B » devient « du compte courant vers B »
  state = commit(state, planSaveTransfer(state, { id: 't1', amount: 4000, date: TODAY, from: null, to: 'b' }, { today: TODAY }));
  let t1 = state.operations.find((o) => o.id === 't1');
  assert.deepEqual([t1.from, t1.to], [null, 'b']);
  assert.deepEqual(balances(state), { available: -16000, total: 0, envelopes: { a: 10000, b: 6000 } });
  // puis « de B vers le compte courant »
  state = commit(state, planSaveTransfer(state, { id: 't1', amount: 1000, date: TODAY, from: 'b', to: null }, { today: TODAY }));
  t1 = state.operations.find((o) => o.id === 't1');
  assert.deepEqual([t1.from, t1.to, t1.amount], ['b', null, 1000]);
  assert.deepEqual(balances(state), { available: -11000, total: 0, envelopes: { a: 10000, b: 1000 } });
  // …mais pas pour un montant que B ne contient pas
  assert.equal(planSaveTransfer(state, { id: 't1', amount: 2500, date: TODAY, from: 'b', to: null }, { today: TODAY }).ok, false);
  // sans préciser les comptes, ils sont conservés
  state = commit(state, planSaveTransfer(state, { id: 't0', amount: 12000, date: TODAY }, { today: TODAY }));
  const t0 = state.operations.find((o) => o.id === 't0');
  assert.deepEqual([t0.from, t0.to, t0.amount], [null, 'a', 12000]);
});

test('projection : solde estimé à une date, simulations cochées seulement, et point bas', () => {
  const state = stateWith({
    envelopes: [ENV],
    operations: [
      op({ amount: 100000, date: '2026-11-01', label: 'Salaire' }),
      transfer(null, ENV.id, 20000, { date: '2026-11-02' }),
      op({ amount: -30000, date: '2026-11-18', label: 'Réel, mais daté plus tard' }),
      op({ amount: -70000, date: '2026-11-20', label: 'Loyer simulé', simulated: true }),
      op({ amount: -99999, date: '2026-11-22', label: 'Simulation décochée', simulated: true, checked: false }),
      op({ amount: 150000, date: '2026-11-28', label: 'Salaire simulé', simulated: true }),
      op({ amount: -5000, date: '2026-12-05', label: 'Après la date demandée', simulated: true }),
    ],
  });
  const p = projectAvailable(state, { today: TODAY, upTo: '2026-11-30' });
  assert.deepEqual(p, { start: 80000, end: 130000, totalEnd: 150000, low: { date: '2026-11-20', amount: -20000 } });
  // sans rien de prévu, le point bas est aujourd'hui
  const calm = projectAvailable(stateWith({ operations: [op({ amount: 5000 })] }), { today: TODAY, upTo: '2026-12-31' });
  assert.deepEqual(calm, { start: 5000, end: 5000, totalEnd: 5000, low: { date: TODAY, amount: 5000 } });
});

test("simulation confirmée en avance : elle prend la date d'aujourd'hui ; en retard : elle garde la sienne", () => {
  let state = stateWith({
    operations: [
      op({ id: 'tot', date: '2026-11-28', amount: 180000, label: 'Salaire', simulated: true }),
      op({ id: 'tard', date: '2026-11-10', amount: -2000, label: 'Resto', simulated: true, checked: false }),
    ],
  });
  let plan = planConfirmSimulation(state, 'tot', { today: TODAY });
  assert.equal(plan.op.date, TODAY);
  assert.equal(plan.op.simulated, false);
  state = commit(state, plan);
  plan = planConfirmSimulation(state, 'tard', { today: TODAY });
  assert.equal(plan.op.date, '2026-11-10');
  assert.equal(plan.op.checked, true);
  state = commit(state, plan);
  assert.equal(balances(state).available, 178000);
});

test('vocabulaire : un mouvement d’enveloppe est une alimentation, un retrait ou un déplacement (jamais un « virement »)', () => {
  assert.deepEqual([moveKind(null, 'env_a'), moveKind('', 'env_a'), moveKind('env_a', null), moveKind('env_a', ''), moveKind('env_a', 'env_b')], ['fund', 'fund', 'withdraw', 'withdraw', 'move']);
  assert.deepEqual([moveLabel('', 'env_a'), moveLabel('env_a', ''), moveLabel('env_a', 'env_b')], ['Alimentation', 'Retrait', 'Déplacement']);
  assert.deepEqual([moveTitle('', 'env_a'), moveTitle('env_a', ''), moveTitle('env_a', 'env_b')], ['Alimenter une enveloppe', "Retirer d'une enveloppe", 'Déplacer entre enveloppes']);
  assert.equal(moveDoneLabel('', 'env_a'), 'Enveloppe alimentée');
  for (const text of [moveLabel('', 'x'), moveTitle('x', ''), moveDoneLabel('x', 'y')]) assert.ok(!/virement/i.test(text));
});
test('sélection multiple : ranger des sorties dans une enveloppe (commentaire n° 4) ; les entrées restent sur le compte courant', () => {
  let state = stateWith({
    envelopes: [ENV, ENV_B, { id: 'env_c', name: 'Clôturée', closed: true }],
    operations: [
      op({ id: 'op_sal', amount: 200000, label: 'Salaire', date: '2026-11-01' }),
      transfer(null, 'env_a', 20000, { date: '2026-11-02' }),
      op({ id: 'op_bois', amount: -4500, label: 'Bois', date: '2026-11-10' }),
      op({ id: 'op_vis', amount: -1200, label: 'Vis', date: '2026-11-12' }),
      op({ id: 'op_remb', amount: 3000, label: 'Remboursement', date: '2026-11-13' }),
      op({ id: 'op_deja', amount: -800, label: 'Colle', envelopeId: 'env_a', date: '2026-11-14' }),
    ],
  });
  const ids = ['op_bois', 'op_vis', 'op_remb', 'op_deja'];
  const plan = planSetEnvelope(state, ids, 'env_a', ctx);
  assert.equal(plan.ok, true);
  assert.deepEqual([plan.moved, plan.skipped, plan.unchanged, plan.topups], [2, 1, 1, []]);
  const before = balances(state);
  state = commit(state, plan);
  const after = balances(state);
  assert.equal(after.total, before.total, 'le solde total ne bouge pas');
  assert.deepEqual([after.available - before.available, after.envelopes.env_a - before.envelopes.env_a], [5700, -5700]);
  assert.equal(state.operations.find((o) => o.id === 'op_remb').envelopeId, null, 'une entrée reste sur le compte courant');

  // et les ramener sur le compte courant
  const back = planSetEnvelope(state, ['op_bois', 'op_vis'], null, ctx);
  assert.deepEqual([back.ok, back.moved], [true, 2]);
  assert.equal(balances(commit(state, back)).envelopes.env_a, 20000 - 800);

  // rien à faire, enveloppe clôturée ou disparue : refusé avec une explication
  assert.equal(planSetEnvelope(state, ['op_remb'], 'env_a', ctx).errors[0].code, 'nothing-to-move');
  assert.equal(planSetEnvelope(state, ['op_bois'], 'env_a', ctx).errors[0].code, 'unchanged');
  assert.equal(planSetEnvelope(state, ['op_bois'], 'env_c', ctx).errors[0].code, 'closed-envelope');
  assert.equal(planSetEnvelope(state, ['op_bois'], 'env_zz', ctx).errors[0].code, 'missing-envelope');
});

test('sélection multiple : une enveloppe trop peu garnie reçoit un complément daté de la plus ancienne sortie rangée', () => {
  const state = stateWith({
    envelopes: [ENV_B],
    operations: [
      op({ amount: 200000, label: 'Salaire', date: '2026-11-01' }),
      transfer(null, 'env_b', 5000, { date: '2026-11-02' }),
      op({ id: 'op_train', amount: -6000, label: 'Train', date: '2026-11-08' }),
      op({ id: 'op_hotel', amount: -9000, label: 'Hôtel', date: '2026-11-05' }),
    ],
  });
  const plan = planSetEnvelope(state, ['op_train', 'op_hotel'], 'env_b', ctx);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.topups, [{ envelopeId: 'env_b', amount: 10000, date: '2026-11-05' }]);
  const done = commit(state, { ok: true, cs: merge(plan.cs, topupChangeset(state, plan.topups)) });
  assert.equal(balances(done).envelopes.env_b, 0, 'l’enveloppe arrive à zéro, jamais en dessous');
  assert.equal(envelopeLowPoint(done, 'env_b', '2026-11-01'), 0);
});
