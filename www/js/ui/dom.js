// Fabrique d'éléments d'interface. Toute l'interface est construite avec h() : le texte y est
// toujours inséré comme du texte (jamais comme du HTML), ce qui exclut d'office les injections.

import { formatAmount } from '../core/money.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

function applyProps(el, props, isSvg) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      if (isSvg) el.setAttribute('class', value);
      else el.className = el.className ? `${el.className} ${value}` : value;
    } else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (k.startsWith('--')) el.style.setProperty(k, v);
        else el.style[k] = v;
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) el.dataset[k] = v;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else if (!isSvg && (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden')) {
      el[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/**
 * h('button.btn.primary', { onclick: … , 'aria-label': '…' }, 'Texte', autreElement)
 * Le premier argument peut porter des classes (« div.card »). Les enfants null / false sont ignorés.
 */
export function h(spec, props, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (props instanceof Node || typeof props !== 'object' || Array.isArray(props))) {
    children.unshift(props);
  } else if (props) {
    applyProps(el, props, false);
  }
  append(el, children);
  return el;
}

/** Même chose pour les éléments SVG (graphiques, icônes). */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) applyProps(el, attrs, true);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Montant mis en forme, avec la bonne couleur : vert si positif (quand colorer = true), rouge si alerte. */
export function amount(cents, { sign = 'auto', colored = false, alertNegative = false, extra = '' } = {}) {
  let cls = 'amt';
  if (alertNegative && cents < 0) cls += ' alert';
  else if (colored && cents > 0) cls += ' pos';
  else if (colored && cents < 0) cls += ' neg';
  if (extra) cls += ` ${extra}`;
  return h('span', { class: cls }, formatAmount(cents, { sign }));
}

const THIN = ' '; // séparateur de milliers de formatAmount

/** L'espace des milliers, glissée dans un span.thsep que le CSS élargit un peu : en grand, elle se voit à peine. */
function spaceThousands(text) {
  const out = [];
  text.split(THIN).forEach((part, i) => {
    if (i) out.push(h('span.thsep', THIN));
    if (part) out.push(part);
  });
  return out;
}

/** Montant affiché en grand (tuiles des statistiques) : même texte, milliers bien séparés. */
export function displayAmount(cents, { sign = 'auto' } = {}) {
  return spaceThousands(formatAmount(cents, { sign }));
}

/**
 * Grand montant (en-tête des soldes) : les euros en grand, « ,34 € » plus discret. Le texte lu
 * reste « 1 978,34 € » (les morceaux se suivent sans rien ajouter).
 */
export function bigAmount(cents, { sign = 'auto' } = {}) {
  const text = formatAmount(cents, { sign });
  const comma = text.lastIndexOf(',');
  if (comma < 0) return text;
  return [h('span.int', spaceThousands(text.slice(0, comma))), h('span.dec', text.slice(comma))];
}

/** « 1 opération », « 3 opérations » */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Appelle fn au plus une fois par image affichée (regroupe les rafraîchissements). */
export function throttleFrame(fn) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn();
    });
  };
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}
