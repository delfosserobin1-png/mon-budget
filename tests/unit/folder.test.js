// Le dossier du téléphone de l'appli installée (PWA) : choix, autorisation, écriture, et ce que
// les sauvegardes en font. Le « dossier » est ici un faux, en mémoire, qui imite celui du navigateur.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../www/js/data/db.js';
import { Store } from '../../www/js/data/store.js';
import { autoBackup, mirrorFile, AUTO_BACKUPS_KEPT } from '../../www/js/data/backup.js';
import { planSaveOperation } from '../../www/js/core/operations.js';
import { allowFolder, chooseFolder, deleteFolderFile, folderBlocked, folderInfo, folderLabel, folderReady, folderSupported, forgetFolder, initFolder, listFolderFiles, writeFolderFile } from '../../www/js/platform/folder.js';
import { deleteDocument, filesBlocked, filesPlace, filesTarget, listDocuments, saveFile, writeToDocuments } from '../../www/js/platform/platform.js';

const fail = (name, message = name) => new DOMException(message, name);

/** Faux dossier : mêmes méthodes que celui que le navigateur confie à l'appli. */
class FakeDir {
  constructor(name, shared = { permission: 'granted', afterRequest: 'granted', requests: 0, writeError: null }) {
    this.kind = 'directory';
    this.name = name;
    this.shared = shared;
    this.children = new Map();
  }
  async queryPermission() {
    return this.shared.permission;
  }
  async requestPermission() {
    this.shared.requests++;
    this.shared.permission = this.shared.afterRequest;
    return this.shared.permission;
  }
  guard() {
    if (this.shared.permission !== 'granted') throw fail('NotAllowedError');
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    this.guard();
    if (!this.children.has(name)) {
      if (!create) throw fail('NotFoundError');
      this.children.set(name, new FakeDir(name, this.shared));
    }
    const child = this.children.get(name);
    if (child.kind !== 'directory') throw fail('TypeMismatchError');
    return child;
  }
  async getFileHandle(name, { create = false } = {}) {
    this.guard();
    if (!this.children.has(name)) {
      if (!create) throw fail('NotFoundError');
      this.children.set(name, { kind: 'file', name, bytes: null, shared: this.shared });
    }
    const file = this.children.get(name);
    return {
      kind: 'file',
      name,
      async createWritable() {
        let pending = null;
        return {
          async write(data) {
            if (file.shared.writeError) throw file.shared.writeError;
            pending = data instanceof Uint8Array ? data.slice() : new TextEncoder().encode(String(data));
          },
          async close() {
            file.bytes = pending;
          },
          async abort() {
            pending = null;
          },
        };
      },
    };
  }
  async removeEntry(name) {
    this.guard();
    if (!this.children.delete(name)) throw fail('NotFoundError');
  }
  async *entries() {
    this.guard();
    for (const [name, child] of this.children) yield [name, child];
  }
  /** Arborescence sous forme de chemins (pour les vérifications). */
  tree(prefix = '') {
    const out = [];
    for (const [name, child] of this.children) {
      if (child.kind === 'directory') out.push(...child.tree(`${prefix}${name}/`));
      else if (child.bytes) out.push(`${prefix}${name}`);
    }
    return out.sort();
  }
  text(path) {
    let node = this;
    for (const part of path.split('/')) node = node.children.get(part);
    return new TextDecoder().decode(node.bytes);
  }
}

const TODAY = '2026-11-15';
const pick = (dir) => {
  globalThis.showDirectoryPicker = async () => dir;
};

beforeEach(() => {
  forgetFolder();
  delete globalThis.showDirectoryPicker;
});

test('sans sélecteur de dossier (navigateur ancien) : rien n’est proposé, les fichiers seront téléchargés', async () => {
  assert.equal(folderSupported(), false);
  await assert.rejects(chooseFolder(), /ne permet pas de choisir un dossier/);
  assert.deepEqual(folderInfo(), { supported: false, linked: false, name: '', label: '', permission: 'none', ready: false, linkedAt: null });
  assert.equal(filesTarget(), null);
  assert.equal(filesPlace(), '');
  assert.equal(filesBlocked(), false);
  await assert.rejects(writeToDocuments('Exports', 'a.txt', 'x'), /indisponible/);
  assert.deepEqual(await listDocuments('Exports'), []);
  await assert.rejects(writeFolderFile('Exports', 'a.txt', new Uint8Array([1])), /Aucun dossier/);
});

test('choisir un dossier : l’appli y crée « MonBudget » et ses sous-dossiers, écrit, liste, supprime', async () => {
  const documents = new FakeDir('Documents');
  pick(documents);
  assert.equal(folderSupported(), true);
  const record = await chooseFolder();
  assert.equal(record.handle, documents);
  assert.equal(record.name, 'Documents');
  assert.match(record.linkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual([folderReady(), folderBlocked(), folderLabel(), filesTarget(), filesPlace()], [true, false, 'Documents/MonBudget', 'folder', 'Documents/MonBudget']);

  assert.equal(await writeFolderFile('Sauvegardes', 'a.json', new TextEncoder().encode('{"a":1}')), 'Documents/MonBudget/Sauvegardes/a.json');
  assert.equal(await writeToDocuments('Pieces-jointes/2026', 'Ticket été n°1 ?.jpg', new Uint8Array([1, 2, 3])), 'Documents/MonBudget/Pieces-jointes/2026/Ticket ete n-1 -.jpg');
  assert.deepEqual(documents.tree(), ['MonBudget/Pieces-jointes/2026/Ticket ete n-1 -.jpg', 'MonBudget/Sauvegardes/a.json']);
  assert.equal(documents.text('MonBudget/Sauvegardes/a.json'), '{"a":1}');
  await writeFolderFile('Sauvegardes', 'a.json', new TextEncoder().encode('{"a":2}'));
  assert.equal(documents.text('MonBudget/Sauvegardes/a.json'), '{"a":2}', 'réécrire remplace');

  assert.deepEqual(await listFolderFiles('Sauvegardes'), ['a.json']);
  assert.deepEqual(await listDocuments('Sauvegardes'), ['a.json']);
  assert.deepEqual(await listFolderFiles('Inconnu'), []);
  await deleteDocument('Sauvegardes', 'a.json');
  await deleteFolderFile('Sauvegardes', 'deja-parti.json');
  assert.deepEqual(await listFolderFiles('Sauvegardes'), []);

  const saved = await saveFile({ name: 'mon-budget-2026-11-15.xlsx', mime: 'application/octet-stream', data: new Uint8Array([9]) });
  assert.deepEqual(saved, { where: 'Enregistré dans Documents/MonBudget/Exports/mon-budget-2026-11-15.xlsx', native: true });
});

test('un dossier déjà appelé « MonBudget » est utilisé tel quel, sans second niveau', async () => {
  for (const name of ['MonBudget', 'mon budget', 'Mon-Budget', 'mon_budget']) {
    forgetFolder();
    const own = new FakeDir(name);
    pick(own);
    await chooseFolder();
    assert.equal(folderLabel(), name);
    await writeFolderFile('Exports', 'x.csv', new Uint8Array([1]));
    assert.deepEqual(own.tree(), ['Exports/x.csv']);
  }
});

test('sélecteur : annulation sans conséquence, options refusées par le téléphone, accès refusé', async () => {
  globalThis.showDirectoryPicker = async () => {
    throw fail('AbortError');
  };
  assert.equal(await chooseFolder(), null);
  assert.equal(folderInfo().linked, false);

  // certains téléphones refusent les options : l'appli redemande sans elles
  const calls = [];
  const dir = new FakeDir('Budget');
  globalThis.showDirectoryPicker = async (options) => {
    calls.push(options);
    if (options) throw new TypeError('startIn non reconnu');
    return dir;
  };
  assert.equal((await chooseFolder()).name, 'Budget');
  assert.deepEqual(calls, [{ id: 'mon-budget', mode: 'readwrite', startIn: 'documents' }, undefined]);

  // lecture seule accordée, écriture refusée : le dossier n'est pas retenu
  forgetFolder();
  const readOnly = new FakeDir('Lecture', { permission: 'prompt', afterRequest: 'denied', requests: 0, writeError: null });
  pick(readOnly);
  await assert.rejects(chooseFolder(), /accès en écriture à ce dossier a été refusé/);
  assert.equal(readOnly.shared.requests, 1);
  assert.equal(folderInfo().linked, false);

  // une vraie panne du sélecteur remonte telle quelle
  globalThis.showDirectoryPicker = async () => {
    throw fail('SecurityError', 'interdit ici');
  };
  await assert.rejects(chooseFolder(), /interdit ici/);
});

test('au redémarrage : accès toujours accordé, ou à réautoriser d’un geste', async () => {
  const granted = new FakeDir('Documents');
  assert.equal((await initFolder({ handle: granted, name: 'Documents', linkedAt: '2026-11-01T10:00:00.000Z' })).ready, true);
  assert.equal(folderInfo().linkedAt, '2026-11-01T10:00:00.000Z');

  const asking = new FakeDir('Documents', { permission: 'prompt', afterRequest: 'granted', requests: 0, writeError: null });
  const info = await initFolder({ handle: asking, name: 'Documents' });
  assert.deepEqual([info.linked, info.ready, info.permission], [true, false, 'prompt']);
  assert.deepEqual([folderBlocked(), filesBlocked(), filesTarget(), filesPlace()], [true, true, null, '']);
  assert.deepEqual(await listFolderFiles('Sauvegardes'), []);
  await assert.rejects(writeFolderFile('Sauvegardes', 'a.json', new Uint8Array([1])), /Aucun dossier/);
  assert.equal(await allowFolder(), true);
  assert.equal(asking.shared.requests, 1);
  assert.deepEqual([folderBlocked(), filesTarget()], [false, 'folder']);

  const refused = new FakeDir('Documents', { permission: 'prompt', afterRequest: 'denied', requests: 0, writeError: null });
  await initFolder({ handle: refused, name: 'Documents' });
  assert.equal(await allowFolder(), false);
  assert.equal(folderInfo().permission, 'denied');

  // une fiche abîmée ou absente : pas de dossier, pas d'erreur
  for (const junk of [null, undefined, {}, { handle: {} }, { handle: 'texte' }, 'texte']) {
    assert.equal((await initFolder(junk)).linked, false);
  }
  assert.equal(await allowFolder(), false);
});

test('écriture impossible : accès retiré, place insuffisante, dossier disparu — chaque cas est expliqué', async () => {
  const dir = new FakeDir('Documents');
  pick(dir);
  await chooseFolder();
  await writeFolderFile('Exports', 'a.txt', new TextEncoder().encode('avant'));

  dir.shared.writeError = fail('QuotaExceededError');
  await assert.rejects(writeFolderFile('Exports', 'a.txt', new TextEncoder().encode('après')), /plus assez de place/);
  assert.equal(dir.text('MonBudget/Exports/a.txt'), 'avant', 'une écriture ratée ne laisse pas un fichier à moitié écrit');
  dir.shared.writeError = null;

  // le téléphone a retiré l'accès entre-temps : l'appli le remarque et le signale
  dir.shared.permission = 'prompt';
  await assert.rejects(writeFolderFile('Exports', 'b.txt', new Uint8Array([1])), /réautoriser l'accès au dossier/);
  assert.deepEqual([folderBlocked(), filesBlocked(), filesTarget()], [true, true, null]);
  assert.equal(await allowFolder(), true);

  dir.children.delete('MonBudget');
  dir.getDirectoryHandle = async () => {
    throw fail('NotFoundError');
  };
  await assert.rejects(writeFolderFile('Exports', 'c.txt', new Uint8Array([1])), /introuvable/);
});

test('sauvegarde automatique dans le dossier : une par jour, les 7 dernières gardées, rien si rien n’a changé', async () => {
  const store = await new Store(new MemoryAdapter()).init();
  assert.deepEqual(await autoBackup(store, { appVersion: '2.1.0', today: TODAY }), { done: false, reason: 'unavailable' });

  const dir = new FakeDir('Documents');
  pick(dir);
  await chooseFolder();
  assert.equal((await autoBackup(store, { appVersion: '2.1.0', today: TODAY })).reason, 'empty');

  const addOp = async (label) => {
    const plan = planSaveOperation(store.state, { date: TODAY, amount: -1000, label }, { today: TODAY });
    await store.commit(plan.cs, { label: 'Opération ajoutée' });
  };
  await addOp('Café');
  const first = await autoBackup(store, { appVersion: '2.1.0', today: TODAY });
  assert.deepEqual(first, { done: true, path: `Documents/MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json` });
  const saved = JSON.parse(dir.text(`MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json`));
  assert.deepEqual([saved.format, saved.appVersion, saved.data.operations.length], ['mon-budget', '2.1.0', 1]);
  assert.equal((await autoBackup(store, { appVersion: '2.1.0', today: TODAY })).reason, 'fresh');

  for (let d = 16; d <= 24; d++) {
    await addOp(`Jour ${d}`);
    assert.equal((await autoBackup(store, { appVersion: '2.1.0', today: `2026-11-${d}` })).done, true);
  }
  const kept = await listFolderFiles('Sauvegardes');
  assert.equal(kept.length, AUTO_BACKUPS_KEPT);
  assert.deepEqual(kept.sort()[0], 'mon-budget-auto-2026-11-18.json', 'les plus anciennes sont retirées');

  // un fichier que l'utilisateur a rangé là lui-même n'est jamais touché
  await writeFolderFile('Sauvegardes', 'ma-copie-perso.json', new Uint8Array([1]));
  await addOp('Encore');
  await autoBackup(store, { appVersion: '2.1.0', today: '2026-11-25' });
  assert.ok((await listFolderFiles('Sauvegardes')).includes('ma-copie-perso.json'));

  // accès à réautoriser : la sauvegarde le dit au lieu d'échouer en silence
  dir.shared.permission = 'prompt';
  await initFolder({ handle: dir, name: 'Documents' });
  assert.deepEqual(await autoBackup(store, { appVersion: '2.1.0', today: '2026-11-26', force: true }), { done: false, reason: 'permission' });
  assert.equal(await mirrorFile('Pieces-jointes', 'ticket.jpg', new Uint8Array([1])), null);
  await allowFolder();
  assert.equal(await mirrorFile('Pieces-jointes', 'ticket.jpg', new Uint8Array([1])), 'Documents/MonBudget/Pieces-jointes/ticket.jpg');

  // une écriture qui échoue est notée pour le diagnostic, sans faire planter l'appli
  dir.shared.writeError = fail('QuotaExceededError');
  const failed = await autoBackup(store, { appVersion: '2.1.0', today: '2026-11-27', force: true });
  assert.deepEqual([failed.done, failed.reason], [false, 'error']);
  assert.match(store.setting('autoBackupError'), /plus assez de place/);
});
