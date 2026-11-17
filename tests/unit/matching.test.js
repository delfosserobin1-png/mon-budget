// Tests du rapprochement d'un relevé avec les opérations de l'appli, et des règles automatiques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateWith, commit, balances, op, transfer } from './helpers.js';
import { KIND } from '../../www/js/core/schema.js';
import { matchStatement, planStatementImport, proposeForLine, mergePreview, isHistoryImport, findSameStatement, planDeleteStatement } from '../../www/js/core/matching.js';
import { bankBalanceAt, planOpeningBalance } from '../../www/js/core/reconciliation.js';
import { findRule, suggestFor, planSaveRule, planDeleteRule } from '../../www/js/core/rules.js';
import { invert, apply, cloneState } from '../../www/js/core/changeset.js';

const TODAY = '2026-08-20';

/** Petit relevé de test : solde précédent 1 000,00 € au 31/07, quatre lignes, nouveau solde 1 405,00 €. */
function statement(overrides = {}) {
  const lines = [
    { id: 'L001', date: '2026-08-03', opDate: '2026-08-01', amount: -2500, label: 'CARTE X1 01/08 BOULANGERIE DU PARC', details: [], counterparty: 'Boulangerie du Parc', suggestedLabel: 'Boulangerie du Parc', time: null, motif: '' },
    { id: 'L002', date: '2026-08-05', opDate: null, amount: 50000, label: 'VIR RECU 1', details: ['DE: EMPLOYEUR'], counterparty: 'Employeur', suggestedLabel: 'Salaire', time: '09:30', motif: 'Salaire' },
    { id: 'L003', date: '2026-08-07', opDate: '2026-08-06', amount: -6000, label: 'CARTE X1 06/08 SUPER MARCHE 0412', details: [], counterparty: 'Super Marche', suggestedLabel: 'Super Marche', time: null, motif: '' },
    { id: 'L004', date: '2026-08-10', opDate: null, amount: -1000, label: 'COTISATION JAZZ', details: [], counterparty: '', suggestedLabel: 'Frais bancaires', time: null, motif: '' },
  ];
  return {
    format: 'pdf', bank: 'Banque Test', accountLabel: 'Compte test', periodStart: '2026-08-01', periodEnd: '2026-08-15',
    openingDate: '2026-07-31', openingBalance: 100000, closingDate: '2026-08-15', closingBalance: 140500,
    totalDebit: 9500, totalCredit: 50000, lines, checks: {}, warnings: [], fingerprint: 'empreinte-test', ...overrides,
  };
}

test('correspondances : même montant à une date proche, sinon ligne manquante ou opération en trop', () => {
  const state = stateWith({
    operations: [
      op({ id: 'pain', amount: -2500, date: '2026-08-01', label: 'Pain' }),
      op({ id: 'salaire', amount: 50000, date: '2026-08-06', label: 'Salaire août' }),
      op({ id: 'cine', amount: -900, date: '2026-08-08', label: 'Cinéma' }),
      op({ id: 'vieux', amount: -6000, date: '2026-07-20', label: 'Trop ancien' }),
      op({ id: 'simu', amount: -6000, date: '2026-08-06', simulated: true }),
      transfer(null, null, 6000, { id: 'vir', date: '2026-08-06' }),
    ],
  });
  const result = matchStatement(state, statement());
  assert.deepEqual(result.matches.map((m) => [m.lineId, m.opId, m.gap, m.sure]), [['L001', 'pain', 0, true], ['L002', 'salaire', 1, true]]);
  assert.deepEqual(result.missing, ['L003', 'L004']);
  assert.deepEqual(result.extra, ['cine'], 'seules les opérations réelles de la période, non pointées, sont « en trop »');
  assert.deepEqual(result.already, []);
});

test('correspondances : entre deux candidates, la date la plus proche gagne, puis le libellé', () => {
  const state = stateWith({
    operations: [
      op({ id: 'loin', amount: -2500, date: '2026-07-29', label: 'Boulangerie' }),
      op({ id: 'pres', amount: -2500, date: '2026-08-02', label: 'Autre chose' }),
    ],
  });
  let result = matchStatement(state, statement());
  assert.deepEqual(result.matches.map((m) => [m.lineId, m.opId, m.gap, m.sure]), [['L001', 'pres', 1, true]]);
  // à distance égale, celle dont le libellé ressemble au relevé l'emporte, et c'est signalé « à vérifier »
  const tie = stateWith({
    operations: [
      op({ id: 'a', amount: -2500, date: '2026-08-02', label: 'Autre chose' }),
      op({ id: 'b', amount: -2500, date: '2026-07-31', label: 'Boulangerie du parc' }),
    ],
  });
  result = matchStatement(tie, statement());
  assert.deepEqual(result.matches.map((m) => [m.opId, m.sure]), [['b', false]]);
  // hors de la fenêtre de dates : pas de correspondance
  const far = stateWith({ operations: [op({ id: 'x', amount: -2500, date: '2026-07-20' })] });
  assert.deepEqual(matchStatement(far, statement()).matches, []);
});

test('correspondances : deux achats identiques le même jour sont appariés un pour un', () => {
  const st = statement();
  st.lines = [
    { ...st.lines[0], id: 'L001', amount: -35, opDate: '2026-08-04', date: '2026-08-05' },
    { ...st.lines[0], id: 'L002', amount: -35, opDate: '2026-08-04', date: '2026-08-05' },
    { ...st.lines[0], id: 'L003', amount: -35, opDate: '2026-08-05', date: '2026-08-06' },
  ];
  const state = stateWith({
    operations: [
      op({ id: 'c1', amount: -35, date: '2026-08-04' }),
      op({ id: 'c2', amount: -35, date: '2026-08-04' }),
      op({ id: 'c3', amount: -35, date: '2026-08-05' }),
    ],
  });
  const result = matchStatement(state, st);
  assert.equal(result.matches.length, 3);
  assert.ok(result.matches.every((m) => m.gap === 0 && m.sure));
  assert.equal(new Set(result.matches.map((m) => m.opId)).size, 3);
  assert.deepEqual(result.matches.find((m) => m.lineId === 'L003').opId, 'c3');
});

function decideAll(state, st, extra = {}) {
  const result = matchStatement(state, st);
  const lines = {};
  for (const m of result.matches) lines[m.lineId] = { action: 'merge', opId: m.opId };
  for (const id of result.missing) lines[id] = { action: 'create', fields: proposeForLine(state, st.lines.find((l) => l.id === id)) };
  for (const id of result.already) lines[id] = { action: 'already' };
  return { lines, extras: {}, ...extra };
}

test('import complet : fusion, création, soldes de la banque retrouvés au centime', () => {
  const state = stateWith({
    tags: [{ id: 'tag_courses', name: 'Courses' }],
    operations: [
      { kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-07-01', amount: 100000, label: 'Solde de départ', auto: 'opening' },
      op({ id: 'pain', amount: -2500, date: '2026-08-01', label: 'Pain', tags: ['tag_courses'], importance: 'necessite', comment: 'pour le week-end' }),
    ],
  });
  const st = statement();
  const plan = planStatementImport(state, st, decideAll(state, st), { today: TODAY });
  const after = commit(state, plan);
  assert.deepEqual([plan.summary.merged, plan.summary.created, plan.summary.skipped], [1, 3, 0]);
  assert.equal(plan.summary.openingGap, 0);
  assert.equal(plan.summary.residual, 0);
  assert.equal(bankBalanceAt(after, '2026-08-15'), 140500);
  assert.equal(balances(after, { upTo: TODAY }).total, 140500);
  // l'opération de l'utilisateur garde ses champs et reçoit ceux de la banque
  const pain = after.operations.find((o) => o.id === 'pain');
  assert.deepEqual([pain.label, pain.comment, pain.tags, pain.date, pain.counterparty], ['Pain', 'pour le week-end', ['tag_courses'], '2026-08-01', 'Boulangerie du Parc']);
  assert.deepEqual([pain.bank.date, pain.bank.label, pain.bank.lineId], ['2026-08-03', 'CARTE X1 01/08 BOULANGERIE DU PARC', 'L001']);
  // l'opération créée porte la vraie date d'achat et la date de la banque
  const grocery = after.operations.find((o) => o.bank?.lineId === 'L003');
  assert.deepEqual([grocery.date, grocery.bank.date, grocery.amount, grocery.label, grocery.counterparty], ['2026-08-06', '2026-08-07', -6000, 'Super Marche', 'Super Marche']);
  const salary = after.operations.find((o) => o.bank?.lineId === 'L002');
  assert.equal(salary.time, '09:30');
  // fiche du relevé + constat de rapprochement sans écart
  assert.equal(after.statements.length, 1);
  assert.deepEqual([after.statements[0].matchedCount, after.statements[0].createdCount, after.statements[0].lineCount], [1, 3, 4]);
  assert.deepEqual([after.reconciliations[0].date, after.reconciliations[0].gap, after.reconciliations[0].statementId], ['2026-08-15', 0, after.statements[0].id]);
  // une règle a été retenue pour la boulangerie
  assert.deepEqual(findRule(after, 'BOULANGERIE DU PARC').tags, ['tag_courses']);
  // tout s'annule d'un bloc
  const inverse = invert(state, plan.cs);
  const undone = apply(apply(cloneState(state), plan.cs), inverse);
  assert.deepEqual(undone.operations, state.operations);
  assert.equal(undone.statements.length, 0);
});

test('import sur une appli vide : le solde précédent du relevé devient le solde de départ', () => {
  const state = stateWith();
  const st = statement();
  const plan = planStatementImport(state, st, decideAll(state, st), { today: TODAY });
  const after = commit(state, plan);
  assert.equal(plan.summary.openingGap, 100000);
  const opening = after.operations.find((o) => o.auto === 'opening');
  assert.deepEqual([opening.kind, opening.date, opening.amount, opening.label], [KIND.ADJUSTMENT, '2026-07-31', 100000, 'Solde de départ']);
  assert.equal(balances(after, { upTo: TODAY }).total, 140500);
  assert.equal(after.reconciliations[0].gap, 0);
});

test('import : un écart avant le relevé est ajusté (ou laissé, au choix)', () => {
  const state = stateWith({ operations: [{ kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-07-01', amount: 90000, auto: 'opening' }] });
  const st = statement();
  let plan = planStatementImport(state, st, decideAll(state, st), { today: TODAY });
  let after = commit(state, plan);
  assert.equal(plan.summary.openingGap, 10000);
  assert.equal(after.operations.find((o) => o.label === 'Ajustement avant relevé').amount, 10000);
  assert.equal(bankBalanceAt(after, '2026-08-15'), 140500);
  // sans ajustement d'ouverture : l'écart se retrouve à la fin, proposé comme ajustement de rapprochement
  plan = planStatementImport(state, st, decideAll(state, st, { opening: 'ignore' }), { today: TODAY });
  after = commit(state, plan);
  assert.equal(plan.summary.residual, 10000);
  assert.equal(plan.summary.closingAdjusted, true);
  assert.equal(bankBalanceAt(after, '2026-08-15'), 140500);
  assert.ok(after.reconciliations[0].adjustmentOperationId);
  // ni l'un ni l'autre : l'écart reste visible dans le constat
  plan = planStatementImport(state, st, decideAll(state, st, { opening: 'ignore', closing: 'ignore' }), { today: TODAY });
  after = commit(state, plan);
  assert.equal(after.reconciliations[0].gap, 10000);
});

test('import : les opérations « en trop » gardées expliquent l\'écart, les supprimées disparaissent', () => {
  const state = stateWith({
    operations: [
      { kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-07-01', amount: 100000, auto: 'opening' },
      op({ id: 'attente', amount: -1500, date: '2026-08-14', label: 'Restaurant pas encore débité' }),
      op({ id: 'doublon', amount: -777, date: '2026-08-09', label: 'Saisie en double' }),
    ],
  });
  const st = statement();
  const decisions = decideAll(state, st, { extras: { doublon: 'delete', attente: 'keep' } });
  const plan = planStatementImport(state, st, decisions, { today: TODAY });
  const after = commit(state, plan);
  assert.deepEqual([plan.summary.deleted, plan.summary.kept, plan.summary.pendingSum, plan.summary.residual], [1, 1, -1500, 0]);
  assert.equal(after.operations.some((o) => o.id === 'doublon'), false);
  assert.equal(after.reconciliations[0].gap, 1500, "l'écart du constat correspond à l'opération pas encore débitée");
  assert.equal(after.reconciliations[0].adjustmentOperationId, null);
  assert.equal(balances(after, { upTo: TODAY }).total, 140500 - 1500);
});

test('import : une ligne ignorée laisse un résidu, ajusté par défaut', () => {
  const state = stateWith({ operations: [{ kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-07-01', amount: 100000, auto: 'opening' }] });
  const st = statement();
  const decisions = decideAll(state, st);
  decisions.lines.L004 = { action: 'skip' };
  const plan = planStatementImport(state, st, decisions, { today: TODAY });
  const after = commit(state, plan);
  assert.equal(plan.summary.skipped, 1);
  assert.equal(plan.summary.residual, -1000);
  assert.equal(bankBalanceAt(after, '2026-08-15'), 140500);
});

test('import d\'historique : le solde d\'aujourd\'hui ne change pas quand on le demande', () => {
  // L'utilisatrice a commencé l'appli le 01/09 avec 2 000,00 € puis importe le relevé d'août.
  let state = stateWith();
  state = commit(state, planOpeningBalance(state, { date: '2026-09-01', amount: 200000 }));
  state = commit(state, { ok: true, cs: { put: { operations: [stateWith({ operations: [op({ id: 'sept', amount: -5000, date: '2026-09-05' })] }).operations[0]] }, del: {} } });
  const today = '2026-09-10';
  const st = statement();
  assert.equal(isHistoryImport(state, st), true);
  const plan = planStatementImport(state, st, decideAll(state, st, { keepCurrent: true }), { today });
  const after = commit(state, plan);
  assert.equal(balances(after, { upTo: today }).total, 195000, 'solde actuel inchangé');
  assert.equal(bankBalanceAt(after, '2026-08-15'), 140500, 'et les soldes du relevé sont exacts sur la période');
  assert.equal(plan.summary.historyShift, -140500);
  const shift = after.operations.find((o) => o.label === 'Opérations non saisies après le relevé');
  assert.deepEqual([shift.date, shift.amount], ['2026-09-01', -140500]);
  // sans l'option, les opérations importées s'ajoutent au solde
  const raw = commit(state, planStatementImport(state, st, decideAll(state, st), { today }));
  assert.equal(balances(raw, { upTo: today }).total, 195000 + 140500);
  assert.equal(isHistoryImport(stateWith(), st), false);
});

test('import : une dépense rangée dans une enveloppe trop peu garnie déclenche un complément', () => {
  const state = stateWith({
    envelopes: [{ id: 'env_courses', name: 'Courses' }],
    operations: [
      { kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-07-01', amount: 100000, auto: 'opening' },
      transfer(null, 'env_courses', 2000, { date: '2026-07-15' }),
    ],
  });
  const st = statement();
  const decisions = decideAll(state, st);
  decisions.lines.L003 = { action: 'create', fields: { label: 'Courses', envelopeId: 'env_courses' } };
  decisions.lines.L002 = { action: 'create', fields: { label: 'Salaire', envelopeId: 'env_courses' } }; // revenu : l'enveloppe est ignorée
  const plan = planStatementImport(state, st, decisions, { today: TODAY });
  const after = commit(state, plan);
  assert.deepEqual(plan.summary.topups, [{ envelopeId: 'env_courses', amount: 4000, date: '2026-08-06' }]);
  const b = balances(after, { upTo: TODAY });
  assert.equal(b.envelopes.env_courses, 0);
  assert.equal(b.total, 140500);
  assert.equal(after.operations.find((o) => o.bank?.lineId === 'L002').envelopeId, null);
});

test('import : montant corrigé lors d\'une association manuelle, et refus d\'une association impossible', () => {
  const state = stateWith({
    operations: [
      { kind: KIND.ADJUSTMENT, id: 'depart', date: '2026-07-01', amount: 100000, auto: 'opening' },
      op({ id: 'approx', amount: -5900, date: '2026-08-06', label: 'Courses (montant de tête)' }),
    ],
  });
  const st = statement();
  assert.deepEqual(matchStatement(state, st).matches, [], 'montants différents : pas de correspondance automatique');
  assert.deepEqual(mergePreview(state.operations[1], st.lines[2]).map((x) => x.field), ['counterparty', 'amount']);
  const decisions = decideAll(state, st);
  decisions.lines.L003 = { action: 'merge', opId: 'approx' };
  const after = commit(state, planStatementImport(state, st, decisions, { today: TODAY }));
  assert.equal(after.operations.find((o) => o.id === 'approx').amount, -6000);
  assert.equal(bankBalanceAt(after, '2026-08-15'), 140500);
  // la même opération associée deux fois, ou une opération disparue : refus
  decisions.lines.L004 = { action: 'merge', opId: 'approx' };
  assert.equal(planStatementImport(state, st, decisions, { today: TODAY }).ok, false);
  decisions.lines.L004 = { action: 'merge', opId: 'inconnue' };
  assert.equal(planStatementImport(state, st, decisions, { today: TODAY }).ok, false);
  assert.equal(planStatementImport(state, { ...st, lines: [] }, {}, { today: TODAY }).ok, false);
});

test('ré-import : un relevé déjà importé est reconnu, ses lignes ne sont pas dupliquées', () => {
  const state = stateWith();
  const st = statement();
  const after = commit(state, planStatementImport(state, st, decideAll(state, st), { today: TODAY }));
  assert.equal(findSameStatement(after, st).id, after.statements[0].id);
  assert.equal(findSameStatement(state, st), null);
  // un autre fichier qui recouvre la même période (ex. export CSV) : les lignes sont reconnues une à une
  const overlap = statement({ fingerprint: 'autre', lines: [...statement().lines, { id: 'L005', date: '2026-08-12', opDate: null, amount: -300, label: 'NOUVELLE LIGNE', details: [], counterparty: '', suggestedLabel: 'Nouvelle', time: null, motif: '' }] });
  const again = matchStatement(after, overlap);
  assert.deepEqual(again.already, ['L001', 'L002', 'L003', 'L004']);
  assert.deepEqual(again.missing, ['L005']);
  assert.deepEqual(again.extra, []);
});

test('archives : retirer un relevé dé-pointe ses opérations sans les supprimer', () => {
  const state = stateWith();
  const st = statement();
  const after = commit(state, planStatementImport(state, st, decideAll(state, st), { today: TODAY, file: { id: 'fic_1', kind: 'statement', name: 'releve.pdf', mime: 'application/pdf', size: 10, createdAt: 'x' } }));
  assert.equal(after.files.length, 1);
  const removed = commit(after, planDeleteStatement(after, after.statements[0].id));
  assert.equal(removed.statements.length, 0);
  assert.equal(removed.files.length, 0);
  assert.equal(removed.operations.filter((o) => o.bank).length, 0);
  assert.equal(removed.operations.length, after.operations.length);
  assert.equal(removed.reconciliations[0].statementId, null);
  assert.equal(planDeleteStatement(removed, 'inconnu').ok, false);
});

test('règles automatiques : apprises à l\'import, proposées ensuite, modifiables et supprimables', () => {
  const state = stateWith({
    tags: [{ id: 'tag_courses', name: 'Courses' }, { id: 'tag_resto', name: 'Restaurant' }],
    envelopes: [{ id: 'env_a', name: 'Alimentation' }, { id: 'env_fermee', name: 'Vieux projet', closed: true }],
    operations: [op({ id: 'h1', amount: -1200, date: '2026-07-02', label: 'Déjeuner', counterparty: 'Auberge du Pont', tags: ['tag_resto'], importance: 'confort' })],
  });
  // sans règle : on s'appuie sur la dernière opération du même tiers
  assert.deepEqual(suggestFor(state, { counterparty: 'AUBERGE DU PONT' }), { label: 'Déjeuner', tags: ['tag_resto'], envelopeId: null, importance: 'confort', source: 'history' });
  assert.equal(suggestFor(state, { counterparty: 'Inconnu au bataillon' }), null);
  // création manuelle d'une règle
  let plan = planSaveRule(state, { display: 'Super Marché Bio', label: 'Courses', tags: ['tag_courses'], envelopeId: 'env_a', importance: 'necessite' });
  let next = commit(state, plan);
  assert.equal(plan.rule.key, 'super marche bio');
  assert.equal(planSaveRule(next, { display: 'SUPER MARCHE BIO 0412' }).ok, false, 'un seul tiers par règle (les numéros ne comptent pas)');
  assert.equal(planSaveRule(next, { display: '   ' }).ok, false);
  const hint = suggestFor(next, { counterparty: 'Super Marche Bio 0412 Paris' });
  assert.deepEqual([hint.source, hint.label, hint.tags, hint.envelopeId, hint.importance], ['rule', 'Courses', ['tag_courses'], 'env_a', 'necessite']);
  // une règle qui pointe une enveloppe clôturée ne la propose plus
  next = commit(next, planSaveRule(next, { id: plan.rule.id, envelopeId: 'env_fermee' }));
  assert.equal(suggestFor(next, { counterparty: 'Super Marché Bio' }).envelopeId, null);
  next = commit(next, planDeleteRule(next, plan.rule.id));
  assert.equal(next.rules.length, 0);
  assert.equal(planDeleteRule(next, plan.rule.id).ok, false);
});
