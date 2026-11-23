// Haut de l'écran « Bilan » : le compte courant aujourd'hui et en fin de mois, les alertes, ce qui
// arrive dans les 7 jours. Les calculs sont dans core/dashboard.js ; ici, l'affichage et les gestes.

import { h, bigAmount } from './dom.js';
import { icon } from './icons.js';
import { operationRow } from './oprow.js';
import { openOperationForm } from './forms/operation.js';
import { formatAmount } from '../core/money.js';
import { formatDate } from '../core/dates.js';
import { dashboardAlerts, monthOutlook, upcoming, UPCOMING_DAYS } from '../core/dashboard.js';
import { unreadTotal } from '../core/comments.js';
import { backupReminderFor } from '../data/backup.js';

const TABS = new Set(['operations', 'envelopes', 'forecast', 'stats', 'more']);
const UPCOMING_SHOWN = 5;

function follow(app, action) {
  if (TABS.has(action.screen)) app.go(action.screen, action.params);
  else app.open(action.screen, action.params);
}

/** Carte « Aujourd'hui » : compte courant, estimation de fin de mois, point bas s'il est plus bas. */
function outlookCard(outlook, today) {
  const showLow = outlook.low.date !== today && outlook.low.amount < Math.min(outlook.today, outlook.end);
  return h(
    'section.card.outlook',
    { dataset: { card: 'outlook' } },
    h(
      'div.outlook-row',
      h('div.outlook-now', h('div.label', 'Compte courant'), h('div', { class: outlook.today < 0 ? 'outlook-big alert' : 'outlook-big', dataset: { value: 'today' } }, bigAmount(outlook.today))),
      h(
        'div.outlook-end',
        h('div.label', outlook.daysLeft ? `Fin du mois, estimé` : 'Fin du mois'),
        h('div', { class: outlook.end < 0 ? 'outlook-small alert' : 'outlook-small', dataset: { value: 'month-end' } }, formatAmount(outlook.end)),
        h('div.hint', `au ${formatDate(outlook.endDate)}`),
      ),
    ),
    showLow ? h('p.hint', { dataset: { value: 'low' } }, `Point le plus bas d'ici là : ${formatAmount(outlook.low.amount)} le ${formatDate(outlook.low.date)}.`) : null,
  );
}

function alertsCard(app, alerts) {
  if (!alerts.length) return null;
  const card = h('section.card.stack.tight', { dataset: { card: 'alerts' } }, h('div.card-head', h('h2', 'À regarder')));
  for (const alert of alerts) {
    const tone = alert.level === 'bad' ? 'notice bad' : alert.level === 'warn' ? 'notice warn' : 'notice';
    card.appendChild(
      h(
        'div',
        { class: tone, dataset: { alert: alert.id, level: alert.level } },
        icon(alert.icon),
        h('div.grow', alert.text),
        alert.action ? h('button.link-btn', { type: 'button', dataset: { action: `alert-${alert.id}` }, onclick: () => follow(app, alert.action) }, alert.action.label) : null,
      ),
    );
  }
  return card;
}

function upcomingCard(app, ops, today) {
  if (!ops.length) return null;
  const list = h('div.list.inset', { role: 'list' });
  for (const op of ops.slice(0, UPCOMING_SHOWN)) {
    list.appendChild(operationRow(app, op, { today, onOpen: (picked) => openOperationForm(app, { id: picked.id }) }));
  }
  return h(
    'section.card.stack.tight',
    { dataset: { card: 'upcoming' } },
    h('div.card-head', h('h2', `Dans les ${UPCOMING_DAYS} jours`), ops.length > UPCOMING_SHOWN ? h('span.chip', `${ops.length} au total`) : null),
    list,
    h('button.link-btn', { type: 'button', dataset: { action: 'see-forecast' }, onclick: () => app.go('forecast') }, 'Voir toutes les prévisions'),
  );
}

/** Le tableau de bord, prêt à insérer en haut de l'écran. */
export function dashboard(app) {
  const today = app.today();
  const state = app.state;
  const outlook = monthOutlook(state, today);
  const bank = app.setting('link:bank', null);
  const alerts = dashboardAlerts(state, { today, backup: backupReminderFor(app.store), unread: unreadTotal(state), bankValidUntil: bank && bank.validUntil ? bank.validUntil : null });
  return h(
    'div.stack.dashboard',
    { dataset: { block: 'dashboard' } },
    outlookCard(outlook, today),
    alertsCard(app, alerts),
    upcomingCard(app, upcoming(state, today), today),
  );
}
