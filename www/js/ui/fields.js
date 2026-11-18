// Champs de formulaire. Chaque fabrique renvoie un petit objet :
//   { el, value (lecture / écriture), setError(message), focus() }

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { formatDate, isValidISO } from '../core/dates.js';
import { formatForInput, parseAmount } from '../core/money.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

/** Habille un contrôle : libellé au-dessus, message d'erreur en dessous. */
function wrapField({ label, optional = false, control, input = null, hint = null, name = '' }) {
  const target = input || control;
  if (!target.id) target.id = nextId('champ');
  const error = h('div.error', { role: 'alert', hidden: true });
  const el = h(
    'div.field',
    { dataset: { field: name || null } },
    label ? h('label', { for: target.id }, label, optional ? h('span.optional', optional === 'f' ? ' (facultative)' : ' (facultatif)') : null) : null,
    control,
    hint ? h('div.hint', hint) : null,
    error,
  );
  return {
    el,
    setError(message) {
      el.classList.toggle('invalid', !!message);
      error.hidden = !message;
      clear(error);
      if (message) error.appendChild(document.createTextNode(message));
    },
  };
}

/**
 * Prévient onInput à chaque frappe (« input »). Filet de sécurité : une suggestion (liste du champ,
 * clavier du téléphone) peut changer la valeur sans « input » ; « change », qui arrive au plus tard
 * quand on quitte le champ, la rattrape — mais seulement si elle a vraiment changé, pour ne rien
 * redessiner au moment précis où l'on touche un autre bouton.
 */
function watchValue(input, onInput, onTyping) {
  let last = input.value;
  input.addEventListener('input', () => {
    last = input.value;
    onTyping();
    if (onInput) onInput(input.value);
  });
  input.addEventListener('change', () => {
    if (input.value === last) return;
    last = input.value;
    if (onInput) onInput(input.value);
  });
}

export function textField({ label, value = '', placeholder = '', optional = false, name = '', maxLength = 120, suggestions = null, onInput = null, hint = null, type = 'text', inputMode = null, autocapitalize = 'sentences' }) {
  const input = h('input', { type, placeholder, maxlength: maxLength, autocomplete: 'off', autocapitalize, inputmode: inputMode, name: name || null });
  input.value = value;
  let list = null;
  if (suggestions && suggestions.length) {
    list = h('datalist', { id: nextId('liste') }, suggestions.slice(0, 60).map((text) => h('option', { value: text })));
    input.setAttribute('list', list.id);
  }
  const field = wrapField({ label, optional, control: input, hint, name });
  if (list) field.el.appendChild(list);
  watchValue(input, onInput, () => field.setError(''));
  return {
    ...field,
    input,
    get value() {
      return input.value.trim();
    },
    set value(v) {
      input.value = v ?? '';
    },
    focus: () => input.focus(),
  };
}

export function textArea({ label, value = '', placeholder = '', optional = false, name = '', maxLength = 2000, onInput = null, rows = 3 }) {
  const input = h('textarea', { placeholder, maxlength: maxLength, rows, name: name || null });
  input.value = value;
  const field = wrapField({ label, optional, control: input, name });
  watchValue(input, onInput, () => field.setError(''));
  return {
    ...field,
    input,
    get value() {
      return input.value.trim();
    },
    set value(v) {
      input.value = v ?? '';
    },
    focus: () => input.focus(),
  };
}

/** Montant en euros (toujours positif : le sens est porté par le type d'opération). */
export function amountField({ label = 'Montant', cents = null, name = 'amount', optional = false, big = true, onInput = null, autofocus = false }) {
  const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', name, 'data-autofocus': autofocus ? true : null, 'aria-label': label });
  if (cents !== null && cents !== undefined) input.value = formatForInput(cents);
  const control = h('div.amount-input', input, h('span.unit', { 'aria-hidden': 'true' }, '€'));
  const field = wrapField({ label, optional, control, input, name });
  if (!big) {
    input.style.setProperty('font-size', '18px', 'important');
    input.style.setProperty('min-height', '48px', 'important');
  }
  input.addEventListener('input', () => {
    // on tolère le point comme séparateur, et on empêche les caractères sans rapport
    const cleaned = input.value.replace(/[^\d.,\s]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
    field.setError('');
    if (onInput) onInput(input.value);
  });
  return {
    ...field,
    input,
    /** Centimes saisis, ou null si le champ est vide ou illisible. */
    get cents() {
      const text = input.value.trim();
      return text ? parseAmount(text) : null;
    },
    set cents(v) {
      input.value = v === null || v === undefined ? '' : formatForInput(v);
    },
    get isEmpty() {
      return input.value.trim() === '';
    },
    get raw() {
      return input.value;
    },
    set raw(v) {
      input.value = v || '';
    },
    focus: () => input.focus(),
  };
}

function pickerField({ kind, label, value, optional, name, onChange, min = null, max = null, compact = false }) {
  const input = h('input', { type: kind, name: name || null, min, max, 'aria-label': label || (kind === 'date' ? 'Date' : 'Heure') });
  const text = h('span.grow');
  const button = h('div.picker-btn', { 'aria-hidden': 'true' }, icon(kind === 'date' ? 'calendar' : 'clock'), text);
  const clearBtn = h('button.icon-btn.clear', { type: 'button', 'aria-label': kind === 'date' ? 'Effacer la date' : "Effacer l'heure", hidden: true }, icon('x', 'sm'));
  const control = h('div.picker', input, button, clearBtn);
  const field = compact ? { el: control, setError() {} } : wrapField({ label, optional, control, input, name });
  const placeholder = kind === 'date' ? 'JJ-MM-AAAA' : 'Non précisée';
  const show = () => {
    const v = input.value;
    const shown = kind === 'date' ? (isValidISO(v) ? formatDate(v) : '') : v;
    clear(text).appendChild(document.createTextNode(shown || placeholder));
    button.classList.toggle('placeholder', !shown);
    clearBtn.hidden = !(optional && shown);
  };
  input.value = value || '';
  show();
  const changed = () => {
    show();
    field.setError('');
    if (onChange) onChange(input.value || null);
  };
  input.addEventListener('input', changed);
  input.addEventListener('change', changed);
  input.addEventListener('click', () => {
    // sur ordinateur, un clic sur le texte n'ouvre pas le calendrier : on l'ouvre nous-mêmes
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
    } catch {
      /* déjà ouvert, ou non autorisé : le champ reste utilisable au clavier */
    }
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    changed();
  });
  return {
    ...field,
    input,
    get value() {
      const v = input.value;
      if (kind === 'date') return isValidISO(v) ? v : null;
      return /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null;
    },
    set value(v) {
      input.value = v || '';
      show();
    },
    focus: () => input.focus(),
  };
}

/** Date : affichée JJ-MM-AAAA, choisie avec le calendrier du téléphone. */
export function dateField(options) {
  return pickerField({ kind: 'date', ...options });
}

export function timeField(options) {
  return pickerField({ kind: 'time', ...options });
}

export function selectField({ label, value = '', options, name = '', onChange = null, optional = false, hint = null }) {
  const select = h(
    'select',
    { name: name || null },
    options.map((o) => h('option', { value: o.value, disabled: o.disabled ? true : null }, o.label)),
  );
  select.value = value ?? '';
  const field = wrapField({ label, optional, control: select, name, hint });
  select.addEventListener('change', () => {
    field.setError('');
    if (onChange) onChange(select.value);
  });
  return {
    ...field,
    input: select,
    get value() {
      return select.value;
    },
    set value(v) {
      select.value = v ?? '';
    },
    setOptions(list, keep) {
      clear(select);
      for (const o of list) select.appendChild(h('option', { value: o.value }, o.label));
      if (keep !== undefined) select.value = keep;
    },
    focus: () => select.focus(),
  };
}

/** Choix exclusif entre 2 à 4 options, côte à côte. */
export function segmented({ options, value, onChange, label = '' }) {
  let current = value;
  const buttons = new Map();
  const el = h('div.seg', { role: 'group', 'aria-label': label || null });
  for (const o of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === current), dataset: { value: o.value } }, o.label);
    b.addEventListener('click', () => {
      if (current === o.value) return;
      current = o.value;
      for (const [v, btn] of buttons) btn.setAttribute('aria-pressed', String(v === current));
      if (onChange) onChange(current);
    });
    buttons.set(o.value, b);
    el.appendChild(b);
  }
  return {
    el,
    get value() {
      return current;
    },
    set value(v) {
      current = v;
      for (const [val, btn] of buttons) btn.setAttribute('aria-pressed', String(val === current));
    },
  };
}

/**
 * Étiquettes à cocher. multiple = plusieurs choix possibles ; sinon un seul (et on peut le retirer
 * en le touchant de nouveau si allowNone est vrai).
 * options : [{ id, label, color? }]
 */
export function pickList({ options, selected = [], multiple = true, allowNone = true, onChange = null, label = '', extra = null }) {
  const chosen = new Set(selected);
  const el = h('div.chips', { role: 'group', 'aria-label': label || null });
  const render = (list) => {
    clear(el);
    for (const o of list) {
      const b = h(
        'button',
        { type: 'button', class: `pick${o.color ? ` k-${o.color}` : ''}`, 'aria-pressed': String(chosen.has(o.id)), dataset: { value: o.id } },
        o.color ? h('span.dot') : null,
        o.label,
      );
      b.addEventListener('click', () => {
        if (multiple) {
          if (chosen.has(o.id)) chosen.delete(o.id);
          else chosen.add(o.id);
        } else if (chosen.has(o.id)) {
          if (allowNone) chosen.clear();
        } else {
          chosen.clear();
          chosen.add(o.id);
        }
        for (const btn of el.querySelectorAll('button[data-value]')) btn.setAttribute('aria-pressed', String(chosen.has(btn.dataset.value)));
        if (onChange) onChange([...chosen]);
      });
      el.appendChild(b);
    }
    if (extra) el.appendChild(extra);
  };
  render(options);
  return {
    el,
    get value() {
      return [...chosen];
    },
    set value(list) {
      chosen.clear();
      for (const id of list || []) chosen.add(id);
      for (const btn of el.querySelectorAll('button[data-value]')) btn.setAttribute('aria-pressed', String(chosen.has(btn.dataset.value)));
    },
    /** Remplace la liste des options (les choix encore valables sont gardés). */
    setOptions(list) {
      const ids = new Set(list.map((o) => o.id));
      for (const id of [...chosen]) if (!ids.has(id)) chosen.delete(id);
      render(list);
    },
  };
}

/** Interrupteur avec un titre et, si besoin, une ligne d'explication. */
export function toggle({ label, hint = '', checked = false, onChange = null, name = '' }) {
  let state = !!checked;
  const el = h(
    'button.switch-row',
    { type: 'button', role: 'switch', 'aria-checked': String(state), dataset: { field: name || null } },
    h('span.texts', h('b', label), hint ? h('span', hint) : null),
    h('span.switch', { 'aria-hidden': 'true' }),
  );
  el.addEventListener('click', () => {
    state = !state;
    el.setAttribute('aria-checked', String(state));
    if (onChange) onChange(state);
  });
  return {
    el,
    get value() {
      return state;
    },
    set value(v) {
      state = !!v;
      el.setAttribute('aria-checked', String(state));
    },
  };
}

/** Groupe de champs avec un petit titre. */
export function fieldGroup(label, ...children) {
  return h('div.field', label ? h('div.label', label) : null, ...children);
}
