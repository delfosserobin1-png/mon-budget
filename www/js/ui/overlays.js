// Tout ce qui s'affiche PAR-DESSUS un écran : feuilles (panneaux qui montent du bas), boîtes de
// dialogue, messages brefs. Aucune fenêtre native (alert / confirm) n'est utilisée : elles sont
// laides sur Android et bloquent l'appli.

import { h, clear } from './dom.js';
import { icon } from './icons.js';

let root = null;
let toastRoot = null;
let background = null; // l'écran derrière, rendu inerte tant qu'une feuille est ouverte
const stack = [];

export function initOverlays({ overlayRoot, toasts, behind }) {
  root = overlayRoot;
  toastRoot = toasts;
  background = behind;
}

function sync() {
  if (background) {
    if (stack.length) background.setAttribute('inert', '');
    else background.removeAttribute('inert');
  }
  stack.forEach((entry, i) => {
    if (i < stack.length - 1) entry.el.setAttribute('inert', '');
    else entry.el.removeAttribute('inert');
  });
}

function register(entry) {
  entry.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  stack.push(entry);
  root.appendChild(entry.el);
  sync();
}

function unregister(entry) {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  entry.el.remove();
  sync();
  const target = entry.previousFocus;
  if (target && target.isConnected) {
    try {
      target.focus({ preventScroll: true });
    } catch {
      /* sans importance */
    }
  }
}

export function overlayCount() {
  return stack.length;
}

/** Ferme ce qui est au premier plan (bouton retour). Renvoie true s'il y avait quelque chose. */
export function closeTopOverlay() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.requestClose();
  return true;
}

export function closeAllOverlays() {
  for (const entry of [...stack].reverse()) entry.forceClose();
}

/**
 * Ouvre une feuille.
 *   title, body (élément), foot (élément ou liste de boutons), full (pleine hauteur)
 *   canClose : fonction (éventuellement asynchrone) appelée avant une fermeture demandée par
 *              l'utilisateur ; renvoyer false l'empêche.
 * Renvoie { el, body, foot, close(valeur), closed (promesse de la valeur), setTitle }.
 */
export function openSheet({ title = '', body = null, foot = null, full = false, canClose = null, label = '' } = {}) {
  let resolve;
  const closed = new Promise((r) => {
    resolve = r;
  });
  const titleEl = h('h2', title);
  const bodyEl = h('div.sheet-body', body);
  const footEl = foot ? h('div.sheet-foot', foot) : null;
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Fermer', onclick: () => entry.requestClose() }, icon('x'));
  const sheet = h(
    'div',
    { class: full ? 'sheet full' : 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title },
    h('div.sheet-head', titleEl, closeBtn),
    bodyEl,
    footEl,
  );
  const el = h('div.overlay', h('div.scrim', { onclick: () => entry.requestClose() }), sheet);
  let done = false;
  let closing = false;
  const entry = {
    el,
    forceClose(value = null) {
      if (done) return;
      done = true;
      unregister(entry);
      resolve(value);
    },
    async requestClose() {
      if (done || closing) return;
      if (canClose) {
        closing = true;
        let ok = false;
        try {
          ok = await canClose();
        } finally {
          closing = false;
        }
        if (ok === false) return;
      }
      entry.forceClose(null);
    },
  };
  register(entry);
  requestAnimationFrame(() => {
    const auto = sheet.querySelector('[data-autofocus]');
    try {
      (auto || closeBtn).focus({ preventScroll: true });
    } catch {
      /* sans importance */
    }
  });
  return {
    el: sheet,
    body: bodyEl,
    foot: footEl,
    closed,
    close: (value = null) => entry.forceClose(value),
    setTitle: (text) => {
      clear(titleEl).appendChild(document.createTextNode(text));
    },
    get isOpen() {
      return !done;
    },
  };
}

function openDialog({ title, message, content = null, buttons, dismissValue = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      unregister(entry);
      resolve(value);
    };
    const actions = h(
      'div',
      { class: buttons.length === 2 && buttons.every((b) => b.label.length <= 14) ? 'actions inline' : 'actions' },
      buttons.map((b, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}${b.quiet ? ' quiet' : ''}`,
            'data-autofocus': i === 0 ? true : null,
            'data-value': String(b.value),
            onclick: () => finish(b.value),
          },
          b.label,
        ),
      ),
    );
    const dialog = h(
      'div.dialog',
      { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', title),
      message ? h('p.message', message) : null,
      content,
      actions,
    );
    const el = h('div.overlay.centered', h('div.scrim', { onclick: () => finish(dismissValue) }), dialog);
    const entry = { el, requestClose: () => finish(dismissValue), forceClose: () => finish(dismissValue) };
    register(entry);
    requestAnimationFrame(() => {
      const auto = dialog.querySelector('[data-autofocus]');
      try {
        if (auto) auto.focus({ preventScroll: true });
      } catch {
        /* sans importance */
      }
    });
  });
}

/** Question oui / non. Renvoie true si l'utilisateur confirme. */
export function confirmDialog({ title, message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
  return openDialog({
    title,
    message,
    buttons: [
      { label: confirmLabel, value: true, primary: !danger, danger },
      { label: cancelLabel, value: false, quiet: true },
    ],
    dismissValue: false,
  });
}

/** Choix entre plusieurs actions. Renvoie l'identifiant choisi, ou null si l'utilisateur renonce. */
export function chooseDialog({ title, message = '', options, cancelLabel = 'Annuler', content = null }) {
  return openDialog({
    title,
    message,
    content,
    buttons: [...options.map((o) => ({ label: o.label, value: o.id, primary: !!o.primary, danger: !!o.danger })), { label: cancelLabel, value: null, quiet: true }],
    dismissValue: null,
  });
}

/** Simple information à lire. */
export function alertDialog({ title, message = '', okLabel = 'Compris', content = null }) {
  return openDialog({ title, message, content, buttons: [{ label: okLabel, value: true, primary: true }], dismissValue: true });
}

/**
 * Demande un texte. `validate(texte)` peut renvoyer un message d'erreur (la boîte reste alors
 * ouverte). Renvoie le texte saisi, ou null si l'utilisateur renonce.
 */
export function promptDialog({ title, message = '', label = '', value = '', placeholder = '', confirmLabel = 'Valider', cancelLabel = 'Annuler', validate = null, maxLength = 60, inputMode = null, type = 'text' }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      unregister(entry);
      resolve(result);
    };
    const input = h('input', { type, maxlength: maxLength, placeholder, autocomplete: 'off', inputmode: inputMode, 'aria-label': label || title, 'data-autofocus': true });
    input.value = value;
    const error = h('div.error', { role: 'alert', hidden: true });
    const field = h('div.field', { style: { marginTop: '14px' } }, label ? h('label', label) : null, input, error);
    const submit = async () => {
      const text = input.value.trim();
      const problem = validate ? await validate(text) : null;
      if (problem) {
        field.classList.add('invalid');
        error.hidden = false;
        clear(error).appendChild(document.createTextNode(problem));
        input.focus();
        return;
      }
      finish(text);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    input.addEventListener('input', () => {
      field.classList.remove('invalid');
      error.hidden = true;
    });
    const dialog = h(
      'div.dialog',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', title),
      message ? h('p.message', message) : null,
      field,
      h(
        'div.actions.inline',
        h('button.btn.primary', { type: 'button', 'data-value': 'ok', onclick: submit }, confirmLabel),
        h('button.btn.quiet', { type: 'button', 'data-value': 'cancel', onclick: () => finish(null) }, cancelLabel),
      ),
    );
    const el = h('div.overlay.centered', h('div.scrim', { onclick: () => finish(null) }), dialog);
    const entry = { el, requestClose: () => finish(null), forceClose: () => finish(null) };
    register(entry);
    requestAnimationFrame(() => {
      try {
        input.focus({ preventScroll: true });
        input.select();
      } catch {
        /* sans importance */
      }
    });
  });
}

/** Petit bouton ⓘ qui ouvre une explication. */
export function infoButton(title, message) {
  return h(
    'button.info-btn',
    {
      type: 'button',
      'aria-label': `Explication : ${title}`,
      onclick: (event) => {
        event.stopPropagation();
        alertDialog({ title, message });
      },
    },
    icon('info'),
  );
}

/** Message bref en bas de l'écran. */
export function toast(message, { bad = false, duration = 3200 } = {}) {
  if (!toastRoot) return;
  const el = h('div', { class: bad ? 'toast bad' : 'toast', role: bad ? 'alert' : 'status' }, message);
  // un seul message à la fois : le nouveau remplace l'ancien
  clear(toastRoot).appendChild(el);
  setTimeout(() => {
    if (el.isConnected) el.remove();
  }, duration);
}
