// Ce qui dépend de l'endroit où tourne l'appli : téléphone Android (enveloppe Capacitor) ou
// simple navigateur. Le reste du code ne connaît que ces quelques fonctions.
//
// Sur Android, les fichiers sont rangés dans Documents/MonBudget/ (visible avec l'appli
// « Fichiers » du téléphone ou depuis un PC) :
//   Sauvegardes/      sauvegardes automatiques (les 7 dernières)
//   Exports/          classeurs Excel, CSV et sauvegardes exportés à la main
//   Releves/          relevés bancaires importés
//   Pieces-jointes/   copies des photos de tickets, par année et par mois
//   Signalements/     signalements de bugs exportés
// Ces fichiers sont des COPIES lisibles : la base de l'appli, elle, vit dans son stockage privé.
//
// Dans l'appli installée depuis le navigateur (PWA), les mêmes sous-dossiers sont écrits dans le
// dossier que l'utilisateur a désigné une fois (voir folder.js) ; sans dossier désigné, les
// fichiers sont simplement téléchargés ou partagés.

import { deleteFolderFile, folderBlocked, folderLabel, folderReady, listFolderFiles, writeFolderFile } from './folder.js';

export const ROOT_FOLDER = 'MonBudget';

function capacitor() {
  return globalThis.Capacitor || null;
}

export function isNative() {
  const cap = capacitor();
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

function plugin(name) {
  const cap = capacitor();
  return (cap && cap.Plugins && cap.Plugins[name]) || null;
}

export function hasPlugin(name) {
  return isNative() && !!plugin(name);
}

/** Vrai si l'appli est ouverte depuis son icône, sans la barre du navigateur (appli installée). */
export function isStandalone() {
  try {
    if (navigator.standalone === true) return true;
    return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  } catch {
    return false;
  }
}

/**
 * Où l'appli peut écrire de vrais fichiers :
 *   'documents' → Documents/MonBudget (appli Android) ;
 *   'folder'    → le dossier désigné par l'utilisateur (appli installée depuis le navigateur) ;
 *   null        → nulle part : les fichiers sont téléchargés ou partagés.
 */
export function filesTarget() {
  if (isNative()) return plugin('Filesystem') ? 'documents' : null;
  return folderReady() ? 'folder' : null;
}

/** Nom lisible de cet endroit (« Documents/MonBudget »), ou '' s'il n'y en a pas. */
export function filesPlace() {
  const target = filesTarget();
  if (target === 'documents') return `Documents/${ROOT_FOLDER}`;
  return target === 'folder' ? folderLabel() : '';
}

/** Un dossier est désigné, mais le téléphone attend que l'utilisateur réautorise l'accès. */
export function filesBlocked() {
  return !isNative() && folderBlocked();
}

export function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new TextEncoder().encode(String(data));
}

export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Nom de fichier sûr : sans caractères interdits, sans accents, longueur raisonnable. */
export function safeFileName(name) {
  const cleaned = String(name || 'fichier')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/^[-.]+|[-. ]+$/g, '');
  return (cleaned || 'fichier').slice(0, 80);
}

function download(name, mime, bytes) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

/**
 * Écrit un fichier dans <dossier de l'appli>/<dossier>/ : Documents/MonBudget sur Android, le
 * dossier désigné par l'utilisateur dans l'appli installée. Renvoie le chemin lisible, ou lève
 * une erreur s'il n'y a nulle part où écrire.
 */
export async function writeToDocuments(folder, name, data) {
  const target = filesTarget();
  if (target === 'folder') return writeFolderFile(folder, safeFileName(name), toBytes(data));
  const fs = plugin('Filesystem');
  if (target !== 'documents' || !fs) throw new Error('Écriture de fichiers indisponible sur cet appareil.');
  const path = `${ROOT_FOLDER}/${folder}/${safeFileName(name)}`;
  await fs.writeFile({ path, data: toBase64(toBytes(data)), directory: 'DOCUMENTS', recursive: true });
  return `Documents/${path}`;
}

export async function listDocuments(folder) {
  const target = filesTarget();
  if (target === 'folder') return listFolderFiles(folder);
  const fs = plugin('Filesystem');
  if (target !== 'documents' || !fs) return [];
  try {
    const result = await fs.readdir({ path: `${ROOT_FOLDER}/${folder}`, directory: 'DOCUMENTS' });
    return (result.files || []).map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function deleteDocument(folder, name) {
  const target = filesTarget();
  if (target === 'folder') return deleteFolderFile(folder, name);
  const fs = plugin('Filesystem');
  if (target !== 'documents' || !fs) return;
  try {
    await fs.deleteFile({ path: `${ROOT_FOLDER}/${folder}/${name}`, directory: 'DOCUMENTS' });
  } catch {
    /* déjà supprimé */
  }
}

/**
 * Remet un fichier à l'utilisateur.
 *  - Appli Android            : enregistrement dans Documents/MonBudget/<dossier>/.
 *  - Appli installée + dossier : enregistrement dans le dossier désigné ; si l'écriture échoue
 *                                (accès à réautoriser…), le fichier est téléchargé à la place.
 *  - Sinon                     : téléchargement.
 * Renvoie { where } : une phrase à afficher (« Enregistré dans … »).
 */
export async function saveFile({ name, mime = 'application/octet-stream', data, folder = 'Exports' }) {
  const bytes = toBytes(data);
  const fileName = safeFileName(name);
  const target = filesTarget();
  if (target === 'documents') {
    const path = await writeToDocuments(folder, fileName, bytes);
    return { where: `Enregistré dans ${path}`, native: true };
  }
  if (target === 'folder') {
    try {
      const path = await writeToDocuments(folder, fileName, bytes);
      return { where: `Enregistré dans ${path}`, native: true };
    } catch {
      download(fileName, mime, bytes);
      return { where: `« ${fileName} » téléchargé (le dossier n'est pas accessible pour l'instant)`, native: false };
    }
  }
  download(fileName, mime, bytes);
  return { where: `« ${fileName} » téléchargé`, native: false };
}

/**
 * Ouvre le menu « Partager » du téléphone avec un fichier (mail, messagerie, Drive…).
 * Renvoie 'shared', 'cancelled' ou 'saved' (repli : simple enregistrement).
 */
export async function shareFile({ name, mime = 'application/octet-stream', data, title = '', text = '' }) {
  const bytes = toBytes(data);
  const fileName = safeFileName(name);
  const fs = plugin('Filesystem');
  const share = plugin('Share');
  if (isNative() && fs && share) {
    try {
      const written = await fs.writeFile({ path: `partage/${fileName}`, data: toBase64(bytes), directory: 'CACHE', recursive: true });
      await share.share({ title: title || fileName, text, files: [written.uri], dialogTitle: title || 'Partager' });
      return 'shared';
    } catch (error) {
      if (/cancel/i.test(String(error?.message || error))) return 'cancelled';
      await saveFile({ name: fileName, mime, data: bytes });
      return 'saved';
    }
  }
  try {
    const file = new File([bytes], fileName, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || fileName, text });
      return 'shared';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
  }
  download(fileName, mime, bytes);
  return 'saved';
}

/** Partage un simple texte (ou le copie si le partage n'existe pas). Renvoie 'shared' | 'copied' | 'cancelled' | 'failed'. */
export async function shareText({ title = '', text }) {
  const share = plugin('Share');
  try {
    if (isNative() && share) {
      await share.share({ title, text, dialogTitle: title || 'Partager' });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (error) {
    if (error?.name === 'AbortError' || /cancel/i.test(String(error?.message || error))) return 'cancelled';
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Fait choisir un fichier à l'utilisateur. Renvoie { name, mime, bytes } ou null s'il annule.
 * capture: 'environment' ouvre directement l'appareil photo.
 */
export function pickFile({ accept = '', capture = null } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.position = 'fixed';
    input.style.left = '-1000px';
    input.setAttribute('data-file-picker', accept || 'any');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return finish(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        finish({ name: file.name, mime: file.type || '', bytes });
      } catch {
        finish(null);
      }
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Quitte l'appli (Android). Sans effet dans un navigateur. */
export function exitApp() {
  const app = plugin('App');
  if (isNative() && app) {
    if (typeof app.minimizeApp === 'function') app.minimizeApp();
    else if (typeof app.exitApp === 'function') app.exitApp();
    return true;
  }
  return false;
}

/** Bouton « retour » physique d'Android (si le module App de Capacitor est présent). */
export function onNativeBack(handler) {
  const app = plugin('App');
  if (!isNative() || !app || typeof app.addListener !== 'function') return false;
  app.addListener('backButton', () => handler());
  return true;
}

/** Appelé quand l'appli revient au premier plan. */
export function onResume(handler) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handler();
  });
  const app = plugin('App');
  if (isNative() && app && typeof app.addListener === 'function') app.addListener('resume', () => handler());
}

/** Demande au système de ne pas effacer les données en cas de manque de place (si disponible). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {
    /* non disponible */
  }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch {
    /* non disponible */
  }
  return null;
}

export function deviceSummary() {
  const ua = navigator.userAgent || '';
  const android = /Android [\d.]+/.exec(ua);
  const model = /Android [\d.]+; ([^;)]+)/.exec(ua);
  const chrome = /Chrome\/[\d.]+/.exec(ua);
  const parts = [isNative() ? 'Appli Android' : isStandalone() ? 'Appli installée' : 'Navigateur'];
  if (android) parts.push(android[0]);
  if (model) parts.push(model[1].trim());
  if (chrome) parts.push(chrome[0]);
  parts.push(`écran ${window.innerWidth}×${window.innerHeight}`);
  return parts.join(' | ');
}
