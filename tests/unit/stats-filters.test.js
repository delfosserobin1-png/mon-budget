// Tests des statistiques et des filtres de la liste des opérations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateWith, op, transfer } from './helpers.js';
import { KIND } from '../../www/js/core/schema.js';
import * as stats from '../../www/js/core/stats.js';
import { emptyFilter, filterOperations, sortNewestFirst, describeFilter, activeCount, isFilterActive, resolvePeriod, listTotal, typeOf } from '../../www/js/core/filters.js';

const TODAY = '2026-11-15';

function sample() {
  return stateWith({
    tags: [{ id: 'courses', name: 'Courses', color: 'vert' }, { id: 'loisirs', name: 'Loisirs', color: 'violet' }],
    envelopes: [{ id: 'vac', name: 'Vacances', color: 'ambre' }],
    operations: [
      { kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-09-30', amount: 100000, label: 'Solde de départ', auto: 'opening' },
      op({ id: 'sal10', date: '2026-10-28', amount: 200000, label: 'Salaire', counterparty: 'Employeur' }),
      op({ id: 'c1', date: '2026-10-05', amount: -6000, label: 'Courses', counterparty: 'SUPER U', tags: ['courses'], importance: 'necessite' }),
      op({ id: 'c2', date: '2026-11-03', amount: -4001, label: 'Courses', counterparty: 'Super U', tags: ['courses', 'loisirs'], importance: 'necessite' }),
      op({ id: 'cine', date: '2026-11-10', amount: -1200, label: 'Cinéma', tags: ['loisirs'], importance: 'caprice', photoIds: ['f1'], time: '20:30' }),
      op({ id: 'loyer', date: '2026-11-05', amount: -65000, label: 'Loyer', recurringId: 'rec_loyer', importance: 'necessite' }),
      op({ id: 'train', date: '2026-11-08', amount: -9000, label: 'Billets de train', envelopeId: 'vac', comment: 'Lyon' }),
      op({ id: 'divers', date: '2026-11-12', amount: -500 }),
      transfer(null, 'vac', 30000, { id: 'vir', date: '2026-11-01' }),
      op({ id: 'futur', date: '2026-11-20', amount: -7777, label: 'Réel mais plus tard' }),
      op({ id: 'simu', date: '2026-11-25', amount: -10000, label: 'Simulation cochée', simulated: true }),
      op({ id: 'simu2', date: '2026-11-26', amount: -5000, label: 'Simulation décochée', simulated: true, checked: false }),
    ],
  });
}
const NOV = { from: '2026-11-01', to: '2026-11-30', today: TODAY };

test('résumé : revenus, dépenses, rythme, plus grosse dépense, comparaison au mois précédent', () => {
  const s = stats.summarize(sample(), NOV);
  assert.deepEqual([s.income, s.expense, s.net, s.count, s.days], [0, 79701, -79701, 5, 15]);
  assert.equal(s.perDay, Math.round(79701 / 15));
  assert.equal(s.biggest.id, 'loyer');
  // novembre est en cours (on est le 15) : la comparaison porte sur le 1er-15 octobre
  assert.deepEqual([s.previous.income, s.previous.expense], [0, 6000]);
  assert.deepEqual(s.previousRange, { from: '2026-10-01', to: '2026-10-15' });
  const october = stats.summarize(sample(), { from: '2026-10-01', to: '2026-10-31', today: TODAY });
  assert.deepEqual([october.income, october.expense, october.partial], [200000, 6000, false]);
  assert.equal(stats.summarize(sample(), { from: '2026-09-01', to: '2026-09-30', today: TODAY }).previous, null, 'pas de comparaison sans historique');
  assert.deepEqual(stats.previousRange({ from: '2026-11-03', to: '2026-11-09' }), { from: '2026-10-27', to: '2026-11-02' });
  assert.deepEqual(stats.previousRange({ from: '2026-09-01', to: '2026-11-30' }), { from: '2026-06-01', to: '2026-08-31' });
  assert.equal(stats.variation(120, 100), 0.2);
  assert.equal(stats.variation(120, 0), null);
});

test('dépenses par tag : partage entre tags, total conservé au centime', () => {
  const rows = stats.expensesByTag(sample(), NOV);
  assert.deepEqual(rows.map((r) => [r.id, r.amount, r.count]), [[null, 74500, 3], ['loisirs', 3200, 2], ['courses', 2001, 1]]);
  assert.equal(rows.reduce((a, r) => a + r.amount, 0), 79701);
  assert.equal(rows[0].name, 'Sans tag');
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9);
});

test('dépenses par importance, par enveloppe, fixes / variables, par jour', () => {
  const imp = stats.expensesByImportance(sample(), NOV);
  assert.deepEqual(imp.map((r) => [r.id, r.amount]), [['necessite', 69001], ['confort', 0], ['caprice', 1200], ['none', 9500]]);
  const env = stats.expensesByEnvelope(sample(), NOV);
  assert.deepEqual(env.map((r) => [r.name, r.amount]), [['Compte courant', 70701], ['Vacances', 9000]]);
  assert.deepEqual(stats.fixedVsVariable(sample(), NOV), { fixed: 65000, variable: 14701, total: 79701 });
  const days = stats.dailyExpenses(sample(), NOV);
  assert.equal(days.get('2026-11-05'), 65000);
  assert.equal(days.has('2026-11-20'), false, 'une opération datée dans le futur ne compte pas encore');
  // périmètre : compte courant seul, ou une enveloppe
  assert.equal(stats.summarize(sample(), { ...NOV, scope: 'available' }).expense, 70701);
  assert.equal(stats.summarize(sample(), { ...NOV, scope: 'vac' }).expense, 9000);
});

test('mois par mois et principaux tiers', () => {
  const months = stats.monthlySeries(sample(), { from: '2026-09-01', to: '2026-11-30', today: TODAY });
  assert.deepEqual(months.map((m) => [m.key, m.income, m.expense]), [['2026-09', 0, 0], ['2026-10', 200000, 6000], ['2026-11', 0, 79701]]);
  assert.equal(months[2].importance.necessite, 69001);
  const top = stats.topCounterparties(sample(), { from: '2026-10-01', to: '2026-11-30', today: TODAY }, 2);
  assert.deepEqual(top.map((t) => [t.key, t.amount, t.count]), [['loyer', 65000, 1], ['super u', 10001, 2]]);
});

test('évolution des soldes : réel jusqu\'à aujourd\'hui, puis projection avec les simulations cochées', () => {
  const points = stats.balanceSeries(sample(), { from: '2026-11-01', to: '2026-11-30', today: TODAY });
  assert.equal(points.length, 30);
  const at = (d) => points.find((p) => p.date === d);
  assert.deepEqual([at('2026-11-01').available, at('2026-11-01').total], [264000, 294000]);
  assert.deepEqual([at('2026-11-15').available, at('2026-11-15').total, at('2026-11-15').projected], [193299, 214299, false]);
  assert.deepEqual([at('2026-11-20').total, at('2026-11-20').projected], [206522, true]);
  assert.equal(at('2026-11-30').total, 196522, 'la simulation décochée ne compte pas');
});

test('périodes proposées et bornes ouvertes', () => {
  const presets = stats.periodPresets(TODAY);
  assert.deepEqual(presets.map((p) => p.id), ['month', 'lastMonth', '3months', '12months', 'year', 'all']);
  assert.deepEqual([presets[1].from, presets[1].to], ['2026-10-01', '2026-10-31']);
  assert.deepEqual([presets[3].from, presets[3].to], ['2025-12-01', '2026-11-30']);
  const all = stats.resolveRange(sample(), presets[5], TODAY);
  assert.deepEqual([all.from, all.to], ['2026-09-01', '2026-11-30']);
  assert.equal(stats.resolveRange(stateWith(), presets[5], TODAY).from, '2026-11-01');
});

test('filtres : période, type, compte, tags, importance, montant, photo, pointage, recherche', () => {
  const state = sample();
  const ids = (patch) => filterOperations(state, { ...emptyFilter(), ...patch }, { today: TODAY }).map((o) => o.id).sort();
  assert.equal(ids({}).length, 12);
  assert.deepEqual(ids({ period: 'lastMonth' }), ['c1', 'sal10']);
  assert.deepEqual(ids({ period: 'custom', from: '2026-11-08', to: '2026-11-10' }), ['cine', 'train']);
  assert.deepEqual(ids({ types: ['income'] }), ['sal10']);
  assert.deepEqual(ids({ types: ['transfer', 'adjustment'] }), ['depart', 'vir']);
  assert.deepEqual(ids({ account: 'vac' }), ['train', 'vir']);
  assert.equal(ids({ account: 'available' }).includes('train'), false);
  assert.equal(ids({ account: 'available' }).includes('vir'), true);
  assert.deepEqual(ids({ tags: ['loisirs'] }), ['c2', 'cine']);
  assert.deepEqual(ids({ untagged: true, period: 'month', types: ['expense'] }), ['divers', 'futur', 'loyer', 'simu', 'simu2', 'train']);
  assert.deepEqual(ids({ importance: ['caprice'] }), ['cine']);
  assert.deepEqual(ids({ importance: ['none'], types: ['expense'], period: 'lastMonth' }), []);
  assert.deepEqual(ids({ minAmount: 60000, maxAmount: 70000 }), ['loyer']);
  assert.deepEqual(ids({ withPhoto: true }), ['cine']);
  assert.equal(ids({ unpointed: true }).includes('simu'), false);
  assert.deepEqual(ids({ query: 'super u' }), ['c1', 'c2']);
  assert.deepEqual(ids({ query: 'CINEMA' }), ['cine'], 'recherche sans accents ni majuscules');
  assert.deepEqual(ids({ query: 'vacances' }), ['train', 'vir'], 'le nom de l\'enveloppe est cherché aussi');
  assert.deepEqual(ids({ query: 'lyon' }), ['train']);
  assert.deepEqual(ids({ query: '650,00' }), ['loyer']);
  assert.deepEqual(ids({ query: '10-11-2026' }), ['cine']);
  assert.deepEqual(ids({ counterparty: 'super u' }), ['c1', 'c2']);
});

test('filtres : tri (le plus ancien en bas), totaux, étiquettes', () => {
  const state = sample();
  const sorted = sortNewestFirst(state.operations.filter((o) => !o.simulated));
  assert.equal(sorted[0].id, 'futur');
  assert.equal(sorted[sorted.length - 1].id, 'depart');
  const sameDay = sortNewestFirst([op({ id: 'a', date: TODAY, time: '08:00' }), op({ id: 'b', date: TODAY, time: '19:00' })]);
  assert.deepEqual(sameDay.map((o) => o.id), ['b', 'a']);
  const november = filterOperations(state, { ...emptyFilter(), period: 'month' }, { today: TODAY }).filter((o) => !o.simulated && o.date <= TODAY);
  assert.equal(listTotal(november, null), -4001 - 1200 - 65000 - 500 - 30000);
  assert.equal(listTotal(november, 'vac'), 30000 - 9000);
  assert.equal(listTotal(november, 'total'), -79701);
  const filter = { ...emptyFilter(), period: 'month', types: ['expense'], tags: ['courses'], account: 'vac', importance: ['none'], minAmount: 1000, withPhoto: true };
  assert.deepEqual(describeFilter(state, filter), ['Ce mois', 'Sorties', 'Vacances', 'Courses', 'Importance non précisée', 'Au moins 10,00 €', 'Avec photo']);
  assert.equal(activeCount(filter), 7);
  assert.equal(isFilterActive(emptyFilter()), false);
  assert.equal(isFilterActive({ ...emptyFilter(), query: ' x ' }), true);
  assert.deepEqual(resolvePeriod({ ...emptyFilter(), period: 'year' }, TODAY), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(resolvePeriod({ ...emptyFilter(), period: '3months' }, TODAY), { from: '2026-09-01', to: '2026-11-30' });
  assert.deepEqual(state.operations.slice(0, 3).map(typeOf), ['adjustment', 'income', 'expense']);
});

test('résumé : une période en cours se compare à la même durée de la période précédente', () => {
  const state = stateWith({
    operations: [
      op({ id: 'o1', date: '2026-10-05', amount: -10000 }), // dans les 15 premiers jours d'octobre
      op({ id: 'o2', date: '2026-10-25', amount: -50000 }), // après le 15 : hors comparaison
      op({ id: 'o3', date: '2026-10-28', amount: 200000 }),
      op({ id: 'n1', date: '2026-11-03', amount: -12000 }),
    ],
  });
  const month = stats.summarize(state, { from: '2026-11-01', to: '2026-11-30', today: TODAY });
  assert.equal(month.partial, true);
  assert.deepEqual(month.previousRange, { from: '2026-10-01', to: '2026-10-15' });
  assert.deepEqual([month.previous.expense, month.previous.income], [10000, 0]);
  // période terminée : comparaison de période entière à période entière
  const last = stats.summarize(state, { from: '2026-10-01', to: '2026-10-31', today: TODAY });
  assert.equal(last.partial, false);
  assert.equal(last.previous, null, "rien avant octobre : pas de comparaison inventée");
});
