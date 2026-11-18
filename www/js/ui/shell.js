// Ossature de l'appli : la zone d'écran, la barre d'onglets, les sous-écrans empilés, le bouton
// « retour » et le bouton « Annuler ».
//
// Un écran est un objet { el, update(), onShow?(), handleBack?() } :
//   - el          : son élément (construit une fois) ;
//   - update()    : remet l'affichage à jour d'après les données ;
//   - handleBack(): renvoie true s'il a consommé le « retour » (ex. : sortir du mode sélection).

import { h, throttleFrame } from './dom.js';
import { icon } from './icons.js';
import { closeTopOverlay, initOverlays, overlayCount, toast } from './overlays.js';
import { exitApp, onNativeBack } from '../platform/platform.js';

const UNDO_VISIBLE_MS = 7000;

export function createShell(app, { tabs, screens }) {
  const host = h('div.screen-host');
  const tabbar = h('nav.tabbar', { 'aria-label': 'Navigation principale' });
  const overlayRoot = h('div.overlay-root');
  // Messages passagers : jamais sur les captures du bouton IA (data-capture, voir ui/capture.js).
  const toasts = h('div.toast-root', { 'aria-live': 'polite', 'data-capture': 'skip' });
  // Bandeau « nouvelle version » : au-dessus de tout écran, sans rien recouvrir.
  const updateBar = h('div.update-bar', { role: 'status', hidden: true });
  const main = h('div.frame-main', updateBar, host, tabbar);
  const frame = h('div.frame', main, overlayRoot, toasts);
  initOverlays({ overlayRoot, toasts, behind: main });

  const tabScreens = new Map(); // id → écran (créé à la première visite)
  const stack = []; // sous-écrans : [{ name, params, screen }]
  let activeTab = tabs[0].id;
  let visible = null;
  const dirty = new Set();
  // Dernier écran « de travail » affiché : sert à pré-remplir « Ça concerne » d'un commentaire.
  // L'onglet Plus et les écrans de commentaires n'en sont pas : on y passe pour écrire, pas pour travailler.
  const NOT_A_PLACE = new Set(['more', 'bugs', 'claude']);
  let lastPlace = tabs[0].id;

  const tabButtons = new Map();
  for (const tab of tabs) {
    const button = h('button', { type: 'button', dataset: { tab: tab.id }, onclick: () => showTab(tab.id) }, h('span.tab-icon', icon(tab.icon)), h('span', tab.label));
    tabButtons.set(tab.id, button);
    tabbar.appendChild(button);
  }

  /** Petit point d'attention sur un onglet (ex. « Plus » quand une sauvegarde est conseillée). */
  function setBadge(id, on) {
    const button = tabButtons.get(id);
    if (!button) return;
    if (on) button.dataset.badge = 'true';
    else delete button.dataset.badge;
  }

  function tabScreen(id) {
    if (!tabScreens.has(id)) {
      const tab = tabs.find((t) => t.id === id);
      const screen = tab.create(app);
      screen.el.hidden = true;
      host.appendChild(screen.el);
      tabScreens.set(id, screen);
    }
    return tabScreens.get(id);
  }

  function present() {
    const next = stack.length ? stack[stack.length - 1].screen : tabScreen(activeTab);
    if (visible && visible !== next) visible.el.hidden = true;
    const changed = visible !== next;
    visible = next;
    visible.el.hidden = false;
    tabbar.hidden = stack.length > 0;
    for (const [id, button] of tabButtons) {
      if (id === activeTab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (changed || dirty.has(visible)) {
      dirty.delete(visible);
      safeUpdate(visible);
    }
    const name = stack.length ? stack[stack.length - 1].name : activeTab;
    if (!NOT_A_PLACE.has(name)) lastPlace = name;
    if (changed && visible.onShow) visible.onShow();
    positionUndo();
  }

  /** Affiche (ou retire) le bandeau « Nouvelle version prête » ; `apply` est appelé au toucher du bouton. */
  let updateShown = false;
  function setUpdateReady(on, apply) {
    if (!!on === updateShown) return;
    updateShown = !!on;
    updateBar.hidden = !on;
    updateBar.replaceChildren();
    if (!on) return;
    const button = h(
      'button.btn.small.primary',
      {
        type: 'button',
        dataset: { action: 'apply-update' },
        onclick: () => {
          button.disabled = true;
          button.replaceChildren(document.createTextNode('Mise à jour…'));
          apply();
        },
      },
      'Mettre à jour',
    );
    updateBar.append(icon('sparkle'), h('span.grow', 'Une nouvelle version est prête.'), button);
  }

  function safeUpdate(screen) {
    try {
      screen.update();
    } catch (error) {
      app.reportError(error);
    }
  }

  function showTab(id, params = null) {
    while (stack.length) stack.pop().screen.el.remove();
    activeTab = id;
    const screen = tabScreen(id);
    if (params && screen.setParams) screen.setParams(params);
    dirty.add(screen);
    present();
  }

  function pushScreen(name, params = {}) {
    const create = screens[name];
    if (!create) throw new Error(`Écran inconnu : ${name}`);
    const screen = create(app, params);
    host.appendChild(screen.el);
    stack.push({ name, params, screen });
    dirty.add(screen);
    present();
    return screen;
  }

  function popScreen() {
    const entry = stack.pop();
    if (!entry) return false;
    entry.screen.el.remove();
    if (entry.screen.onClose) entry.screen.onClose();
    // l'écran qu'on retrouve doit refléter les changements faits entre-temps
    dirty.add(stack.length ? stack[stack.length - 1].screen : tabScreen(activeTab));
    present();
    return true;
  }

  /** Les données ont changé : l'écran visible se met à jour, les autres le feront à leur retour. */
  const refresh = throttleFrame(() => {
    for (const screen of tabScreens.values()) dirty.add(screen);
    for (const entry of stack) dirty.add(entry.screen);
    if (visible) {
      dirty.delete(visible);
      safeUpdate(visible);
    }
  });

  // ---- Bouton « Annuler » : discret, en bas à gauche, quelques secondes après chaque action ----
  let undoPill = null;
  let undoTimer = null;
  function hideUndo() {
    clearTimeout(undoTimer);
    if (undoPill) undoPill.remove();
    undoPill = null;
  }
  function positionUndo() {
    if (undoPill && visible && undoPill.parentNode !== host) host.appendChild(undoPill);
  }
  function showUndo(label) {
    hideUndo();
    if (!app.store.canUndo) return;
    undoPill = h(
      'button.undo-pill',
      {
        type: 'button',
        'aria-label': `Annuler : ${label}`,
        title: label,
        'data-capture': 'skip',
        onclick: async () => {
          hideUndo();
          await app.undo();
        },
      },
      icon('undo'),
      'Annuler',
    );
    host.appendChild(undoPill);
    undoTimer = setTimeout(hideUndo, UNDO_VISIBLE_MS);
  }

  // ---- Bouton « retour » ----
  // Ordre : fermer la feuille ouverte → laisser l'écran réagir (ex. quitter le mode sélection) →
  // dépiler le sous-écran → revenir au premier onglet → proposer de quitter.
  let exitArmedUntil = 0;
  function handleBack() {
    if (app.isLocked()) return true;
    if (app.viewerClose) {
      app.viewerClose(); // photo affichée en plein écran
      return true;
    }
    if (closeTopOverlay()) return true;
    if (visible && visible.handleBack && visible.handleBack()) return true;
    if (stack.length) {
      popScreen();
      return true;
    }
    if (activeTab !== tabs[0].id) {
      showTab(tabs[0].id);
      return true;
    }
    return false;
  }

  /** Premier appui : on prévient. Second appui dans les 2,5 s : on laisse quitter (renvoie false). */
  function confirmExit() {
    const now = Date.now();
    if (now < exitArmedUntil) return false;
    exitArmedUntil = now + 2500;
    toast('Appuie encore une fois sur Retour pour quitter');
    return true;
  }

  function installBackHandling() {
    // Android avec le module « App » de Capacitor : le bouton physique nous est transmis directement.
    const native = onNativeBack(() => {
      if (handleBack()) return;
      if (!confirmExit()) exitApp();
    });
    if (native) return;
    // Sinon (navigateur) : on garde toujours une entrée « piège » dans l'historique, pour que
    // Retour ferme la feuille ou le sous-écran au lieu de quitter la page.
    const pushTrap = () => {
      try {
        history.pushState({ monBudget: 'piege' }, '');
      } catch {
        /* historique indisponible */
      }
    };
    try {
      history.replaceState({ monBudget: 'racine' }, '');
      pushTrap();
      window.addEventListener('popstate', () => {
        if (handleBack() || confirmExit()) pushTrap();
        else if (!exitApp()) history.back();
      });
    } catch {
      /* page ouverte hors serveur : Retour quittera simplement la page */
    }
  }

  return {
    el: frame,
    host,
    showTab,
    pushScreen,
    popScreen,
    refresh,
    showUndo,
    hideUndo,
    setBadge,
    setUpdateReady,
    lastPlace: () => lastPlace,
    handleBack,
    installBackHandling,
    get activeTab() {
      return activeTab;
    },
    get depth() {
      return stack.length;
    },
    get busy() {
      return overlayCount() > 0;
    },
    currentName() {
      return stack.length ? stack[stack.length - 1].name : activeTab;
    },
    tabScreen,
  };
}

/** Barre du haut d'un sous-écran : flèche retour, titre, actions à droite. */
export function subTopbar(app, title, ...actions) {
  const titleEl = h('h1', title);
  const el = h(
    'header.topbar.sub',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Retour', onclick: () => app.back() }, icon('back')),
    titleEl,
    ...actions,
  );
  return { el, titleEl };
}
