// Un vrai dossier du téléphone pour l'appli installée (PWA).
//
// Une appli web ne peut pas écrire où elle veut : il faut que l'utilisateur lui désigne UN dossier
// (une fois), et le navigateur lui en garde l'accès. On y range alors les mêmes sous-dossiers que
// l'appli Android : Sauvegardes, Exports, Releves, Pieces-jointes, Signalements.
//
// Ces fichiers sont des COPIES lisibles (avec l'appli « Fichiers », depuis un ordinateur…) : la
// base de l'appli reste dans son stockage privé. Disponible sur Chrome pour Android depuis la
// version 132 ; ailleurs, `folderSupported()` renvoie false et l'appli télécharge les fichiers.
//
// Ce module ne connaît ni le magasin ni l'interface : on lui confie la fiche du dossier au
// démarrage (initFolder) et c'est l'appelant qui l'enregistre dans les réglages (FOLDER_KEY).

export const FOLDER_KEY = 'link:folder';
const ROOT_FOLDER = 'MonBudget';

let record = null; // { handle, name, linkedAt }
let permission = 'none'; // 'none' (aucun dossier), 'granted', 'prompt' (à réautoriser) ou 'denied'

export function folderSupported() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

/** Le dossier choisi s'appelle déjà « MonBudget » : on écrit dedans, sans créer un second niveau. */
function isOwnFolder(name) {
  return /^mon[\s_-]?budget$/i.test(String(name || '').trim());
}

/** Chemin lisible du dossier de l'appli (« Documents/MonBudget », « MonBudget »…). */
export function folderLabel() {
  if (!record) return '';
  return isOwnFolder(record.name) ? record.name : `${record.name}/${ROOT_FOLDER}`;
}

export function folderInfo() {
  return { supported: folderSupported(), linked: !!record, name: record ? record.name : '', label: folderLabel(), permission, ready: !!record && permission === 'granted', linkedAt: record ? record.linkedAt : null };
}

export function folderReady() {
  return !!record && permission === 'granted';
}

/** Un dossier est choisi mais le téléphone redemande l'autorisation avant d'y écrire. */
export function folderBlocked() {
  return !!record && permission !== 'granted';
}

async function query(handle) {
  try {
    if (typeof handle.queryPermission !== 'function') return 'granted';
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

async function request(handle) {
  try {
    if (typeof handle.requestPermission !== 'function') return 'granted';
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Au démarrage : reprend la fiche enregistrée et regarde si l'accès est toujours accordé. */
export async function initFolder(saved) {
  record = saved && saved.handle && typeof saved.handle.getDirectoryHandle === 'function' ? { handle: saved.handle, name: String(saved.name || saved.handle.name || ''), linkedAt: saved.linkedAt || null } : null;
  permission = record ? await query(record.handle) : 'none';
  return folderInfo();
}

/**
 * Fait choisir un dossier (à appeler depuis un bouton : le navigateur exige un geste).
 * Renvoie la fiche à enregistrer { handle, name, linkedAt }, ou null si l'utilisateur renonce.
 */
export async function chooseFolder() {
  if (!folderSupported()) throw new Error("Ce navigateur ne permet pas de choisir un dossier.");
  let handle;
  try {
    handle = await globalThis.showDirectoryPicker({ id: 'mon-budget', mode: 'readwrite', startIn: 'documents' });
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    if (!(error instanceof TypeError)) throw error;
    // Certains téléphones refusent les options (dossier de départ…) : on redemande sans elles.
    try {
      handle = await globalThis.showDirectoryPicker();
    } catch (again) {
      if (again?.name === 'AbortError') return null;
      throw again;
    }
  }
  let granted = await query(handle);
  if (granted !== 'granted') granted = await request(handle);
  if (granted !== 'granted') throw new Error("L'accès en écriture à ce dossier a été refusé.");
  record = { handle, name: String(handle.name || ''), linkedAt: new Date().toISOString() };
  permission = 'granted';
  return { ...record };
}

/** Redemande l'accès au dossier déjà choisi (à appeler depuis un bouton). Renvoie true si accordé. */
export async function allowFolder() {
  if (!record) return false;
  permission = await request(record.handle);
  return permission === 'granted';
}

export function forgetFolder() {
  record = null;
  permission = 'none';
}

async function baseDir(create) {
  return isOwnFolder(record.name) ? record.handle : record.handle.getDirectoryHandle(ROOT_FOLDER, { create });
}

async function dirFor(folder, create) {
  let dir = await baseDir(create);
  for (const part of String(folder || '').split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

function explain(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    permission = 'prompt';
    return new Error("Le téléphone demande de réautoriser l'accès au dossier (Plus › Sauvegarde et données).");
  }
  if (error?.name === 'NotFoundError') return new Error('Le dossier choisi est introuvable : il a peut-être été déplacé ou supprimé.');
  if (error?.name === 'QuotaExceededError') return new Error("Il n'y a plus assez de place sur le téléphone.");
  return error instanceof Error ? error : new Error(String(error));
}

/** Écrit un fichier dans <dossier de l'appli>/<sous-dossier>/. Renvoie le chemin lisible. */
export async function writeFolderFile(folder, name, bytes) {
  if (!folderReady()) throw new Error("Aucun dossier n'est disponible pour l'instant.");
  try {
    const dir = await dirFor(folder, true);
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(bytes);
    } catch (error) {
      if (typeof writable.abort === 'function') await writable.abort().catch(() => {});
      throw error;
    }
    await writable.close();
    return `${folderLabel()}/${folder}/${name}`;
  } catch (error) {
    throw explain(error);
  }
}

export async function listFolderFiles(folder) {
  if (!folderReady()) return [];
  try {
    const dir = await dirFor(folder, false);
    const names = [];
    for await (const [name, entry] of dir.entries()) if (entry.kind === 'file') names.push(name);
    return names;
  } catch {
    return [];
  }
}

export async function deleteFolderFile(folder, name) {
  if (!folderReady()) return;
  try {
    const dir = await dirFor(folder, false);
    await dir.removeEntry(name);
  } catch {
    /* déjà supprimé */
  }
}
