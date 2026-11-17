// Verrouillage par code (facultatif). Le code n'est jamais enregistré : seule son empreinte l'est.
// C'est un rideau contre les regards indiscrets, pas un chiffrement : quelqu'un qui a le téléphone
// déverrouillé et de solides connaissances techniques pourrait toujours lire les fichiers de l'appli.

import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { sha256 } from '../../core/sha256.js';

export const PIN_MIN = 4;
export const PIN_MAX = 6;
const MAX_TRIES = 5;
const WAIT_MS = 30 * 1000;

export function hashPin(code, salt) {
  return sha256(`${salt}:${code}`);
}

export function makePin(code) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const salt = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { salt, hash: hashPin(code, salt), length: code.length };
}

export function checkPin(pin, code) {
  return !!pin && hashPin(code, pin.salt) === pin.hash;
}

/** Clavier à chiffres réutilisable (verrouillage, et choix du code dans Sécurité). */
export function keypad({ onDigit, onErase, extra = null }) {
  const el = h('div.keypad', { role: 'group', 'aria-label': 'Clavier' });
  for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) el.appendChild(h('button', { type: 'button', dataset: { key: d }, onclick: () => onDigit(d) }, d));
  el.appendChild(extra || h('span'));
  el.appendChild(h('button', { type: 'button', dataset: { key: '0' }, onclick: () => onDigit('0') }, '0'));
  el.appendChild(h('button.ghost', { type: 'button', 'aria-label': 'Effacer le dernier chiffre', dataset: { key: 'erase' }, onclick: onErase }, icon('back')));
  return el;
}

export function createLock(app, frame) {
  let el = null;
  let code = '';
  let tries = 0;
  let waitUntil = 0;

  function pin() {
    return app.setting('pin', null);
  }

  function unlock() {
    if (el) el.remove();
    el = null;
    code = '';
    tries = 0;
  }

  function lock() {
    const current = pin();
    if (!current || el) return;
    code = '';
    const dots = h('div.dots', { 'aria-hidden': 'true' });
    const status = h('p.hint', { role: 'status' });
    const paint = () => {
      clear(dots);
      for (let i = 0; i < current.length; i++) dots.appendChild(h('i', { class: i < code.length ? 'on' : '' }));
    };
    const onDigit = (d) => {
      if (Date.now() < waitUntil) {
        clear(status).appendChild(document.createTextNode(`Trop d'essais. Réessaie dans ${Math.ceil((waitUntil - Date.now()) / 1000)} s.`));
        return;
      }
      if (code.length >= current.length) return;
      code += d;
      paint();
      if (code.length < current.length) return;
      if (checkPin(current, code)) {
        unlock();
        return;
      }
      tries++;
      code = '';
      dots.classList.remove('shake');
      void dots.offsetWidth; // relance l'animation
      dots.classList.add('shake');
      paint();
      if (tries >= MAX_TRIES) {
        tries = 0;
        waitUntil = Date.now() + WAIT_MS;
        clear(status).appendChild(document.createTextNode("Trop d'essais. Réessaie dans 30 s."));
      } else {
        clear(status).appendChild(document.createTextNode('Code incorrect.'));
      }
    };
    const onErase = () => {
      code = code.slice(0, -1);
      paint();
    };
    // L'aide s'affiche dans l'écran de verrouillage lui-même : rien ne doit passer par-dessus lui.
    const help = h(
      'p.hint',
      { hidden: true, dataset: { help: 'forgot' }, style: { maxWidth: '34ch', textAlign: 'center' } },
      "Le code ne peut pas être retrouvé : rien n'est stocké en ligne. Pour repartir : dans les réglages d'Android, ouvre Applications › Mon Budget › Stockage › Effacer les données, puis restaure ta dernière sauvegarde depuis l'appli (elle se trouve dans Documents/MonBudget/Sauvegardes).",
    );
    const forgot = h(
      'button.link-btn',
      {
        type: 'button',
        'aria-expanded': 'false',
        onclick: () => {
          help.hidden = !help.hidden;
          forgot.setAttribute('aria-expanded', String(!help.hidden));
        },
      },
      'Code oublié ?',
    );
    el = h(
      'div.lock',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Appli verrouillée' },
      icon('lock', 'lg'),
      h('h1', 'Saisis ton code'),
      dots,
      status,
      keypad({ onDigit, onErase }),
      forgot,
      help,
    );
    paint();
    frame.appendChild(el);
    el.addEventListener('keydown', (event) => {
      if (/^\d$/.test(event.key)) onDigit(event.key);
      else if (event.key === 'Backspace') onErase();
    });
    el.tabIndex = -1;
    el.focus();
  }

  if (pin()) lock();

  return {
    isLocked: () => !!el,
    lock,
    unlock,
    refresh() {
      if (!pin()) unlock();
    },
  };
}
