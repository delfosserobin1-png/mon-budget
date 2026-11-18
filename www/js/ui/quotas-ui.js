// Affichage des quotas de tags : une jauge (dépensé, prévu, plafond) et la carte « Quotas en cours ».

import { h } from './dom.js';
import { icon } from './icons.js';
import { formatAmount } from '../core/money.js';
import { quotaStatuses, statusText } from '../core/quotas.js';

/** Jauge d'un quota : la part dépensée, puis la part prévue en hachuré, et une phrase sur ce qui reste. */
export function quotaMeter(status) {
  const spentPct = Math.min(100, Math.round(status.ratio * 100));
  const plannedPct = Math.max(0, Math.min(100 - spentPct, Math.round((status.planned / status.limit) * 100)));
  const tone = status.phase === 'active' ? status.level : 'idle';
  return h(
    'div',
    { class: `quota-meter ${tone}`, dataset: { quota: status.tagId, level: status.level, phase: status.phase } },
    h(
      'div.quota-track',
      {
        role: 'meter',
        'aria-label': `Quota « ${status.name} »`,
        'aria-valuemin': '0',
        'aria-valuemax': String(status.limit),
        'aria-valuenow': String(Math.min(status.spent, status.limit)),
        'aria-valuetext': `${formatAmount(status.spent)} dépensés sur ${formatAmount(status.limit)}`,
      },
      h('i.spent', { style: { width: `${spentPct}%` } }),
      plannedPct ? h('i.planned', { style: { width: `${plannedPct}%` } }) : null,
    ),
    h(
      'div.quota-legend',
      h('span.num', `${formatAmount(status.spent)} / ${formatAmount(status.limit)}`),
      h('span.what', statusText(status)),
    ),
  );
}

/**
 * Carte « Quotas en cours » (écran Stats). onOpen(status) : toucher un quota ouvre ses dépenses.
 * Renvoie null s'il n'y a aucun quota en cours ou à venir.
 */
export function quotaCard(app, { onOpen = null } = {}) {
  const statuses = quotaStatuses(app.state, app.today()).filter((s) => s.phase !== 'ended');
  if (!statuses.length) return null;
  const over = statuses.filter((s) => s.phase === 'active' && s.level === 'over').length;
  const card = h(
    'section.card.stack.tight',
    { dataset: { card: 'quotas' } },
    h('div.card-head', h('h2', 'Quotas en cours'), over ? h('span.chip.bad', over > 1 ? `${over} dépassés` : '1 dépassé') : null),
  );
  for (const status of statuses) {
    card.appendChild(
      h(
        'button.quota-row',
        { type: 'button', class: `k-${status.color}`, dataset: { quotaRow: status.tagId }, onclick: () => onOpen && onOpen(status) },
        h('span.quota-name', h('span.dot'), h('b', status.name), status.planned && status.phase === 'active' ? h('small', `+ ${formatAmount(status.planned)} prévus`) : null),
        quotaMeter(status),
      ),
    );
  }
  card.appendChild(h('p.hint', icon('info', 'sm'), ' Les quotas se règlent dans Plus › Tags.'));
  return card;
}
