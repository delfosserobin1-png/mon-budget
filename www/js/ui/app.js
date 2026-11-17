// Démarrage de l'appli et objet « app » partagé par tous les écrans.
//
//   app.store      les données (voir data/store.js)
//   app.state      raccourci vers app.store.state
//   app.today()    la date du jour "AAAA-MM-JJ"
//   app.commit()   valider un lot de modifications (avec le bouton Annuler)
//   app.go / app.open / app.back   navigation
//   app.claude     la connexion à Claude (envoi des commentaires, réponses) — data/claude-link.js
//   app.pwa        l'appli installable (installation, mise à jour) — platform/pwa.js
//   app.folder     le dossier du téléphone où sont copiés les fichiers — platform/folder.js

import { openDb, readLegacyV1 } from '../data/db.js';
import { Store } from '../data/store.js';
import { applyImport, autoBackup, backupReminderFor } from '../data/backup.js';
import { createClaudeLink } from '../data/claude-link.js';
import { readImport, decodeDataUrl, planImport } from '../core/portable.js';
import { buildDemoState } from '../core/demo.js';
import { todayISO } from '../core/dates.js';
import { queuedComments, unreadTotal } from '../core/comments.js';
import { changesSince } from '../changelog.js';
import { h } from './dom.js';
import { createShell } from './shell.js';
import { alertDialog, closeAllOverlays, overlayCount, toast } from './overlays.js';
import { filesBlocked, onResume, requestPersistence } from '../platform/platform.js';
import { FOLDER_KEY, allowFolder, chooseFolder, folderInfo, forgetFolder, initFolder } from '../platform/folder.js';
import { applyUpdate, checkForUpdate, initPwa, onPwaChange, promptInstall, pwaState, reserveInfo } from '../platform/pwa.js';
import { showWhatsNew } from './pwa-ui.js';
import { openOperationForm } from './forms/operation.js';
import { createOperationsScreen } from './screens/operations.js';
import { createEnvelopesScreen } from './screens/envelopes.js';
import { createEnvelopeScreen } from './screens/envelope.js';
import { createForecastScreen } from './screens/forecast.js';
import { createStatsScreen } from './screens/stats.js';
import { createMoreScreen } from './screens/more.js';
import { SUB_SCREENS } from './screens/sub-screens.js';
import { createLock } from './screens/lock.js';
import { maybeOnboard } from './screens/onboarding.js';

export const APP_VERSION = '2.1.0';
const LOCK_AFTER_MS = 60 * 1000;
// Réglages propres à l'appareil (connexion à Claude, dossier de copie) : « Tout effacer » les garde.
const DEVICE_SETTINGS_PREFIX = 'link:';

const TABS = [
  { id: 'operations', label: 'Opérations', icon: 'list', create: createOperationsScreen },
  { id: 'envelopes', label: 'Enveloppes', icon: 'envelope', create: createEnvelopesScreen },
  { id: 'forecast', label: 'Prévisions', icon: 'calendar', create: createForecastScreen },
  { id: 'stats', label: 'Stats', icon: 'stats', create: createStatsScreen },
  { id: 'more', label: 'Plus', icon: 'more', create: createMoreScreen },
];

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try {
    localStorage.setItem('mon-budget-theme', theme || 'auto');
  } catch {
    /* stockage indisponible : le thème sera simplement réappliqué au prochain démarrage */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--paper').trim() || '#f6f7fb');
}

export async function boot(mount = document.getElementById('app')) {
  const errors = []; // les 20 dernières erreurs, jointes aux signalements de bugs
  let lastErrorToast = 0;
  const reportError = (error, context = '') => {
    const message = String(error?.message || error || 'Erreur inconnue');
    const stack = String(error?.stack || '').split('\n').slice(0, 4).join('\n');
    errors.push({ at: new Date().toISOString(), message, context, stack });
    if (errors.length > 20) errors.shift();
    console.error(error);
    if (Date.now() - lastErrorToast > 8000) {
      lastErrorToast = Date.now();
      toast('Un problème est survenu. Tu peux le signaler depuis Plus › Signaler un bug.', { bad: true, duration: 5000 });
    }
  };
  window.addEventListener('error', (event) => reportError(event.error || event.message, 'erreur'));
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason, 'promesse'));

  const db = await openDb();
  const store = await new Store(db).init();
  await initFolder(store.setting(FOLDER_KEY, null));
  const claude = createClaudeLink(store);

  let shell = null;
  let lock = null;
  let currentDay = todayISO();

  let writing = 0; // enregistrements en cours (les tests attendent qu'il n'y en ait plus)
  const app = {
    version: APP_VERSION,
    store,
    errors,
    reportError,
    get busy() {
      return writing > 0;
    },
    get state() {
      return store.state;
    },
    today: () => todayISO(),

    // ---- navigation ----
    go: (tab, params) => shell.showTab(tab, params),
    open: (name, params) => shell.pushScreen(name, params),
    back: () => shell.handleBack(),
    close: () => shell.popScreen(),
    refresh: () => shell.refresh(),
    currentScreenName: () => shell.currentName(),
    /** Dernier écran « de travail » visité (pour dire de quoi parle un commentaire). */
    lastPlace: () => shell.lastPlace(),
    isLocked: () => !!(lock && lock.isLocked()),

    // ---- Claude, installation, dossier du téléphone ----
    claude,
    pwa: { state: pwaState, install: promptInstall, update: applyUpdate, check: checkForUpdate, reserve: reserveInfo },
    folder: {
      info: folderInfo,
      /** Fait choisir le dossier où copier les fichiers. Renvoie true s'il est prêt. */
      async choose() {
        const record = await chooseFolder();
        if (!record) return false;
        await store.setSetting(FOLDER_KEY, record);
        return true;
      },
      /** Redemande au téléphone l'accès au dossier déjà choisi. */
      async allow() {
        const ok = await allowFolder();
        shell.refresh();
        refreshBadges();
        return ok;
      },
      async forget() {
        forgetFolder();
        await store.setSetting(FOLDER_KEY, undefined);
      },
    },

    // ---- messages ----
    hideUndo: () => shell.hideUndo(),
    notify: (text) => toast(text),
    fail: (text) => toast(text, { bad: true, duration: 4500 }),

    // ---- modifications ----
    /** Valide un lot ; affiche le bouton Annuler si un libellé est fourni. Renvoie true si c'est écrit. */
    async commit(cs, { label = '', undoable = true } = {}) {
      writing++;
      try {
        const changed = await store.commit(cs, { label, undoable });
        if (changed && undoable && label) shell.showUndo(label);
        return true;
      } catch (error) {
        reportError(error, 'enregistrement');
        await alertDialog({
          title: "L'enregistrement a échoué",
          message: `Rien n'a été modifié. Détail : ${error?.message || error}\n\nSi le téléphone manque de place, libère de l'espace puis réessaie.`,
        });
        return false;
      } finally {
        writing--;
      }
    },
    /** Valide le résultat d'une fonction « plan… » ; affiche son erreur si elle refuse. */
    async run(plan, options = {}) {
      if (!plan.ok) {
        app.fail(plan.errors[0]?.message || 'Action impossible.');
        return false;
      }
      return app.commit(plan.cs, options);
    },
    async undo() {
      writing++;
      try {
        const label = await store.undo();
        if (label) toast(`Annulé : ${label.charAt(0).toLowerCase()}${label.slice(1)}`);
        else toast("Il n'y a rien à annuler");
      } catch (error) {
        reportError(error, 'annulation');
        app.fail("L'annulation a échoué.");
      } finally {
        writing--;
      }
    },

    // ---- réglages ----
    setting: (key, fallback) => store.setting(key, fallback),
    setSetting: (key, value, options) => store.setSetting(key, value, options),
    async setTheme(theme) {
      await store.setSetting('theme', theme);
      applyTheme(theme);
    },
    lockNow: () => lock && lock.lock(),
    refreshLock: () => lock && lock.refresh(),

    // ---- données d'exemple ----
    /** Remplace le contenu de l'appli par un budget fictif (pour découvrir, ou pour les tests). */
    async loadDemo() {
      const plan = planImport(store.state, buildDemoState(todayISO()), 'replace');
      await store.commit(plan.cs, { undoable: false });
      store.clearUndo();
      await store.setSetting('demo', true, { silent: true });
      await store.setSetting('onboarded', true);
    },
    /**
     * Efface tout et revient à l'écran de bienvenue. La connexion à Claude et le dossier de copie
     * sont gardés : ce sont des réglages de l'appareil, pas des données du budget.
     */
    async startOver() {
      closeAllOverlays();
      shell.hideUndo();
      const kept = Object.entries(store.settings).filter(([key]) => key.startsWith(DEVICE_SETTINGS_PREFIX));
      await store.wipe();
      for (const [key, value] of kept) await store.setSetting(key, value, { silent: true });
      await store.setSetting('seenVersion', APP_VERSION, { silent: true });
      await store.setSetting('legacyChecked', true, { silent: true });
      applyTheme('auto');
      if (lock) lock.refresh();
      shell.showTab('operations');
      maybeOnboard(app);
    },
  };

  applyTheme(store.setting('theme', 'auto'));

  // Reprise automatique des données de l'ancienne version, si elles sont sur cet appareil.
  if (store.isEmpty && !store.setting('legacyChecked')) {
    try {
      const legacy = await readLegacyV1();
      if (legacy) {
        const read = readImport(legacy);
        if (read.ok) {
          const blobs = new Map();
          for (const photo of read.photos) {
            const decoded = decodeDataUrl(photo.dataUrl);
            if (decoded) blobs.set(photo.fileId, decoded);
          }
          await applyImport(store, { read, blobs }, 'replace');
          await store.setSetting('migratedFromV1', new Date().toISOString(), { silent: true });
          await store.setSetting('onboarded', true, { silent: true });
        }
      }
    } catch (error) {
      reportError(error, 'reprise v1');
    }
    await store.setSetting('legacyChecked', true, { silent: true }).catch(() => {});
  }

  try {
    await store.tickRecurring(currentDay);
  } catch (error) {
    reportError(error, 'récurrences');
  }

  shell = createShell(app, { tabs: TABS, screens: { envelope: createEnvelopeScreen, ...SUB_SCREENS } });
  mount.replaceChildren(shell.el);
  lock = createLock(app, shell.el);
  // Point d'attention sur l'onglet « Plus » : sauvegarde conseillée, réponse de Claude à lire, ou
  // dossier de copie à réautoriser.
  const refreshBadges = () => shell.setBadge('more', !!backupReminderFor(store) || unreadTotal(store.state) > 0 || filesBlocked());
  store.subscribe(() => {
    shell.refresh();
    refreshBadges();
  });
  refreshBadges();
  shell.showTab('operations');
  shell.installBackHandling();

  // Appli installable : mise en réserve pour le hors-connexion, bandeau de mise à jour.
  onPwaChange((pwa) => {
    shell.setUpdateReady(pwa.updateReady, () => applyUpdate());
    shell.refresh();
  });
  initPwa().catch((error) => reportError(error, 'installation'));

  // Connexion à Claude : envoi de ce qui attend, relève des réponses (sans jamais déranger).
  const syncClaude = async ({ force = false } = {}) => {
    if (!claude.connected) return;
    const result = await claude.sync({ force });
    if (result.ok && result.newReplies) toast(result.newReplies > 1 ? `Claude a répondu à ${result.newReplies} commentaires (onglet Plus)` : 'Claude a répondu à ton commentaire (onglet Plus)', { duration: 5000 });
  };
  claude.onChange(() => {
    shell.refresh();
    refreshBadges();
  });
  window.addEventListener('online', () => syncClaude({ force: queuedComments(store.state).length > 0 }).catch(() => {}));

  if (!store.persistent) {
    alertDialog({
      title: 'Les données ne seront pas conservées',
      message: `Cet appareil refuse le stockage local (${db.reason || 'raison inconnue'}). Tu peux essayer l'appli, mais tout sera perdu à la fermeture. En navigation privée, ouvre plutôt une fenêtre normale.`,
    });
  }

  // Changement de jour, retour au premier plan : on remet les récurrences et l'affichage à jour.
  let hiddenAt = 0;
  const onDayCheck = async () => {
    const today = todayISO();
    if (today !== currentDay) {
      currentDay = today;
      try {
        await store.tickRecurring(today);
      } catch (error) {
        reportError(error, 'récurrences');
      }
      shell.refresh();
      refreshBadges();
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      autoBackup(store, { appVersion: APP_VERSION, today: todayISO() }).catch(() => {});
    }
  });
  onResume(() => {
    if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && store.setting('pin')) {
      closeAllOverlays();
      lock.lock();
    }
    hiddenAt = 0;
    onDayCheck();
    checkForUpdate({ force: false }).catch(() => {});
    syncClaude().catch(() => {});
  });
  setInterval(onDayCheck, 60 * 1000);

  // Tâches de fond, sans bloquer l'affichage
  setTimeout(() => {
    store.collectGarbage().catch((error) => reportError(error, 'ménage'));
    requestPersistence();
    autoBackup(store, { appVersion: APP_VERSION, today: todayISO() }).catch(() => {});
    syncClaude().catch(() => {});
  }, 1500);

  // Première ouverture après une mise à jour : on dit ce qui a changé. (La version 2.0.0 ne
  // notait pas son numéro : une appli déjà utilisée sans numéro noté vient donc de là.)
  const seenVersion = store.setting('seenVersion') || (store.setting('onboarded') ? '2.0.0' : null);
  if (seenVersion !== APP_VERSION) await store.setSetting('seenVersion', APP_VERSION, { silent: true }).catch(() => {});
  const news = seenVersion ? changesSince(seenVersion, APP_VERSION) : [];

  if (store.setting('migratedFromV1') && !store.setting('migrationSeen')) {
    await store.setSetting('migrationSeen', true, { silent: true });
    alertDialog({ title: 'Tes données ont été reprises', message: "Les opérations, enveloppes, tags et récurrences de l'ancienne version sont là. L'ancienne base n'a pas été modifiée." });
  } else if (news.length) {
    showWhatsNew(news);
  } else {
    maybeOnboard(app);
  }

  // Raccourci de l'icône de l'appli (« Nouvelle opération ») : on ouvre directement la saisie.
  try {
    if (new URLSearchParams(location.search).get('action') === 'ajouter') {
      history.replaceState(history.state, '', location.pathname);
      if (!overlayCount() && !app.isLocked()) openOperationForm(app);
    }
  } catch {
    /* adresse illisible : on ouvre l'appli normalement */
  }

  // Exposé pour les tests automatiques et le diagnostic
  window.monBudget = app;
  document.documentElement.setAttribute('data-ready', 'true');
  return app;
}

/** Écran de secours si le démarrage échoue : on dit quoi faire plutôt que de laisser une page blanche. */
export function showBootFailure(mount, error) {
  mount.replaceChildren(
    h(
      'div.empty',
      { style: { paddingTop: '20vh' } },
      h('h2', "L'appli n'a pas pu démarrer"),
      h('p', 'Ferme-la complètement puis rouvre-la. Si le problème continue, note le message ci-dessous et signale-le.'),
      h('p.hint', String(error?.message || error)),
      h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Réessayer'),
    ),
  );
}
