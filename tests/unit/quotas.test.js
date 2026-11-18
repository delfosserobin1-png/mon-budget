// Quotas par tag : périodes, ce qui compte, état, avertissement à la saisie, textes, réglage.
// Le 15-11-2026 (date des tests) est un dimanche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTag, makeOperation, emptyState, KIND } from '../../www/js/core/schema.js';
import { exportData, planImport, readImport } from '../../www/js/core/portable.js';
import { apply, cloneState } from '../../www/js/core/changeset.js';
import * as quotas from '../../www/js/core/quotas.js';
const { currentWindow, overQuotaCount, quotaImpact, quotaStatus, quotaStatuses, tagNet, windowAt } = quotas;
import { planSaveTag, validateQuota } from '../../www/js/core/tags.js';
import { TODAY, op, transfer } from './helpers.js';

const month = (amount) => ({ amount, period: 'month' });
// formatAmount sépare les chiffres et « € » par des espaces insécables : on les ramène à des espaces simples
const plain = (text) => String(text).replace(/\s/g, ' ');
const statusText = (s) => plain(quotas.statusText(s));
const impactText = (impact, today) => plain(quotas.impactText(impact, today));
const quotaText = (q) => plain(quotas.quotaText(q));
const windowText = (q) => plain(quotas.windowText(q));

function world({ quota = month(20000), operations = [], tags = [] } = {}) {
  const state = emptyState();
  state.envelopes = [];
  state.tags = [makeTag({ id: 'tag_resto', name: 'Restaurant', color: 'ambre', quota }), makeTag({ id: 'tag_sortie', name: 'Sorties', color: 'violet' }), ...tags.map((t) => makeTag(t))];
  state.operations = operations.map((o) => makeOperation(o));
  return state;
}
const resto = (date, euros, fields = {}) => op({ date, amount: -Math.round(euros * 100), tags: ['tag_resto'], ...fields });

test('périodes : jour, semaine (du lundi au dimanche), mois, année, dates choisies', () => {
  assert.deepEqual(windowAt({ period: 'day' }, TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(windowAt({ period: 'week' }, TODAY), { from: '2026-11-09', to: '2026-11-15' }, 'un dimanche termine sa semaine');
  assert.deepEqual(windowAt({ period: 'week' }, '2026-11-16'), { from: '2026-11-16', to: '2026-11-22' }, 'un lundi en commence une');
  assert.deepEqual(windowAt({ period: 'week' }, '2026-12-31'), { from: '2026-12-28', to: '2027-01-03' }, 'une semaine peut chevaucher deux années');
  assert.deepEqual(windowAt({ period: 'month' }, '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' }, 'février bissextile');
  assert.deepEqual(windowAt({ period: 'year' }, TODAY), { from: '2026-01-01', to: '2026-12-31' });
  const custom = { period: 'custom', from: '2026-08-01', to: '2026-08-15' };
  assert.deepEqual(windowAt(custom, '2026-08-15'), { from: '2026-08-01', to: '2026-08-15' });
  assert.equal(windowAt(custom, '2026-08-16'), null);
  assert.deepEqual(currentWindow(custom, TODAY), { from: '2026-08-01', to: '2026-08-15' }, 'hors période : on regarde quand même ses dates');
});

test('ce qui compte : dépenses réelles du tag dans la période, moins les remboursements ; ni prévisions, ni mouvements, ni ajustements', () => {
  const state = world({
    operations: [
      resto('2026-11-02', 30),
      resto('2026-11-10', 12.5, { tags: ['tag_resto', 'tag_sortie'] }),
      op({ date: '2026-11-11', amount: 800, tags: ['tag_resto'], label: 'Remboursement' }),
      resto('2026-10-31', 99),
      resto('2026-12-01', 99),
      resto('2026-11-12', 40, { simulated: true }),
      resto('2026-11-13', 50, { simulated: true, checked: false }),
      op({ date: '2026-11-12', amount: -2000, tags: ['tag_sortie'] }),
      { kind: KIND.ADJUSTMENT, date: '2026-11-05', amount: -500, tags: ['tag_resto'] },
      transfer(null, 'env_x', 7000, { date: '2026-11-03' }),
    ],
  });
  assert.equal(tagNet(state, 'tag_resto', '2026-11-01', '2026-11-30'), -3000 - 1250 + 800);
  assert.equal(tagNet(state, 'tag_resto', '2026-11-01', '2026-11-30', { simulated: true }), -4000, 'prévisions cochées seulement');
  assert.equal(tagNet(state, 'tag_sortie', '2026-11-01', '2026-11-30'), -1250 - 2000, 'une dépense à deux tags compte en entier pour chacun');
  assert.equal(tagNet(state, 'tag_resto', '2026-11-01', '2026-11-30', { excludeId: state.operations[0].id }), -1250 + 800);
});

test('état du quota : dépensé, prévu, reste, rythme par jour, niveau', () => {
  const ops = [resto('2026-11-02', 100), resto('2026-11-14', 50), resto('2026-11-20', 10), resto('2026-11-25', 15, { simulated: true })];
  const tag = (state) => state.tags[0];
  let state = world({ operations: ops });
  let s = quotaStatus(state, tag(state), TODAY);
  assert.deepEqual([s.from, s.to, s.phase, s.limit, s.spent, s.planned, s.remaining, s.level], ['2026-11-01', '2026-11-30', 'active', 20000, 15000, 2500, 5000, 'ok']);
  assert.equal(s.daysLeft, 16, 'du 15 au 30 compris');
  assert.equal(s.perDay, 312, '50 € sur 16 jours');
  assert.equal(s.projected, 17500);
  assert.equal(s.projectedLevel, 'warn', 'avec le prévu, on dépasse 80 %');
  assert.match(statusText(s), /^Reste 50,00 € ce mois-ci, soit 3,12 € par jour$/);

  state = world({ operations: [...ops, resto('2026-11-15', 20)] });
  s = quotaStatus(state, tag(state), TODAY);
  assert.deepEqual([s.spent, s.level], [17000, 'warn']);
  state = world({ operations: [...ops, resto('2026-11-15', 60)] });
  s = quotaStatus(state, tag(state), TODAY);
  assert.deepEqual([s.spent, s.level, s.remaining, s.perDay], [21000, 'over', -1000, 0]);
  assert.match(statusText(s), /^Dépassé de 10,00 € ce mois-ci$/);
  assert.equal(overQuotaCount(state, TODAY), 1);
  assert.equal(quotaStatus(state, state.tags[1], TODAY), null, 'pas de quota, pas d’état');
});

test('quota par jour, et dates choisies : à venir, en cours, terminé', () => {
  let state = world({ quota: { amount: 1500, period: 'day' }, operations: [resto(TODAY, 12), resto('2026-11-14', 30)] });
  let s = quotaStatus(state, state.tags[0], TODAY);
  assert.deepEqual([s.from, s.to, s.spent, s.level, s.daysLeft], [TODAY, TODAY, 1200, 'warn', 1]);
  assert.match(statusText(s), /^Reste 3,00 € aujourd'hui$/, 'pas de « par jour » pour un quota du jour');

  const custom = (from, to) => ({ amount: 50000, period: 'custom', from, to });
  state = world({ quota: custom('2026-12-20', '2027-01-03'), operations: [resto('2026-12-22', 40, { simulated: true })] });
  s = quotaStatus(state, state.tags[0], TODAY);
  assert.deepEqual([s.phase, s.spent, s.planned, s.daysLeft], ['upcoming', 0, 4000, 15]);
  assert.match(statusText(s), /^Commence le 20-12-2026$/);

  state = world({ quota: custom('2026-08-01', '2026-08-15'), operations: [resto('2026-08-03', 120), resto('2026-08-20', 999)] });
  s = quotaStatus(state, state.tags[0], TODAY);
  assert.deepEqual([s.phase, s.spent, s.planned, s.perDay], ['ended', 12000, 0, 0]);
  assert.match(statusText(s), /^Terminé : 120,00 € dépensés sur 500,00 €$/);
});

test('liste des quotas : les dépassés d’abord, puis les presque atteints, les terminés à la fin', () => {
  const state = world({
    quota: month(10000),
    operations: [resto('2026-11-03', 120), op({ date: '2026-11-04', amount: -900, tags: ['tag_a'] }), op({ date: '2026-11-04', amount: -100, tags: ['tag_b'] })],
    tags: [
      { id: 'tag_a', name: 'Alpha', quota: month(1000) },
      { id: 'tag_b', name: 'Bêta', quota: month(1000) },
      { id: 'tag_c', name: 'Ancien', quota: { amount: 100, period: 'custom', from: '2026-01-01', to: '2026-01-31' } },
    ],
  });
  assert.deepEqual(quotaStatuses(state, TODAY).map((s) => [s.name, s.level, s.phase]), [['Restaurant', 'over', 'active'], ['Alpha', 'warn', 'active'], ['Bêta', 'ok', 'active'], ['Ancien', 'ok', 'ended']]);
});

test('à la saisie : prévenir quand une dépense fait atteindre ou dépasser un quota', () => {
  const state = world({ operations: [resto('2026-11-02', 140)] });
  const draft = (euros, fields = {}) => ({ date: TODAY, amount: -Math.round(euros * 100), tags: ['tag_resto'], ...fields });
  assert.deepEqual(quotaImpact(state, draft(10)), [], '150 € sur 200 € : rien à dire');
  const [warn] = quotaImpact(state, draft(25));
  assert.deepEqual([warn.level, warn.before, warn.after, warn.limit, warn.from, warn.to], ['warn', 14000, 16500, 20000, '2026-11-01', '2026-11-30']);
  assert.equal(impactText(warn, TODAY), 'Avec cette dépense, « Restaurant » atteint 83 % de son quota (165,00 € sur 200,00 € ce mois-ci).');
  const [over] = quotaImpact(state, draft(70));
  assert.equal(over.level, 'over');
  assert.equal(impactText(over, TODAY), 'Avec cette dépense, « Restaurant » dépasse son quota : 210,00 € sur 200,00 € ce mois-ci.');
  // une dépense datée d'un autre mois se compare à CE mois-là
  const [past] = quotaImpact(state, draft(170, { date: '2026-10-10' }));
  assert.deepEqual([past.level, past.before, past.from], ['warn', 0, '2026-10-01']);
  assert.match(impactText(past, TODAY), /du 01-10-2026 au 31-10-2026/);
  // modifier la dépense déjà enregistrée ne la compte pas deux fois
  assert.deepEqual(quotaImpact(state, { ...draft(150), id: state.operations[0].id }), [], '150 € à la place de 140 € : toujours sous 80 %');
  // ni un revenu, ni une dépense sans tag à quota, ni un montant vide
  assert.deepEqual(quotaImpact(state, { ...draft(70), amount: 7000 }), []);
  assert.deepEqual(quotaImpact(state, draft(70, { tags: ['tag_sortie'] })), []);
  assert.deepEqual(quotaImpact(state, { date: TODAY, amount: NaN, tags: ['tag_resto'] }), []);
  assert.deepEqual(quotaImpact(state, null), []);
  // une prévision se compare au réel plus les prévisions cochées
  const withPlan = world({ operations: [resto('2026-11-02', 100), resto('2026-11-25', 50, { simulated: true })] });
  assert.equal(quotaImpact(withPlan, draft(20, { date: '2026-11-26', simulated: true }))[0].after, 17000);
  assert.deepEqual(quotaImpact(withPlan, draft(20, { date: '2026-11-26' })), [], 'une dépense réelle ne tient pas compte des prévisions');
  // quota par jour, autre jour : « le 14-11-2026 »
  const daily = world({ quota: { amount: 1000, period: 'day' } });
  assert.match(impactText(quotaImpact(daily, draft(9, { date: '2026-11-14' }))[0], TODAY), /le 14-11-2026/);
});

test('textes d’un quota', () => {
  assert.equal(quotaText(month(20000)), '200,00 € par mois');
  assert.equal(quotaText({ amount: 500, period: 'day' }), '5,00 € par jour');
  assert.equal(quotaText({ amount: 50000, period: 'custom', from: '2026-08-01', to: '2026-08-15' }), '500,00 € du 01-08-2026 au 15-08-2026');
  assert.equal(quotaText(null), '');
  assert.equal(windowText({ period: 'week' }), 'cette semaine');
  assert.equal(windowText({ period: 'year' }), 'cette année');
});

test('réglage : un quota incomplet ou incohérent est refusé avec une explication claire', () => {
  const errors = (quota) => validateQuota(quota).errors.map((e) => e.field);
  assert.deepEqual(validateQuota(null), { quota: null, errors: [] });
  assert.deepEqual(errors({ amount: 0, period: 'month' }), ['quotaAmount']);
  assert.deepEqual(errors({ amount: 12.5, period: 'month' }), ['quotaAmount'], 'des centimes entiers');
  assert.deepEqual(errors({ amount: 100, period: 'quinzaine' }), ['quotaPeriod']);
  assert.deepEqual(errors({ amount: 100, period: 'custom' }), ['quotaFrom', 'quotaTo']);
  assert.deepEqual(errors({ amount: 100, period: 'custom', from: '2026-08-15', to: '2026-08-01' }), ['quotaTo']);
  assert.deepEqual(validateQuota({ amount: 100, period: 'week', from: '2026-01-01', to: '2026-02-01' }).quota, { amount: 100, period: 'week', from: null, to: null }, 'les dates ne servent qu’aux dates choisies');

  let state = world({ quota: null });
  const refused = planSaveTag(state, { id: 'tag_resto', name: 'Restaurant', quota: { amount: 0, period: 'month' } });
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0].message, /montant à ne pas dépasser/);
  const plan = planSaveTag(state, { id: 'tag_resto', name: 'Restaurant', quota: month(15000) });
  assert.equal(plan.ok, true);
  state = apply(cloneState(state), plan.cs);
  assert.deepEqual(state.tags[0].quota, { amount: 15000, period: 'month', from: null, to: null });
  // renommer sans parler du quota le garde ; quota: null le retire
  state = apply(cloneState(state), planSaveTag(state, { id: 'tag_resto', name: 'Restos' }).cs);
  assert.equal(state.tags[0].quota.amount, 15000);
  state = apply(cloneState(state), planSaveTag(state, { id: 'tag_resto', name: 'Restos', quota: null }).cs);
  assert.equal(state.tags[0].quota, null);
});

test('le quota voyage avec les sauvegardes ; à l’import « ajouter », le quota déjà réglé ici est gardé', () => {
  for (const [input, expected] of [
    [{ amount: 100, period: 'month' }, { amount: 100, period: 'month', from: null, to: null }],
    [{ amount: -5, period: 'month' }, null],
    [{ amount: 100, period: 'custom', from: '2026-02-01' }, null],
    ['beaucoup', null],
  ]) assert.deepEqual(makeTag({ name: 'x', quota: input }).quota, expected);

  const state = world({ quota: { amount: 50000, period: 'custom', from: '2026-08-01', to: '2026-08-15' } });
  const read = readImport(JSON.parse(JSON.stringify(exportData(state, { appVersion: '2.2.0' }))));
  assert.deepEqual(read.state.tags.map((t) => t.quota), state.tags.map((t) => t.quota));

  const here = world({ quota: month(30000) });
  const merged = apply(cloneState(here), planImport(here, read.state, 'merge').cs);
  assert.equal(merged.tags.find((t) => t.name === 'Restaurant').quota.amount, 30000);
  const replaced = apply(cloneState(here), planImport(here, read.state, 'replace').cs);
  assert.equal(replaced.tags.find((t) => t.name === 'Restaurant').quota.period, 'custom');
});
