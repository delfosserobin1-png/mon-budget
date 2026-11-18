// Une ligne d'opération, et la liste (avec ses séparateurs de mois) — utilisées par tous les écrans.

import { h, amount } from './dom.js';
import { icon } from './icons.js';
import { KIND } from '../core/schema.js';
import { accountName, moveLabel, operationTitle, transferTitle } from '../core/operations.js';
import { availableDelta, envelopeDelta } from '../core/balances.js';
import { formatMonthKey, monthKey, weekdayName } from '../core/dates.js';

const LONG_PRESS_MS = 480;

/** Montant à afficher selon le point de vue (null = compte courant, sinon une enveloppe). */
function displayedAmount(op, perspective) {
  if (perspective === null) {
    if (op.kind === KIND.TRANSFER) {
      const delta = availableDelta(op);
      return delta !== 0 ? { cents: delta, sign: 'always', tone: 'quiet' } : { cents: op.amount, sign: 'never', tone: 'quiet' };
    }
    if (op.envelopeId) return { cents: op.amount, sign: 'always', tone: 'quiet' };
    return { cents: op.amount, sign: 'always', tone: op.amount > 0 ? 'pos' : 'neg' };
  }
  const delta = op.kind === KIND.TRANSFER ? envelopeDelta(op, perspective) : op.amount;
  return { cents: delta, sign: 'always', tone: delta > 0 ? 'pos' : 'neg' };
}

function titleFor(app, op, perspective) {
  if (op.kind !== KIND.TRANSFER) return operationTitle(app.state, op);
  if (op.label) return op.label;
  if (perspective !== null) {
    if (op.to === perspective) return `Reçu de ${accountName(app.state, op.from)}`;
    if (op.from === perspective) return `Envoyé vers ${accountName(app.state, op.to)}`;
  }
  return transferTitle(app.state, op);
}

/**
 * options : today, perspective (null | id d'enveloppe), onOpen(op),
 *           selecting / selected / onToggle(op) / onLongPress(op)  → mode sélection multiple
 *           tick: true + onTick(op, coché)                         → case à cocher des simulations
 */
export function operationRow(app, op, options) {
  const { today, perspective = null } = options;
  const state = app.state;
  const shown = displayedAmount(op, perspective);
  const title = titleFor(app, op, perspective);
  const day = op.date.slice(8, 10);

  const meta = [];
  if (op.kind === KIND.TRANSFER) {
    meta.push(icon('transfer', 'sm'));
    if (op.label || perspective !== null) meta.push(h('span.text', transferTitle(state, op)));
    else meta.push(h('span.text', moveLabel(op.from, op.to)));
  } else {
    if (op.envelopeId && perspective === null) {
      const env = state.envelopes.find((e) => e.id === op.envelopeId);
      if (env) meta.push(h('span.chip.env', env.name));
    }
    const tags = op.tags.map((id) => state.tags.find((t) => t.id === id)).filter(Boolean);
    for (const tag of tags.slice(0, 2)) meta.push(h('span', { class: `chip k-${tag.color}` }, h('span.dot'), tag.name));
    if (tags.length > 2) meta.push(h('span.chip.plain', `+${tags.length - 2}`));
    if (op.counterparty && op.counterparty !== title) meta.push(h('span.text', op.counterparty));
    else if (op.kind === KIND.ADJUSTMENT && op.label && op.auto !== 'opening') meta.push(h('span.text', 'Ajustement'));
  }

  const marks = [];
  if (op.photoIds.length) marks.push(h('span', { title: 'Photo jointe' }, icon('paperclip', 'sm')));
  if (op.recurringId) marks.push(h('span', { title: 'Issue d\'une récurrence' }, icon('repeat', 'sm')));
  if (op.bank) marks.push(h('span.pointed', { title: 'Pointée sur un relevé' }, icon('checks', 'sm')));

  let cls = 'op-row';
  if (op.simulated) cls += op.checked ? ' sim' : ' sim unchecked';
  else if (op.date > today) cls += ' future';
  if (options.selected) cls += ' selected';

  const leading = [];
  if (options.selecting) {
    leading.push(h('span.check', { 'aria-hidden': 'true' }, icon('check', 'sm')));
  } else if (options.tick) {
    const box = h(
      'span.tick-hit',
      {
        role: 'checkbox',
        tabindex: '0',
        'aria-checked': String(op.checked),
        'aria-label': op.checked ? 'Comptée dans le solde estimé : toucher pour l\'exclure' : 'Exclue du solde estimé : toucher pour la compter',
        onclick: (event) => {
          event.stopPropagation();
          options.onTick(op, !op.checked);
        },
        onkeydown: (event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            options.onTick(op, !op.checked);
          }
        },
      },
      h('span.tick', { 'aria-checked': String(op.checked) }, icon('check', 'sm')),
    );
    leading.push(box);
  }

  const row = h(
    'button',
    {
      type: 'button',
      class: cls,
      dataset: { op: op.id },
      'aria-pressed': options.selecting ? String(!!options.selected) : null,
    },
    ...leading,
    h('span.day', h('b', day), h('span', weekdayName(op.date))),
    h('span.main', h('span.title', title), h('span.meta', ...meta)),
    h(
      'span.side',
      amount(shown.cents, { sign: shown.sign, extra: op.simulated ? 'sim' : shown.tone }),
      h('span.marks', ...marks),
    ),
  );

  // Appui long → mode sélection ; appui court → ouvrir (ou cocher en mode sélection)
  let pressTimer = null;
  let longPressed = false;
  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  };
  if (options.onLongPress && !options.selecting) {
    row.addEventListener('pointerdown', (event) => {
      if (event.button) return;
      longPressed = false;
      cancelPress();
      pressTimer = setTimeout(() => {
        longPressed = true;
        options.onLongPress(op);
      }, LONG_PRESS_MS);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'pointermove']) {
      row.addEventListener(type, (event) => {
        if (type === 'pointermove' && Math.abs(event.movementX) + Math.abs(event.movementY) < 6) return;
        cancelPress();
      });
    }
    row.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  row.addEventListener('click', () => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (options.selecting) options.onToggle(op);
    else if (options.onOpen) options.onOpen(op);
  });
  return row;
}

/**
 * Construit une liste d'opérations déjà triées, avec un séparateur discret à chaque changement de
 * mois (« 11-2026 »). Les opérations réelles datées dans le futur sont regroupées sous « À venir ».
 * options : celles de operationRow + limit, onMore(), group(op) facultatif.
 */
export function operationList(app, ops, options) {
  const { today, limit = Infinity } = options;
  const list = h('div', { class: options.inset ? 'list inset' : 'list', role: 'list' });
  let lastGroup = null;
  const shown = ops.slice(0, limit);
  for (const op of shown) {
    const group = options.group ? options.group(op) : !op.simulated && op.date > today ? 'À venir' : formatMonthKey(monthKey(op.date));
    if (group !== lastGroup) {
      list.appendChild(h('div.month-sep', { role: 'presentation' }, group));
      lastGroup = group;
    }
    list.appendChild(
      operationRow(app, op, {
        ...options,
        selected: options.selection ? options.selection.has(op.id) : false,
      }),
    );
  }
  if (ops.length > shown.length) {
    list.appendChild(
      h('button.btn.quiet.block', { type: 'button', onclick: () => options.onMore && options.onMore() }, `Afficher la suite (${ops.length - shown.length} de plus)`),
    );
  }
  return list;
}
