// Appli installable (PWA) : mise en réserve des fichiers pour fonctionner sans connexion,
// détection des mises à jour, bouton « Installer ».
//
// Rien de tout cela ne s'active dans l'appli Android (Capacitor embarque déjà les fichiers) ni
// dans le fichier unique ouvert depuis le disque : il faut une page servie en https.
//
// Le reste de l'appli ne connaît que :
//   initPwa()            à appeler une fois au démarrage
//   pwaState()           { supported, offlineReady, updateReady, canInstall, installed, error }
//   onPwaChange(fn)      prévenu à chaque changement de cet état
//   promptInstall()      ouvre la fenêtre d'installation du navigateur
//   applyUpdate()        bascule sur la nouvelle version (la page se recharge)
//   checkForUpdate()     demande au navigateur de regarder s'il y a du nouveau

import { isNative, isStandalone } from './platform.js';

export { isStandalone };

const AUTO_RELOAD_KEY = 'mon-budget-maj-auto';
const AUTO_RELOAD_GUARD_MS = 60 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;

const state = {
  supported: false, // le fonctionnement sans connexion est possible ici
  offlineReady: false, // les fichiers de l'appli sont en réserve sur l'appareil
  updateReady: false, // une nouvelle version est prête à prendre le relais
  canInstall: false, // le navigateur propose l'installation
  installed: false, // l'appli est ouverte comme une appli (icône, plein écran)
  error: '', // dernière erreur de mise en réserve (affichée dans À propos)
};
const listeners = new Set();
let registration = null;
let installEvent = null;
let reloading = false;
let lastCheck = 0;

function change(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (!changed) return;
  for (const listener of [...listeners]) {
    try {
      listener({ ...state });
    } catch (error) {
      console.error(error);
    }
  }
}

export function pwaState() {
  return { ...state };
}

export function onPwaChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pwaSupported() {
  return !isNative() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext === true && /^https?:$/.test(location.protocol);
}

function reloadOnce() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

function watch(worker) {
  if (!worker) return;
  const look = () => {
    if (worker.state === 'installed') {
      // Avec une version déjà aux commandes, la nouvelle attend son tour : c'est une mise à jour.
      if (registration && registration.waiting === worker && navigator.serviceWorker.controller) change({ updateReady: true });
    } else if (worker.state === 'activated') {
      change({ offlineReady: true, error: '' });
    }
  };
  worker.addEventListener('statechange', look);
  look();
}

function recentlyAutoReloaded() {
  try {
    const at = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || 0);
    return Date.now() - at < AUTO_RELOAD_GUARD_MS;
  } catch {
    return true; // sans mémoire de session, on ne prend pas le risque d'une boucle de rechargements
  }
}

/**
 * Met en place le fonctionnement sans connexion et les mises à jour.
 * applyWaitingAtStart : si une version téléchargée précédemment attend encore, on bascule tout de
 * suite dessus (au démarrage, rien n'est en cours de saisie).
 */
export async function initPwa({ applyWaitingAtStart = true } = {}) {
  change({ installed: isStandalone() });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // pas de bandeau automatique : c'est l'appli qui propose, au bon moment
    installEvent = event;
    change({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    change({ canInstall: false, installed: true });
  });
  try {
    window.matchMedia('(display-mode: standalone)').addEventListener('change', () => change({ installed: isStandalone() }));
  } catch {
    /* ancien navigateur : l'état sera juste au prochain démarrage */
  }

  if (!pwaSupported()) return pwaState();
  change({ supported: true });

  const sw = navigator.serviceWorker;
  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    // Toute première mise en réserve : la page vient d'être prise en charge, rien à recharger.
    if (!controlled) {
      controlled = true;
      change({ offlineReady: true });
      return;
    }
    reloadOnce(); // une nouvelle version a pris le relais : on repart sur ses fichiers
  });
  sw.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'INSTALL_ERROR') change({ error: String(event.data.message || 'mise en réserve impossible') });
  });

  try {
    registration = await sw.register('sw.js', { scope: './', updateViaCache: 'none' });
  } catch (error) {
    change({ error: String(error?.message || error) });
    return pwaState();
  }
  if (!registration) {
    // Certains environnements (navigateur de test, extensions) neutralisent l'enregistrement.
    change({ error: 'la mise en réserve est bloquée par le navigateur' });
    return pwaState();
  }
  lastCheck = Date.now();
  if (registration.active) change({ offlineReady: true });
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  if (registration.waiting && sw.controller) {
    change({ updateReady: true });
    if (applyWaitingAtStart && !recentlyAutoReloaded()) {
      try {
        sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
      } catch {
        /* sans importance */
      }
      applyUpdate();
    }
  }
  return pwaState();
}

/** Ouvre la fenêtre d'installation. Renvoie 'accepted', 'dismissed' ou 'unavailable'. */
export async function promptInstall() {
  const event = installEvent;
  if (!event) return 'unavailable';
  installEvent = null;
  change({ canInstall: false });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}

/** Bascule sur la version en attente. La page se recharge dès qu'elle a pris le relais. */
export function applyUpdate() {
  const waiting = registration && registration.waiting;
  if (!waiting) return false;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // Filet de sécurité : si la page n'était pas prise en charge (rechargement forcé), on recharge quand même.
  setTimeout(() => {
    if (!reloading && registration && !registration.waiting) reloadOnce();
  }, 4000);
  return true;
}

/**
 * Demande au navigateur de vérifier s'il existe une nouvelle version. `force: false` limite à une
 * vérification toutes les 30 minutes (au retour au premier plan, par exemple).
 * Renvoie 'checked', 'skipped', 'unavailable' ou 'offline'.
 */
export async function checkForUpdate({ force = true } = {}) {
  if (!registration) return 'unavailable';
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return 'skipped';
  lastCheck = Date.now();
  try {
    await registration.update();
    return 'checked';
  } catch {
    return 'offline';
  }
}

/** Version des fichiers en réserve : { version, build, files } ou null. */
export function reserveInfo() {
  return new Promise((resolve) => {
    const worker = registration && (registration.active || registration.waiting);
    if (!worker) return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data || null);
    };
    try {
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
