// Tests de l'export / import et de la reprise des données de l'ancienne version (v1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stateWith, commit, balances, op, transfer } from './helpers.js';
import { KIND, emptyState, STORES } from '../../www/js/core/schema.js';
import { exportData, readImport, planImport, migrateV1, decodeDataUrl, countsOf } from '../../www/js/core/portable.js';
import { occurrenceDate, tick } from '../../www/js/core/recurring.js';
import { apply, cloneState } from '../../www/js/core/changeset.js';

const v1 = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/export-v1.json', import.meta.url)), 'utf8'));

function sample() {
  return stateWith({
    tags: [{ id: 'tag_a', name: 'Courses', color: 'vert' }],
    envelopes: [{ id: 'env_a', name: 'Vacances', goalAmount: 50000 }],
    operations: [
      op({ id: 'op_1', amount: 200000, date: '2026-11-01', label: 'Salaire' }),
      op({ id: 'op_2', amount: -4550, date: '2026-11-03', label: 'Courses', tags: ['tag_a'], photoIds: ['fic_1'] }),
      transfer(null, 'env_a', 30000, { id: 'op_3', date: '2026-11-02' }),
      op({ id: 'op_4', amount: -10000, date: '2026-11-05', label: 'Billets', envelopeId: 'env_a' }),
    ],
  });
}

test('export puis import « remplacer » : la base est restituée à l\'identique', () => {
  const state = sample();
  state.files = [{ id: 'fic_1', kind: 'photo', name: 'ticket.jpg', mime: 'image/jpeg', size: 10, createdAt: '2026-11-03T10:00:00.000Z' }];
  const json = JSON.parse(JSON.stringify(exportData(state, { appVersion: '2.0.0', now: new Date('2026-11-15T10:00:00Z') })));
  assert.deepEqual([json.format, json.schema, json.appVersion, json.exportedAt], ['mon-budget', 2, '2.0.0', '2026-11-15T10:00:00.000Z']);
  const read = readImport(json);
  assert.equal(read.ok, true);
  assert.equal(read.source, 'v2');
  const other = stateWith({ operations: [op({ id: 'autre', amount: -1 })], tags: [{ id: 'tag_z', name: 'À jeter' }] });
  const plan = planImport(other, read.state, 'replace', { availableFiles: new Set(['fic_1']) });
  const after = commit(other, plan);
  for (const store of STORES) assert.deepEqual(after[store], state[store], store);
  assert.equal(plan.added.operations, 4);
});

test('import : les photos dont on n\'a pas le contenu sont détachées, jamais de lien mort', () => {
  const state = sample();
  state.files = [{ id: 'fic_1', kind: 'photo', name: 'ticket.jpg', mime: 'image/jpeg', size: 10, createdAt: 'x' }];
  const read = readImport(JSON.parse(JSON.stringify(exportData(state))));
  const after = commit(emptyState(), planImport(emptyState(), read.state, 'replace', { availableFiles: new Set() }));
  assert.equal(after.files.length, 0);
  assert.deepEqual(after.operations.find((o) => o.id === 'op_2').photoIds, []);
});

test('import « ajouter » : rien n\'est écrasé, les doublons sont ignorés, tags et enveloppes fusionnés par nom', () => {
  const current = stateWith({
    tags: [{ id: 'tag_mien', name: 'courses' }],
    envelopes: [{ id: 'env_mienne', name: 'VACANCES' }],
    operations: [op({ id: 'op_1', amount: 123, date: '2026-10-01', label: 'Ma version, à garder' })],
  });
  const read = readImport(JSON.parse(JSON.stringify(exportData(sample()))));
  const plan = planImport(current, read.state, 'merge');
  const after = commit(current, plan);
  assert.deepEqual([plan.added.operations, plan.skipped.operations, plan.added.tags, plan.skipped.tags, plan.added.envelopes], [3, 1, 0, 1, 0]);
  assert.equal(after.operations.find((o) => o.id === 'op_1').label, 'Ma version, à garder');
  assert.deepEqual(after.operations.find((o) => o.id === 'op_2').tags, ['tag_mien'], 'le tag du fichier est remplacé par celui qui porte le même nom');
  assert.equal(after.operations.find((o) => o.id === 'op_3').to, 'env_mienne');
  assert.equal(after.operations.find((o) => o.id === 'op_4').envelopeId, 'env_mienne');
  assert.equal(after.tags.length, 1);
  assert.equal(after.envelopes.length, 1);
  // importer deux fois le même fichier n'ajoute rien la seconde fois
  const twice = planImport(after, read.state, 'merge');
  assert.equal(twice.added.operations + twice.added.tags + twice.added.envelopes + twice.added.recurring, 0);
});

test('import : fichiers étrangers, incomplets ou trop récents refusés avec un message', () => {
  assert.equal(readImport(null).ok, false);
  assert.equal(readImport({ hello: 'world' }).ok, false);
  assert.equal(readImport([1, 2]).ok, false);
  assert.match(readImport({ format: 'mon-budget', schema: 99, data: {} }).error, /plus récente/);
  assert.match(readImport({ format: 'mon-budget', schema: 2 }).error, /incomplète/);
});

test('import : les données abîmées sont remises d\'équerre (liens inconnus retirés, doublons d\'identifiant ignorés)', () => {
  const read = readImport({
    format: 'mon-budget',
    schema: 2,
    data: {
      operations: [
        { id: 'a', date: '2026-11-01', amount: -100, tags: ['fantome'], envelopeId: 'fantome', recurringId: 'fantome', photoIds: ['fantome'] },
        { id: 'a', date: '2026-11-02', amount: -200 },
        { id: 'b', date: 'pas une date', amount: -300 },
        { id: 'c', kind: 'transfer', date: '2026-11-01', amount: 50, from: 'fantome', to: null },
        'pas un objet',
      ],
      envelopes: 'pas une liste',
    },
  });
  assert.equal(read.ok, true);
  assert.deepEqual(read.state.operations.map((o) => o.id), ['a']);
  const a = read.state.operations[0];
  assert.deepEqual([a.amount, a.tags, a.envelopeId, a.recurringId, a.photoIds], [-100, [], null, null, []]);
});

test('reprise v1 : montants en centimes, virements, simulations, récurrences, rapprochement, photo', () => {
  const read = readImport(v1);
  assert.equal(read.ok, true);
  assert.equal(read.source, 'v1');
  const s = read.state;
  assert.deepEqual(countsOf(s), { operations: 13, envelopes: 3, tags: 3, recurring: 3, reconciliations: 1, statements: 0, rules: 0, bugReports: 0, files: 1 });
  const byId = (id) => s.operations.find((o) => o.id === id);
  assert.deepEqual([byId('op_test02').amount, byId('op_test02').label, byId('op_test02').counterparty, byId('op_test02').tags], [-8550, 'Courses', 'Supermarché Test', ['tag_test01']]);
  assert.deepEqual([byId('op_test08').kind, byId('op_test08').from, byId('op_test08').to, byId('op_test08').amount, byId('op_test08').label], [KIND.TRANSFER, null, 'env_test01', 50000, '']);
  assert.deepEqual([byId('op_test10').from, byId('op_test10').to], ['env_test01', 'env_test02']);
  assert.deepEqual([byId('op_test05').simulated, byId('op_test05').checked, byId('op_test06').checked], [true, true, false]);
  assert.deepEqual([byId('op_test13').kind, byId('op_test13').amount], [KIND.ADJUSTMENT, 1240]);
  assert.equal(byId('op_test07').envelopeId, 'env_test01');
  assert.equal(byId('op_test03').photoIds.length, 1);
  assert.equal(read.photos.length, 1);
  assert.equal(read.photos[0].fileId, byId('op_test03').photoIds[0]);
  assert.equal(decodeDataUrl(read.photos[0].dataUrl).mime, 'image/png');
  assert.deepEqual([s.reconciliations[0].realBalance, s.reconciliations[0].computedBalance, s.reconciliations[0].gap, s.reconciliations[0].adjustmentOperationId], [150000, 148760, 1240, 'op_test13']);
  assert.equal(s.envelopes.find((e) => e.id === 'env_test03').closed, true);
  assert.equal(new Set(s.tags.map((t) => t.color)).size, 3, 'les anciennes couleurs (toutes identiques) sont remplacées par des couleurs distinctes');
  // Récurrences : la prochaine échéance à générer suit la dernière générée par l'ancienne version
  const salary = s.recurring.find((r) => r.id === 'rec_test01');
  assert.deepEqual([salary.kind, salary.amount, salary.nextK, occurrenceDate(salary, salary.nextK)], [KIND.OPERATION, 220000, 2, '2026-08-16']);
  const saving = s.recurring.find((r) => r.id === 'rec_test02');
  assert.deepEqual([saving.kind, saving.from, saving.to, saving.amount], [KIND.TRANSFER, null, 'env_test02', 10000]);
  assert.equal(s.recurring.find((r) => r.id === 'rec_test03').active, false);
  // Soldes au 15-08-2026, recalculés à la main depuis le fichier v1
  const b = balances(s, { upTo: '2026-08-15' });
  assert.equal(b.total, 220000 - 8550 - 4500 - 3000 - 12000 + 220000 + 1240);
  assert.equal(b.envelopes.env_test01, 50000 - 12000 - 2000);
  assert.equal(b.envelopes.env_test02, 10000 - 5000 + 2000);
});

test('reprise v1 : après import, le moteur de récurrences ne recrée aucune échéance déjà présente', () => {
  const read = readImport(v1);
  const state = commit(emptyState(), planImport(emptyState(), read.state, 'replace', { availableFiles: new Set(read.photos.map((p) => p.fileId)) }));
  const before = state.operations.filter((o) => o.recurringId === 'rec_test01').map((o) => o.date).sort();
  const after = apply(cloneState(state), tick(state, { today: '2026-08-15' }));
  const dates = after.operations.filter((o) => o.recurringId === 'rec_test01').map((o) => o.date).sort();
  assert.deepEqual(before, ['2026-07-16']);
  assert.equal(new Set(dates).size, dates.length, 'aucune date en double');
  assert.deepEqual(dates.slice(0, 3), ['2026-07-16', '2026-08-16', '2026-09-16']);
});

test('reprise v1 : un ancien « + » direct dans une enveloppe devient revenu + virement', () => {
  const { state } = migrateV1({
    operations: [{ id: 'x', date: '2026-01-10', amount: 50, motif: 'Cadeau', envelopeId: 'e1', isTransfer: false, tags: [] }],
    envelopes: [{ id: 'e1', name: 'Projet' }],
    tags: [],
    recurring: [],
    reconciliation: [],
  });
  assert.equal(state.operations.length, 2);
  const b = balances(state, { upTo: '2026-12-31' });
  assert.deepEqual([b.total, b.available, b.envelopes.e1], [5000, 0, 5000]);
});

test('decodeDataUrl : base64 et texte, entrée invalide', () => {
  assert.deepEqual([...decodeDataUrl('data:text/plain;base64,QUJD').bytes], [65, 66, 67]);
  assert.equal(decodeDataUrl('n\'importe quoi'), null);
});
