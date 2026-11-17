// Sauvegardes : export complet (JSON seul, ou ZIP avec les pièces jointes), import, sauvegarde
// automatique sur Android, effacement.

import { exportData, planImport, readImport, decodeDataUrl } from '../core/portable.js';
import { isEmpty } from '../core/changeset.js';
import { zipStore, unzip, decodeText } from '../io/zip.js';
import { filesBlocked, filesTarget, writeToDocuments, listDocuments, deleteDocument } from '../platform/platform.js';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/csv': 'csv' };
const MIMES = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));
export const AUTO_BACKUPS_KEPT = 7;

export function extensionFor(mime) {
  return EXTENSIONS[mime] || 'bin';
}

/** Sauvegarde des données seules (sans les photos), en texte JSON. */
export function buildBackupJson(store, { appVersion, now = new Date() }) {
  return JSON.stringify(exportData(store.state, { appVersion, now }), null, 1);
}

/** Sauvegarde complète : données + toutes les pièces jointes, dans une archive ZIP. */
export async function buildBackupZip(store, { appVersion, now = new Date() }) {
  const files = [{ name: 'mon-budget.json', data: buildBackupJson(store, { appVersion, now }), date: now }];
  for (const record of store.state.files) {
    const blob = await store.readBlob(record.id);
    if (blob) files.push({ name: `pieces/${record.id}.${extensionFor(blob.mime)}`, data: blob.bytes, date: now });
  }
  files.push({
    name: 'LISEZ-MOI.txt',
    data:
      'Sauvegarde complète de Mon Budget.\r\n\r\n' +
      "- mon-budget.json : toutes les données (opérations, enveloppes, tags, récurrences, rapprochements…).\r\n" +
      '- pieces/ : les photos de tickets et les relevés importés.\r\n\r\n' +
      "Pour restaurer : dans l'appli, Plus > Sauvegarde et données > Importer, puis choisir ce fichier ZIP.\r\n",
    date: now,
  });
  return zipStore(files);
}

/**
 * Lit un fichier de sauvegarde (.json ou .zip).
 * Renvoie { ok, read (résultat de readImport), blobs: Map(id → { mime, bytes }) } ou { ok: false, error }.
 */
export async function readBackupFile({ name, bytes }) {
  const blobs = new Map();
  let text = null;
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  try {
    if (isZip) {
      const entries = await unzip(bytes);
      const main = entries.find((e) => e.name === 'mon-budget.json') || entries.find((e) => /\.json$/i.test(e.name) && !e.name.includes('/'));
      if (!main) return { ok: false, error: "Cette archive ne contient pas de sauvegarde Mon Budget (fichier « mon-budget.json » introuvable)." };
      text = decodeText(main.data);
      for (const entry of entries) {
        const m = /^pieces\/([A-Za-z0-9_]+)\.([a-z0-9]+)$/.exec(entry.name);
        if (m) blobs.set(m[1], { mime: MIMES[m[2]] || 'application/octet-stream', bytes: entry.data });
      }
    } else {
      text = decodeText(bytes);
    }
  } catch (error) {
    return { ok: false, error: error?.message || 'Fichier illisible.' };
  }
  let json;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, error: `« ${name} » n'est pas un fichier de sauvegarde lisible.` };
  }
  const read = readImport(json);
  if (!read.ok) return { ok: false, error: read.error };
  // Photos de l'ancienne version, stockées dans le fichier lui-même
  for (const photo of read.photos) {
    const decoded = decodeDataUrl(photo.dataUrl);
    if (decoded) blobs.set(photo.fileId, decoded);
  }
  return { ok: true, read, blobs };
}

/**
 * Applique un import. mode : 'merge' (ajouter à la base) ou 'replace' (tout remplacer).
 * Renvoie le plan (compteurs added / skipped).
 */
export async function applyImport(store, { read, blobs }, mode) {
  const available = new Set(blobs.keys());
  const plan = planImport(store.state, read.state, mode, { availableFiles: available });
  // Le contenu des pièces jointes d'abord : si l'écriture échoue, la base n'a pas bougé.
  const wanted = new Set((plan.cs.put.files || []).map((f) => f.id));
  for (const [id, blob] of blobs) {
    if (!wanted.has(id)) continue;
    const data = blob.bytes.buffer.slice(blob.bytes.byteOffset, blob.bytes.byteOffset + blob.bytes.byteLength);
    await store.db.putBlob(id, { mime: blob.mime, data });
  }
  if (!isEmpty(plan.cs)) {
    await store.commit(plan.cs, { label: mode === 'replace' ? 'Base remplacée' : 'Import ajouté', undoable: mode !== 'replace' });
  }
  if (mode === 'replace') store.clearUndo();
  return plan;
}

/**
 * Sauvegarde automatique : une par jour au plus, dans le sous-dossier Sauvegardes du dossier de
 * l'appli (Documents/MonBudget sur Android, le dossier désigné dans l'appli installée), en gardant
 * les 7 dernières. Renvoie un compte rendu { done, path?, reason?, error? } ; reason vaut
 * 'unavailable' (nulle part où écrire), 'permission' (dossier à réautoriser), 'empty', 'fresh'
 * ou 'error'.
 */
export async function autoBackup(store, { appVersion, today, force = false }) {
  if (!filesTarget()) return { done: false, reason: filesBlocked() ? 'permission' : 'unavailable' };
  if (store.isEmpty) return { done: false, reason: 'empty' };
  // Rien n'a changé depuis la dernière copie faite pendant cette session : inutile de réécrire.
  if (!force && store.backedUpRevision === store.revision && store.setting('autoBackupDate') === today) return { done: false, reason: 'fresh' };
  try {
    const name = `mon-budget-auto-${today}.json`;
    const path = await writeToDocuments('Sauvegardes', name, buildBackupJson(store, { appVersion }));
    const existing = (await listDocuments('Sauvegardes')).filter((n) => /^mon-budget-auto-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const old of existing.slice(0, Math.max(0, existing.length - AUTO_BACKUPS_KEPT))) await deleteDocument('Sauvegardes', old);
    store.backedUpRevision = store.revision;
    await store.setSetting('autoBackupDate', today, { silent: true });
    await store.setSetting('autoBackupError', undefined, { silent: true });
    return { done: true, path };
  } catch (error) {
    const message = error?.message || String(error);
    await store.setSetting('autoBackupError', message, { silent: true }).catch(() => {});
    return { done: false, reason: 'error', error: message };
  }
}

export const BACKUP_REMINDER_DAYS = 30; // rappel si la dernière sauvegarde « sortie du téléphone » est plus ancienne
export const FIRST_BACKUP_AFTER_DAYS = 14; // premier rappel, deux semaines après le début de l'utilisation

/**
 * Faut-il rappeler de faire une sauvegarde hors du téléphone ?
 * Les copies automatiques dans Documents/MonBudget ne protègent pas d'un téléphone perdu ou cassé :
 * seule une sauvegarde exportée (envoyée sur un ordinateur, un Drive, par e-mail…) le fait.
 * Renvoie null (rien à dire) ou { never, days } : jamais sauvegardé / nombre de jours écoulés.
 */
export function backupReminder({ lastBackupAt = null, firstUseAt = null, hasData = false, now = Date.now() }) {
  if (!hasData) return null;
  const DAY = 86400000;
  const last = lastBackupAt ? Date.parse(lastBackupAt) : NaN;
  if (Number.isFinite(last)) {
    const days = Math.floor((now - last) / DAY);
    return days >= BACKUP_REMINDER_DAYS ? { never: false, days } : null;
  }
  const first = firstUseAt ? Date.parse(firstUseAt) : NaN;
  if (!Number.isFinite(first)) return null;
  const days = Math.floor((now - first) / DAY);
  return days >= FIRST_BACKUP_AFTER_DAYS ? { never: true, days } : null;
}

/** Le rappel de sauvegarde pour l'état actuel du magasin (voir backupReminder). */
export function backupReminderFor(store, now = Date.now()) {
  let firstUseAt = null;
  for (const op of store.state.operations) {
    if (op.createdAt && (!firstUseAt || op.createdAt < firstUseAt)) firstUseAt = op.createdAt;
  }
  return backupReminder({ lastBackupAt: store.setting('lastBackupAt', null), firstUseAt, hasData: !store.isEmpty && !store.setting('demo'), now });
}

/** Copie lisible d'une pièce jointe dans le dossier de l'appli, sans jamais bloquer l'appli. */
export async function mirrorFile(folder, name, bytes) {
  if (!filesTarget()) return null;
  try {
    return await writeToDocuments(folder, name, bytes);
  } catch {
    return null;
  }
}
