// Tableau de bord (écran Bilan) : compte courant et fin de mois, à venir, objectifs en retard,
// alertes ; et catalogue des commerçants courants pour le premier rangement à l'import.
// Le 15-11-2026 (date des tests) est un dimanche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND, makeRule, makeStatement } from '../../www/js/core/schema.js';
import { dashboardAlerts, lastStatementDate, lateGoals, monthOutlook, upcoming } from '../../www/js/core/dashboard.js';
import { catalogueTag } from '../../www/js/core/categories.js';
import { proposeForLine } from '../../www/js/core/matching.js';
import { TODAY, op, transfer, stateWith } from './helpers.js';

// formatAmount sépare les chiffres et « € » par des espaces insécables : on les ramène à des espaces simples
const plain = (text) => String(text).replace(/\s/g, ' ');
const planned = (fields) => op({ simulated: true, checked: true, ...fields });

test('fin du mois : compte courant réel aujourd’hui, estimation (réel déjà daté + prévisions cochées) et point bas', () => {
  const state = stateWith({
    operations: [
      op({ date: '2026-11-01', amount: 150000, label: 'Salaire' }),
      planned({ date: '2026-11-20', amount: -90000, label: 'Loyer' }),
      planned({ date: '2026-11-25', amount: -70000, label: 'Voiture' }),
      op({ date: '2026-11-28', amount: 30000, label: 'Remboursement déjà annoncé' }),
      planned({ date: '2026-11-29', amount: -50000, label: 'Pas sûr', checked: false }),
      planned({ date: '2026-12-02', amount: -10000, label: 'Décembre' }),
    ],
  });
  const outlook = monthOutlook(state, TODAY);
  assert.deepEqual([outlook.today, outlook.end, outlook.endDate, outlook.daysLeft], [150000, 20000, '2026-11-30', 15]);
  assert.deepEqual(outlook.low, { date: '2026-11-25', amount: -10000 });
});

test('à venir : 7 jours, prévisions cochées et réel déjà daté, dans l’ordre ; ni décochées, ni ajustements, ni au-delà', () => {
  const state = stateWith({
    envelopes: [{ id: 'env_v', name: 'Vacances' }],
    operations: [
      planned({ id: 'op_a', date: '2026-11-18', amount: -2000 }),
      op({ id: 'op_b', date: '2026-11-16', amount: -1000 }),
      planned({ id: 'op_c', date: '2026-11-17', amount: -3000, checked: false }),
      planned({ id: 'op_d', date: '2026-11-23', amount: -4000 }),
      op({ id: 'op_e', date: '2026-11-22', amount: 100, kind: KIND.ADJUSTMENT }),
      op({ id: 'op_f', date: TODAY, amount: -500 }),
      transfer(null, 'env_v', 5000, { id: 'op_g', date: '2026-11-22', simulated: true, checked: true }),
    ],
  });
  assert.deepEqual(upcoming(state, TODAY).map((o) => o.id), ['op_b', 'op_a', 'op_g']);
});

test('objectifs : « en retard » si l’effort du mois n’est pas fait (alimentations prévues comprises), « manqué » si la date est passée', () => {
  const state = stateWith({
    envelopes: [
      { id: 'env_v', name: 'Vacances', goalAmount: 120000, goalDate: '2027-05-15' },
      { id: 'env_m', name: 'Moto', goalAmount: 50000, goalDate: '2026-11-01' },
      { id: 'env_n', name: 'Noël', goalAmount: 30000, goalDate: '2026-12-20' },
      { id: 'env_x', name: 'Sans objectif' },
      { id: 'env_ok', name: 'Atteint', goalAmount: 10000, goalDate: '2026-12-31' },
    ],
    operations: [
      op({ date: '2026-10-01', amount: 200000, label: 'Salaire' }),
      transfer(null, 'env_v', 10000, { date: '2026-11-03' }),
      transfer(null, 'env_m', 20000, { date: '2026-10-01' }),
      transfer(null, 'env_n', 10000, { date: '2026-10-10' }),
      transfer(null, 'env_n', 20000, { date: '2026-11-25', simulated: true, checked: true }),
      transfer(null, 'env_ok', 10000, { date: '2026-10-10' }),
    ],
  });
  const late = lateGoals(state, TODAY);
  // Vacances : il manque 1 100 € en 6 mois, soit 183,34 € ce mois-ci ; 100 € déjà mis → reste 83,34 €
  assert.deepEqual(
    late.map((g) => [g.envelopeId, g.kind, g.kind === 'behind' ? g.todo : g.missing]),
    [
      ['env_v', 'behind', 8334],
      ['env_m', 'missed', 30000],
    ],
  );
});

test('alertes : découvert prévu, sauvegarde, objectif, relevé ancien, réponse de Claude — les plus graves d’abord', () => {
  const state = stateWith({
    envelopes: [{ id: 'env_v', name: 'Vacances', goalAmount: 120000, goalDate: '2027-05-15' }],
    operations: [op({ date: '2026-11-01', amount: 50000, label: 'Salaire' }), planned({ date: '2026-11-25', amount: -60000, label: 'Loyer' })],
  });
  state.statements = [makeStatement({ id: 'stm_a', importedAt: '2026-09-26T10:00:00.000Z' }), makeStatement({ id: 'stm_b', importedAt: '2026-08-20T10:00:00.000Z' })];
  assert.equal(lastStatementDate(state), '2026-09-26');
  const alerts = dashboardAlerts(state, { today: TODAY, backup: { never: false, days: 45 }, unread: 2 });
  assert.deepEqual(
    alerts.map((a) => [a.id, a.level]),
    [
      ['overdraft-soon', 'bad'],
      ['backup', 'warn'],
      ['goal-env_v', 'info'],
      ['statement', 'info'],
      ['claude', 'info'],
    ],
  );
  const text = Object.fromEntries(alerts.map((a) => [a.id, plain(a.text)]));
  assert.match(text['overdraft-soon'], /passera à −100,00 € le 25-11-2026/);
  assert.match(text.backup, /il y a 45 jours/);
  // rien n'est encore mis de côté : 1 200 € en 6 mois, soit 200 € ce mois-ci
  assert.match(text['goal-env_v'], /« Vacances » : mets encore 200,00 € de côté ce mois-ci/);
  assert.match(text.statement, /il y a 50 jours/);
  assert.match(text.claude, /2 messages/);
  assert.deepEqual(alerts.find((a) => a.id === 'goal-env_v').action, { label: 'Ouvrir', screen: 'envelope', params: { id: 'env_v' } });
});

test('alertes : à découvert aujourd’hui ; et rien à signaler quand tout va bien', () => {
  const overdrawn = stateWith({ operations: [op({ date: '2026-11-10', amount: -2500, label: 'Courses' })] });
  const alerts = dashboardAlerts(overdrawn, { today: TODAY });
  assert.deepEqual(alerts.map((a) => a.id), ['overdraft']);
  assert.match(plain(alerts[0].text), /à découvert : −25,00 €/);

  const fine = stateWith({ operations: [op({ date: '2026-11-01', amount: 100000, label: 'Salaire' })] });
  fine.statements = [makeStatement({ importedAt: '2026-11-05T08:00:00.000Z' })];
  assert.deepEqual(dashboardAlerts(fine, { today: TODAY, backup: null, unread: 0 }), []);
});

test('catalogue : un commerçant courant trouve le tag du même nom ; rien sans ce tag ; un mot entier seulement', () => {
  const state = stateWith({
    tags: [
      { id: 'tag_c', name: 'Courses' },
      { id: 'tag_t', name: 'Transport' },
      { id: 'tag_s', name: 'Santé' },
      { id: 'tag_l', name: 'Logement' },
    ],
  });
  assert.equal(catalogueTag(state, 'CARTE X1234 15/11 CARREFOUR CITY PARIS')?.tagId, 'tag_c');
  assert.equal(catalogueTag(state, 'PRLV SEPA TOTALENERGIES ELECTRICITE ET GAZ')?.tagId, 'tag_l', 'une facture d’énergie va au logement, pas au carburant');
  assert.equal(catalogueTag(state, 'CARTE X1234 STATION TOTALENERGIES')?.tagId, 'tag_t');
  assert.equal(catalogueTag(state, 'PHARMACIE DU MARCHÉ')?.tagId, 'tag_s', 'accents et majuscules ignorés, « Santé » retrouvé sans accent');
  assert.equal(catalogueTag(state, 'TOTALEMENT INCONNU'), null, 'un mot entier, pas un morceau de mot');
  assert.equal(catalogueTag(state, 'NETFLIX.COM'), null, 'pas de tag « Abonnements » : rien n’est proposé, aucun tag n’est créé');
  assert.equal(catalogueTag(state, ''), null);
});

test('import : la règle apprise passe avant le catalogue, qui ne sert que pour un commerçant inconnu', () => {
  const state = stateWith({ tags: [{ id: 'tag_c', name: 'Courses' }, { id: 'tag_t', name: 'Transport' }] });
  const line = { amount: -2350, label: 'CARTE X1234 CARREFOUR MARKET', counterparty: 'Carrefour Market', date: TODAY };
  assert.deepEqual(proposeForLine(state, line).tags, ['tag_c']);
  assert.equal(proposeForLine(state, line).hinted, false, 'le catalogue n’est pas présenté comme une habitude');
  state.rules = [makeRule({ key: 'carrefour market', display: 'Carrefour Market', tags: ['tag_t'] })];
  assert.deepEqual(proposeForLine(state, line).tags, ['tag_t']);
  assert.equal(proposeForLine(state, line).hinted, true);
});

test('alertes : l’accord donné à la banque est signalé 14 jours avant sa fin, puis une fois expiré', () => {
  const state = stateWith({ operations: [op({ date: '2026-11-01', amount: 100000, label: 'Salaire' })] });
  const ids = (validUntil) => dashboardAlerts(state, { today: TODAY, bankValidUntil: validUntil }).map((a) => `${a.id}:${a.level}`);
  assert.deepEqual(ids('2027-05-14'), []);
  assert.deepEqual(ids('2026-11-29'), ['bank-consent:warn']);
  assert.deepEqual(ids('2026-11-15T23:00:00.000Z'), ['bank-consent:bad']);
  assert.match(plain(dashboardAlerts(state, { today: TODAY, bankValidUntil: '2026-11-29' })[0].text), /expire dans 14 jours/);
});
