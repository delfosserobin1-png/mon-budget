// Tests du magasin de données (validation, annulation, pièces jointes, ménage) et des sauvegardes.
// Le stockage utilisé ici est la version « en mémoire » ; IndexedDB est testé dans le navigateur (tests e2e).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MemoryAdapter, openDb, readLegacyV1 } from '../../www/js/data/db.js';
import { Store, UNDO_DEPTH } from '../../www/js/data/store.js';
import { buildBackupJson, buildBackupZip, readBackupFile, applyImport, autoBackup, extensionFor, backupReminder } from '../../www/js/data/backup.js';
import { planSaveOperation, planDeleteOperations } from '../../www/js/core/operations.js';
import { planSaveRecurring } from '../../www/js/core/recurring.js';
import { planSaveTag } from '../../www/js/core/tags.js';
import { put, emptyChangeset } from '../../www/js/core/changeset.js';
import { safeFileName, toBase64, isNative } from '../../www/js/platform/platform.js';
import { unzip, utf8 } from '../../www/js/io/zip.js';

const TODAY = '2026-11-15';
const fresh = async () => new Store(new MemoryAdapter()).init();
const addOp = (store, fields) => {
  const plan = planSaveOperation(store.state, { date: TODAY, amount: -1000, label: 'Test', ...fields }, { today: TODAY });
  assert.equal(plan.ok, true);
  return store.commit(plan.cs, { label: 'Opération ajoutée' }).then(() => plan.op);
};

test('magasin : une modification validée est écrite sur l\'appareil et relue au redémarrage', async () => {
  const db = new MemoryAdapter();
  const store = await new Store(db).init();
  assert.equal(store.isEmpty, true);
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);
  const op = await addOp(store, { label: 'Café' });
  await store.setSetting('theme', 'dark');
  assert.equal(notified, 2);
  unsubscribe();
  const again = await new Store(db).init();
  assert.deepEqual(again.state.operations.map((o) => o.id), [op.id]);
  assert.equal(again.setting('theme'), 'dark');
  assert.equal(again.setting('absent', 'défaut'), 'défaut');
  assert.equal(again.isEmpty, false);
  await store.setSetting('theme', undefined);
  assert.equal((await new Store(db).init()).setting('theme', 'auto'), 'auto');
  assert.equal(await store.commit(emptyChangeset()), false, 'un lot vide ne fait rien');
  assert.equal(notified, 2);
});

test('magasin : annuler remet exactement l\'état précédent, sur 5 actions au plus', async () => {
  const store = await fresh();
  const first = await addOp(store, { label: 'Première' });
  await store.commit(planSaveOperation(store.state, { ...first, label: 'Modifiée' }, { today: TODAY }).cs, { label: 'Opération modifiée' });
  await store.commit(planDeleteOperations(store.state, [first.id], { today: TODAY }).cs, { label: 'Opération supprimée' });
  assert.equal(store.state.operations.length, 0);
  assert.equal(store.undoLabel, 'Opération supprimée');
  assert.equal(await store.undo(), 'Opération supprimée');
  assert.equal(store.state.operations[0].label, 'Modifiée');
  assert.equal(await store.undo(), 'Opération modifiée');
  assert.equal(store.state.operations[0].label, 'Première');
  assert.equal(await store.undo(), 'Opération ajoutée');
  assert.equal(store.state.operations.length, 0);
  assert.equal(await store.undo(), null);
  assert.equal(store.canUndo, false);
  for (let i = 0; i < UNDO_DEPTH + 3; i++) await addOp(store, { label: `n°${i}` });
  let undone = 0;
  while (await store.undo()) undone++;
  assert.equal(undone, UNDO_DEPTH);
  assert.equal(store.state.operations.length, 3);
  const persisted = await new Store(store.db).init();
  assert.equal(persisted.state.operations.length, 3, 'les annulations sont, elles aussi, écrites sur l\'appareil');
});

test('magasin : les mises à jour automatiques ne polluent pas la pile d\'annulation', async () => {
  const store = await fresh();
  const plan = planSaveRecurring(store.state, { kind: 'operation', label: 'Loyer', amount: -65000, frequency: 'monthly', startDate: '2026-12-05' }, { today: TODAY });
  await store.commit(plan.cs, { label: 'Récurrence créée' });
  const before = store.state.operations.length;
  assert.ok(before >= 5, 'les échéances à venir sont créées');
  assert.equal(await store.tickRecurring('2026-12-06'), true);
  assert.equal(store.state.operations.find((o) => o.date === '2026-12-05').simulated, false, 'l\'échéance arrivée à sa date est devenue réelle');
  assert.equal(store.undoLabel, 'Récurrence créée');
  assert.equal(await store.tickRecurring('2026-12-06'), false, 'rien à refaire le même jour');
});

test('pièces jointes : enregistrement, lecture, ménage des orphelines après 24 h', async () => {
  const db = new MemoryAdapter();
  let store = await new Store(db).init();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const used = await store.saveBlob(bytes, { kind: 'photo', name: 'ticket.jpg', mime: 'image/jpeg' });
  const orphan = await store.saveBlob(bytes, { kind: 'photo', name: 'abandon.jpg', mime: 'image/jpeg' });
  const inDraft = await store.saveBlob(bytes, { kind: 'photo', name: 'brouillon.jpg', mime: 'image/jpeg' });
  const stray = await store.saveBlob(bytes, { kind: 'photo', name: 'sans-fiche.jpg', mime: 'image/jpeg' });
  assert.deepEqual([used.size, used.mime, used.kind], [4, 'image/jpeg', 'photo']);
  assert.deepEqual([...(await store.readBlob(used.id)).bytes], [1, 2, 3, 4]);
  assert.equal(await store.readBlob('inconnu'), null);
  const plan = planSaveOperation(store.state, { date: TODAY, amount: -500, label: 'Avec photo', photoIds: [used.id] }, { today: TODAY });
  put(plan.cs, 'files', used, orphan, inDraft);
  await store.commit(plan.cs);
  await store.setSetting('draft:operation', { photoIds: [inDraft.id] });
  assert.equal(await store.collectGarbage(Date.now()), 0, "pendant la même session, rien n'est retiré : un formulaire ouvert peut encore s'en servir");
  assert.ok(await store.readBlob(stray.id));
  store = await new Store(db).init(); // l'appli est fermée puis rouverte
  assert.equal(await store.collectGarbage(Date.now()), 1, 'au démarrage suivant : seul le contenu sans fiche est retiré');
  assert.equal(await store.readBlob(stray.id), null);
  assert.ok(await store.readBlob(orphan.id));
  assert.equal(await store.collectGarbage(Date.now() + 25 * 3600 * 1000), 1, 'après 24 h : l\'orpheline part, pas la photo utilisée ni celle du brouillon');
  assert.equal(await store.readBlob(orphan.id), null);
  assert.ok(await store.readBlob(used.id));
  assert.ok(await store.readBlob(inDraft.id));
  assert.deepEqual(store.state.files.map((f) => f.id).sort(), [used.id, inDraft.id].sort());
});

test('sauvegarde ZIP : données + pièces jointes, restaurées à l\'identique sur un appareil vide', async () => {
  const store = await fresh();
  const tag = planSaveTag(store.state, { name: 'Courses' });
  await store.commit(tag.cs);
  const photo = await store.saveBlob(new Uint8Array([9, 8, 7]), { kind: 'photo', name: 'ticket.jpg', mime: 'image/jpeg' });
  const plan = planSaveOperation(store.state, { date: TODAY, amount: -2350, label: 'Marché', tags: [tag.tag.id], photoIds: [photo.id] }, { today: TODAY });
  put(plan.cs, 'files', photo);
  await store.commit(plan.cs);
  const zip = await buildBackupZip(store, { appVersion: '2.0.0', now: new Date('2026-11-15T10:00:00Z') });
  const names = (await unzip(zip)).map((f) => f.name);
  assert.deepEqual(names, ['mon-budget.json', `pieces/${photo.id}.jpg`, 'LISEZ-MOI.txt']);

  const target = await fresh();
  await addOp(target, { label: 'Sera remplacée' });
  const read = await readBackupFile({ name: 'sauvegarde.zip', bytes: zip });
  assert.equal(read.ok, true);
  const result = await applyImport(target, read, 'replace');
  assert.equal(result.added.operations, 1);
  assert.deepEqual(target.state.operations, store.state.operations);
  assert.deepEqual(target.state.tags, store.state.tags);
  assert.deepEqual([...(await target.readBlob(photo.id)).bytes], [9, 8, 7]);
  assert.equal(target.canUndo, false, 'un remplacement complet ne s\'annule pas');
});

test('sauvegarde JSON : import « ajouter » annulable, photos absentes détachées', async () => {
  const source = await fresh();
  const photo = await source.saveBlob(new Uint8Array([1]), { mime: 'image/png' });
  const plan = planSaveOperation(source.state, { date: TODAY, amount: -100, label: 'Avec photo', photoIds: [photo.id] }, { today: TODAY });
  put(plan.cs, 'files', photo);
  await source.commit(plan.cs);
  const json = buildBackupJson(source, { appVersion: '2.0.0' });
  const target = await fresh();
  const mine = await addOp(target, { label: 'La mienne' });
  const read = await readBackupFile({ name: 'mon-budget.json', bytes: utf8(json) });
  const result = await applyImport(target, read, 'merge');
  assert.deepEqual([result.added.operations, result.added.files], [1, 0]);
  assert.equal(target.state.operations.length, 2);
  assert.deepEqual(target.state.operations.find((o) => o.label === 'Avec photo').photoIds, []);
  assert.equal(await target.undo(), 'Import ajouté');
  assert.deepEqual(target.state.operations.map((o) => o.id), [mine.id]);
});

test('sauvegarde : reprise d\'un fichier de l\'ancienne version, photo comprise', async () => {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/export-v1.json', import.meta.url))));
  const read = await readBackupFile({ name: 'ancien.json', bytes });
  assert.equal(read.ok, true);
  assert.equal(read.read.source, 'v1');
  assert.equal(read.blobs.size, 1);
  const store = await fresh();
  const result = await applyImport(store, read, 'merge');
  assert.deepEqual([result.added.operations, result.added.envelopes, result.added.files], [13, 3, 1]);
  const withPhoto = store.state.operations.find((o) => o.photoIds.length);
  const blob = await store.readBlob(withPhoto.photoIds[0]);
  assert.equal(blob.mime, 'image/png');
  assert.equal(blob.bytes[1], 0x50, 'c\'est bien un PNG (‰PNG)');
});

test('sauvegarde : fichiers illisibles refusés proprement', async () => {
  assert.match((await readBackupFile({ name: 'x.json', bytes: utf8('{pas du json') })).error, /lisible/);
  assert.match((await readBackupFile({ name: 'x.json', bytes: utf8('{"autre":"chose"}') })).error, /sauvegarde de Mon Budget/);
  const { zipStore } = await import('../../www/js/io/zip.js');
  assert.match((await readBackupFile({ name: 'x.zip', bytes: zipStore([{ name: 'photo.jpg', data: 'x' }]) })).error, /introuvable/);
});

test('plateforme : hors Android, pas de sauvegarde automatique ; noms de fichiers sûrs', async () => {
  assert.equal(isNative(), false);
  const store = await fresh();
  assert.deepEqual(await autoBackup(store, { appVersion: '2.0.0', today: TODAY }), { done: false, reason: 'unavailable' });
  assert.equal(safeFileName('Relevé août 2026 : n°8/bis?.pdf'), 'Releve aout 2026 - n-8-bis-.pdf');
  assert.equal(safeFileName('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeFileName(''), 'fichier');
  assert.equal(toBase64(new Uint8Array([77, 97, 110])), 'TWFu');
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('inconnu/type'), 'bin');
});

test('plateforme : sauvegarde automatique Android (module Filesystem simulé), rotation des 7 dernières', async () => {
  const written = new Map();
  for (let d = 1; d <= 8; d++) written.set(`MonBudget/Sauvegardes/mon-budget-auto-2026-11-0${d}.json`, 'ancienne');
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: {
        writeFile: async ({ path, data, directory }) => {
          assert.equal(directory, 'DOCUMENTS');
          written.set(path, Buffer.from(data, 'base64').toString('utf8'));
          return { uri: `file:///documents/${path}` };
        },
        readdir: async ({ path }) => ({ files: [...written.keys()].filter((p) => p.startsWith(path + '/')).map((p) => ({ name: p.slice(path.length + 1) })) }),
        deleteFile: async ({ path }) => void written.delete(path),
      },
    },
  };
  try {
    const store = await fresh();
    assert.equal((await autoBackup(store, { appVersion: '2.0.0', today: TODAY })).reason, 'empty');
    await addOp(store, { label: 'À sauvegarder' });
    const report = await autoBackup(store, { appVersion: '2.0.0', today: TODAY });
    assert.deepEqual(report, { done: true, path: `Documents/MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json` });
    const saved = JSON.parse(written.get(`MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json`));
    assert.equal(saved.data.operations[0].label, 'À sauvegarder');
    assert.equal([...written.keys()].length, 7, 'les plus anciennes sont supprimées');
    assert.equal(written.has('MonBudget/Sauvegardes/mon-budget-auto-2026-11-01.json'), false);
    assert.equal((await autoBackup(store, { appVersion: '2.0.0', today: TODAY })).reason, 'fresh');
    await addOp(store, { label: 'Nouvelle' });
    assert.equal((await autoBackup(store, { appVersion: '2.0.0', today: TODAY })).done, true);
    // Une panne d'écriture ne casse rien et laisse une trace consultable
    globalThis.Capacitor.Plugins.Filesystem.writeFile = async () => {
      throw new Error('Permission refusée');
    };
    const failed = await autoBackup(store, { appVersion: '2.0.0', today: TODAY, force: true });
    assert.deepEqual([failed.done, failed.reason, store.setting('autoBackupError')], [false, 'error', 'Permission refusée']);
  } finally {
    delete globalThis.Capacitor;
  }
});

test('stockage : sans IndexedDB on retombe sur la mémoire, et l\'ancienne base absente ne gêne pas', async () => {
  const db = await openDb({ factory: null });
  assert.equal(db.kind, 'memory');
  assert.equal(await readLegacyV1({ factory: null }), null);
  const broken = { open: () => { throw new Error('refusé'); } };
  assert.equal((await openDb({ factory: broken })).kind, 'memory');
  assert.equal(await readLegacyV1({ factory: { databases: async () => [{ name: 'autre' }] } }), null);
});

test('rappel de sauvegarde : jamais sans données, après 14 jours la première fois, puis tous les 30 jours', () => {
  const DAY = 86400000;
  const now = Date.parse('2026-11-15T10:00:00Z');
  const ago = (days) => new Date(now - days * DAY).toISOString();
  assert.equal(backupReminder({ hasData: false, firstUseAt: ago(400), now }), null, 'rien à sauvegarder');
  assert.equal(backupReminder({ hasData: true, firstUseAt: ago(13), now }), null, 'on laisse deux semaines de tranquillité');
  assert.deepEqual(backupReminder({ hasData: true, firstUseAt: ago(14), now }), { never: true, days: 14 });
  assert.equal(backupReminder({ hasData: true, firstUseAt: ago(200), lastBackupAt: ago(29), now }), null);
  assert.deepEqual(backupReminder({ hasData: true, firstUseAt: ago(200), lastBackupAt: ago(45), now }), { never: false, days: 45 });
  assert.equal(backupReminder({ hasData: true, now }), null, 'sans date de début, pas de rappel hasardeux');
});
